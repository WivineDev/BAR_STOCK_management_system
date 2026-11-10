import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { asyncRoute, fail } from '../utils/errors.js';
import { fromMilliQuantity, multiplyMinorByQuantity, quantityToMilli, toMinor, fromMinor, toQuantity } from '../utils/money.js';

const router = Router();
router.use(authenticate);

const METHODS = ['cash', 'mobile_money', 'bank_transfer', 'card'];
const TABLE_STATUSES = ['available', 'reserved', 'out_of_service'];
const moneyText = (amount) => fromMinor(amount);

function normalizeLabel(value, field, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${field} is required and must be ${max} characters or fewer`);
  return value.trim();
}
function optionalLabel(value, field, max = 120) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) fail(400, `${field} must be ${max} characters or fewer`);
  return value.trim();
}
function requireIdempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || key.length < 8 || key.length > 120) fail(400, 'A unique Idempotency-Key is required for this action');
  return key;
}
function nonNegativeInt(value, field) {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100000) fail(400, `${field} must be a whole number between 0 and 100000`);
  return parsed;
}
const isPlainObject = (value) => {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const jsonSafe = (value) => {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (isPlainObject(value)) {
    const safe = {};
    for (const [key, item] of Object.entries(value)) safe[key] = jsonSafe(item);
    return safe;
  }
  return value;
};
function isDuplicateError(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.meta?.cause?.code === 'ER_DUP_ENTRY' || error?.code === 'P2002' || /Duplicate entry|already exists/i.test(`${error?.message || ''} ${error?.meta?.cause?.message || ''}`);
}

const BILL_QUERY = `
  SELECT o.table_session_id AS sessionId, SUM(oi.line_total) AS billTotal, SUM(oi.line_cost) AS billCost, COUNT(DISTINCT o.id) AS roundCount
  FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.state = 'served'
  WHERE o.state = 'served' GROUP BY o.table_session_id`;
const PAID_QUERY = `
  SELECT table_session_id AS sessionId, SUM(amount) AS paidTotal, COUNT(*) AS paymentCount
  FROM table_session_payments GROUP BY table_session_id`;

async function sessionBill(connection, sessionId) {
  const [bill] = await connection.execute(
    `SELECT COALESCE(SUM(oi.line_total), 0) AS billTotal, COALESCE(SUM(oi.line_cost), 0) AS billCost
     FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.state = 'served'
     WHERE o.table_session_id = ? AND o.state = 'served'`,
    [sessionId],
  );
  const [paid] = await connection.execute('SELECT COALESCE(SUM(amount), 0) AS paidTotal FROM table_session_payments WHERE table_session_id = ?', [sessionId]);
  return { billMinor: toMinor(String(bill[0].billTotal)), costMinor: toMinor(String(bill[0].billCost)), paidMinor: toMinor(String(paid[0].paidTotal)) };
}

async function loadSessionDetail(connection, sessionId, businessId) {
  const [sessions] = await connection.execute(
    `SELECT ts.id, ts.table_id AS tableId, ts.status, ts.opened_at AS openedAt, ts.opened_by AS openedBy, ts.waiter_id AS waiterId,
      ts.closed_at AS closedAt, ts.closed_by AS closedBy, ts.sale_id AS saleId,
      t.code AS tableCode, t.name AS tableName, t.capacity, a.name AS areaName, uw.name AS openedByName, ww.name AS waiterName
     FROM table_sessions ts
     JOIN bar_tables t ON t.id = ts.table_id
     LEFT JOIN bar_areas a ON a.id = t.area_id
     LEFT JOIN users uw ON uw.id = ts.opened_by
     LEFT JOIN users ww ON ww.id = ts.waiter_id
     WHERE ts.id = ? AND ts.business_id = ?`,
    [sessionId, businessId],
  );
  if (!sessions.length) fail(404, 'This table session was not found');
  const session = sessions[0];
  const [orders] = await connection.execute(
    `SELECT o.id, o.reference, o.round_no AS roundNo, o.state, o.created_by AS createdBy, o.created_at AS createdAt,
      o.served_at AS servedAt, o.void_reason AS voidReason, uc.name AS createdByName
     FROM orders o LEFT JOIN users uc ON uc.id = o.created_by
     WHERE o.table_session_id = ? ORDER BY o.round_no, o.created_at`,
    [sessionId],
  );
  const [items] = await connection.execute(
    `SELECT oi.order_id AS orderId, oi.id, oi.product_id AS productId, oi.product_name AS productName, oi.unit_name AS unitName,
      oi.factor_to_base AS factorToBase, oi.quantity, oi.base_quantity AS baseQuantity, oi.unit_price AS unitPrice,
      oi.unit_cost AS unitCost, oi.line_total AS lineTotal, oi.state
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.table_session_id = ? ORDER BY oi.created_at`,
    [sessionId],
  );
  const [payments] = await connection.execute(
    `SELECT p.id, p.method, p.reference, p.amount, p.created_at AS createdAt, u.name AS receivedByName
     FROM table_session_payments p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.table_session_id = ? ORDER BY p.created_at`,
    [sessionId],
  );
  const totals = await sessionBill(connection, sessionId);
  return {
    ...session,
    orders: orders.map((order) => ({ ...order, items: items.filter((item) => item.orderId === order.id) })),
    payments,
    billTotal: moneyText(totals.billMinor),
    billCost: moneyText(totals.costMinor),
    paidTotal: moneyText(totals.paidMinor),
    balanceDue: moneyText(totals.billMinor - totals.paidMinor),
  };
}

function loadProductLine(connection, businessId, branchId, line) {
  return (async () => {
    if (typeof line?.productId !== 'string') fail(400, 'Every order line needs a product');
    const quantity = toQuantity(line.quantity, 'Quantity');
    const [rows] = await connection.execute(
      `SELECT p.id, p.name, p.base_unit AS baseUnit, p.cost_price AS costPrice, i.quantity AS stockQuantity,
        pu.id AS unitId, pu.unit_name AS unitName, pu.factor_to_base AS factorToBase, pu.selling_price AS sellingPrice, pu.is_base AS isBase
       FROM products p
       JOIN inventory i ON i.product_id = p.id AND i.branch_id = p.branch_id
       JOIN product_units pu ON pu.product_id = p.id AND pu.business_id = p.business_id AND pu.active = 1
       WHERE p.id = ? AND p.business_id = ? AND p.branch_id = ? AND p.active = 1 FOR UPDATE`,
      [line.productId, businessId, branchId],
    );
    const selected = rows.find((row) => (line.unitId ? row.unitId === line.unitId : Number(row.isBase) === 1));
    if (!selected) fail(404, line.unitId ? 'The selected product unit was not found' : 'A selected product was not found');
    const baseQtyMilli = (quantityToMilli(quantity) * quantityToMilli(selected.factorToBase) + 500n) / 1000n;
    const baseQuantity = fromMilliQuantity(baseQtyMilli);
    const lineTotal = multiplyMinorByQuantity(selected.sellingPrice, quantity);
    const lineCost = multiplyMinorByQuantity(selected.costPrice, baseQuantity);
    return { ...selected, quantity, baseQuantity, baseQtyMilli, stockQuantityMilli: quantityToMilli(selected.stockQuantity), lineTotal, lineCost };
  })();
}

router.get('/floor', asyncRoute(async (req, res) => {
  const [areas] = await pool.execute('SELECT id, name, sort_order AS sortOrder, active FROM bar_areas WHERE business_id = ? ORDER BY sort_order, name', [req.user.businessId]);
  const [tables] = await pool.execute(
    `SELECT t.id, t.area_id AS areaId, t.code, t.name, t.capacity, t.status, t.active, t.floor_position AS floorPosition,
      ts.id AS sessionId, ts.opened_at AS openedAt, ts.waiter_id AS waiterId, ww.name AS waiterName,
      COALESCE(bill.billTotal, 0) AS billTotal, COALESCE(pay.paidTotal, 0) AS paidTotal, COALESCE(bill.roundCount, 0) AS roundCount
     FROM bar_tables t
     LEFT JOIN table_sessions ts ON ts.table_id = t.id AND ts.status = 'open'
     LEFT JOIN users ww ON ww.id = ts.waiter_id
     LEFT JOIN (${BILL_QUERY}) bill ON bill.sessionId = ts.id
     LEFT JOIN (${PAID_QUERY}) pay ON pay.sessionId = ts.id
     WHERE t.business_id = ?
     ORDER BY t.area_id, t.floor_position, t.code`,
    [req.user.businessId],
  );
  res.json(jsonSafe({ areas, tables: tables.map((table) => ({ ...table, effectiveStatus: table.sessionId ? 'occupied' : table.status })) }));
}));

router.get('/floor/staff', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const [staff] = await pool.execute(
    "SELECT id, name, role FROM users WHERE business_id = ? AND active = 1 AND role IN ('owner','manager','cashier') ORDER BY name",
    [req.user.businessId],
  );
  res.json({ items: staff });
}));

router.post('/floor/areas', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const name = normalizeLabel(req.body?.name, 'Area name', 120);
  const sortOrder = nonNegativeInt(req.body?.sortOrder, 'Sort order');
  const id = randomUUID();
  const area = await withTransaction(async (connection) => {
    const [branches] = await connection.execute('SELECT id FROM branches WHERE business_id = ? ORDER BY created_at LIMIT 1', [req.user.businessId]);
    if (!branches.length) fail(400, 'This business has no branch configured');
    await connection.execute('INSERT INTO bar_areas (id, business_id, name, sort_order) VALUES (?, ?, ?, ?)', [id, req.user.businessId, name, sortOrder]).catch((insertError) => {
      if (isDuplicateError(insertError)) fail(409, 'An area with this name already exists');
      throw insertError;
    });
    await writeAudit(connection, { businessId: req.user.businessId, branchId: branches[0].id, userId: req.user.id, action: 'created', module: 'bar_areas', recordId: id, details: { name, sortOrder } });
    return { id, name, sortOrder, active: 1 };
  });
  res.status(201).json({ area });
}));

router.patch('/floor/areas/:areaId', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const result = await withTransaction(async (connection) => {
    const [areas] = await connection.execute('SELECT id, name, sort_order AS sortOrder, active FROM bar_areas WHERE id = ? AND business_id = ? FOR UPDATE', [req.params.areaId, req.user.businessId]);
    if (!areas.length) fail(404, 'This area was not found');
    const next = {
      name: req.body?.name !== undefined ? normalizeLabel(req.body.name, 'Area name', 120) : areas[0].name,
      sortOrder: req.body?.sortOrder !== undefined ? nonNegativeInt(req.body.sortOrder, 'Sort order') : areas[0].sortOrder,
      active: req.body?.active !== undefined ? (req.body.active ? 1 : 0) : areas[0].active,
    };
    if (!next.active) {
      const [open] = await connection.execute(
        `SELECT COUNT(*) AS openCount FROM table_sessions ts JOIN bar_tables t ON t.id = ts.table_id
         WHERE t.area_id = ? AND ts.business_id = ? AND ts.status = 'open'`,
        [req.params.areaId, req.user.businessId],
      );
      if (open[0].openCount > 0) fail(409, 'This area still has tables with open sessions. Close them before deactivating the area.');
    }
    await connection.execute('UPDATE bar_areas SET name = ?, sort_order = ?, active = ? WHERE id = ? AND business_id = ?', [next.name, next.sortOrder, next.active, req.params.areaId, req.user.businessId]).catch((updateError) => {
      if (isDuplicateError(updateError)) fail(409, 'An area with this name already exists');
      throw updateError;
    });
    await writeAudit(connection, { businessId: req.user.businessId, userId: req.user.id, action: 'updated', module: 'bar_areas', recordId: req.params.areaId, details: { before: areas[0], after: next } });
    return { id: req.params.areaId, ...next };
  });
  res.json({ area: result });
}));

router.post('/floor/tables', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const code = normalizeLabel(req.body?.code, 'Table code', 20).toUpperCase();
  const name = optionalLabel(req.body?.name, 'Table name', 80);
  const capacity = nonNegativeInt(req.body?.capacity, 'Seat capacity');
  const floorPosition = nonNegativeInt(req.body?.floorPosition, 'Display position');
  const areaId = req.body?.areaId;
  if (typeof areaId !== 'string') fail(400, 'Choose the floor area for this table');
  const id = randomUUID();
  const table = await withTransaction(async (connection) => {
    const [branches] = await connection.execute('SELECT id FROM branches WHERE business_id = ? ORDER BY created_at LIMIT 1', [req.user.businessId]);
    if (!branches.length) fail(400, 'This business has no branch configured');
    const [areas] = await connection.execute('SELECT id FROM bar_areas WHERE id = ? AND business_id = ? AND active = 1', [areaId, req.user.businessId]);
    if (!areas.length) fail(400, 'The selected floor area was not found');
    await connection.execute('INSERT INTO bar_tables (id, business_id, area_id, code, name, capacity, floor_position) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.user.businessId, areaId, code, name, capacity, floorPosition]).catch((insertError) => {
      if (isDuplicateError(insertError)) fail(409, `Table code ${code} is already used by another table`);
      throw insertError;
    });
    await writeAudit(connection, { businessId: req.user.businessId, branchId: branches[0].id, userId: req.user.id, action: 'created', module: 'bar_tables', recordId: id, details: { code, name, areaId, capacity, floorPosition } });
    return { id, code, name, areaId, capacity, floorPosition, status: 'available', active: 1 };
  });
  res.status(201).json({ table });
}));

router.patch('/floor/tables/:tableId', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const result = await withTransaction(async (connection) => {
    const [tables] = await connection.execute('SELECT id, area_id AS areaId, code, name, capacity, status, active, floor_position AS floorPosition FROM bar_tables WHERE id = ? AND business_id = ? FOR UPDATE', [req.params.tableId, req.user.businessId]);
    if (!tables.length) fail(404, 'This table was not found');
    const current = tables[0];
    const next = {
      code: req.body?.code !== undefined ? normalizeLabel(req.body.code, 'Table code', 20).toUpperCase() : current.code,
      name: req.body?.name !== undefined ? optionalLabel(req.body.name, 'Table name', 80) : current.name,
      capacity: req.body?.capacity !== undefined ? nonNegativeInt(req.body.capacity, 'Seat capacity') : current.capacity,
      status: req.body?.status !== undefined ? req.body.status : current.status,
      active: req.body?.active !== undefined ? (req.body.active ? 1 : 0) : current.active,
      floorPosition: req.body?.floorPosition !== undefined ? nonNegativeInt(req.body.floorPosition, 'Display position') : current.floorPosition,
      areaId: req.body?.areaId !== undefined ? req.body.areaId : current.areaId,
    };
    if (next.status === 'occupied') fail(409, 'Occupancy follows open sessions and cannot be set by hand');
    if (!TABLE_STATUSES.includes(next.status)) fail(400, 'Choose a supported table status');
    if (req.body?.areaId !== undefined) {
      const [areas] = await connection.execute('SELECT id FROM bar_areas WHERE id = ? AND business_id = ? AND active = 1', [next.areaId, req.user.businessId]);
      if (!areas.length) fail(400, 'The selected floor area was not found');
    }
    const [open] = await connection.execute("SELECT id FROM table_sessions WHERE table_id = ? AND business_id = ? AND status = 'open' LIMIT 1", [req.params.tableId, req.user.businessId]);
    if (open.length && (!next.active || next.status !== 'available')) fail(409, 'This table has an open session. Close it before changing availability.');
    await connection.execute('UPDATE bar_tables SET area_id = ?, code = ?, name = ?, capacity = ?, status = ?, active = ?, floor_position = ? WHERE id = ? AND business_id = ?', [next.areaId, next.code, next.name, next.capacity, next.status, next.active, next.floorPosition, req.params.tableId, req.user.businessId]).catch((updateError) => {
      if (isDuplicateError(updateError)) fail(409, `Table code ${next.code} is already used by another table`);
      throw updateError;
    });
    await writeAudit(connection, { businessId: req.user.businessId, userId: req.user.id, action: 'updated', module: 'bar_tables', recordId: req.params.tableId, details: { before: current, after: next } });
    return { id: req.params.tableId, ...next, effectiveStatus: open.length ? 'occupied' : next.status };
  });
  res.json({ table: result });
}));

router.post('/floor/tables/:tableId/sessions', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const sessionId = randomUUID();
  const session = await withTransaction(async (connection) => {
    const [tables] = await connection.execute('SELECT id, code, name, status, active, area_id AS areaId FROM bar_tables WHERE id = ? AND business_id = ? FOR UPDATE', [req.params.tableId, req.user.businessId]);
    if (!tables.length) fail(404, 'This table was not found');
    const table = tables[0];
    if (!table.active) fail(409, 'This table is out of service');
    const [open] = await connection.execute("SELECT id FROM table_sessions WHERE table_id = ? AND business_id = ? AND status = 'open' LIMIT 1", [req.params.tableId, req.user.businessId]);
    if (open.length) fail(409, 'This table already has an open session');
    if (table.status === 'occupied') fail(409, 'This table already has an open session');
    if (table.status !== 'available' && !['owner', 'manager'].includes(req.user.role)) fail(409, 'Only an owner or manager can open a reserved or out-of-service table');
    const waiterId = typeof req.body?.waiterId === 'string' ? req.body.waiterId : req.user.id;
    const [waiters] = await connection.execute('SELECT id FROM users WHERE id = ? AND business_id = ? AND active = 1', [waiterId, req.user.businessId]);
    if (!waiters.length) fail(400, 'The selected waiter was not found');
    try {
      await connection.execute('INSERT INTO table_sessions (id, business_id, table_id, opened_by, waiter_id) VALUES (?, ?, ?, ?, ?)', [sessionId, req.user.businessId, req.params.tableId, req.user.id, waiterId]);
    } catch (insertError) {
      if (isDuplicateError(insertError)) fail(409, 'This table was just opened by someone else. Refresh the floor and resume the open session.');
      throw insertError;
    }
    await connection.execute("UPDATE bar_tables SET status = 'occupied' WHERE id = ? AND business_id = ?", [req.params.tableId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, userId: req.user.id, action: 'opened', module: 'table_sessions', recordId: sessionId, details: { tableCode: table.code, waiterId } });
    return { id: sessionId, tableId: req.params.tableId, tableCode: table.code, waiterId };
  });
  res.status(201).json({ session });
}));

router.get('/table-sessions/open', asyncRoute(async (req, res) => {
  const [sessions] = await pool.execute(
    `SELECT ts.id, ts.opened_at AS openedAt, ts.waiter_id AS waiterId, ww.name AS waiterName,
      t.id AS tableId, t.code AS tableCode, t.name AS tableName, t.capacity, a.name AS areaName,
      COALESCE(bill.billTotal, 0) AS billTotal, COALESCE(pay.paidTotal, 0) AS paidTotal,
      COALESCE(bill.billTotal, 0) - COALESCE(pay.paidTotal, 0) AS balanceDue, COALESCE(bill.roundCount, 0) AS roundCount
     FROM table_sessions ts
     JOIN bar_tables t ON t.id = ts.table_id
     LEFT JOIN bar_areas a ON a.id = t.area_id
     LEFT JOIN users ww ON ww.id = ts.waiter_id
     LEFT JOIN (${BILL_QUERY}) bill ON bill.sessionId = ts.id
     LEFT JOIN (${PAID_QUERY}) pay ON pay.sessionId = ts.id
     WHERE ts.business_id = ? AND ts.status = 'open'
     ORDER BY ts.opened_at`,
    [req.user.businessId],
  );
  res.json(jsonSafe({ sessions }));
}));

router.get('/table-sessions/:sessionId', asyncRoute(async (req, res) => {
  const session = await withTransaction((connection) => loadSessionDetail(connection, req.params.sessionId, req.user.businessId));
  res.json(jsonSafe({ session }));
}));

router.post('/table-sessions/:sessionId/orders', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const key = requireIdempotencyKey(req);
  const { items, serveNow = false } = req.body || {};
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail(400, 'A round must include 1 to 100 product lines');
  const order = await withTransaction(async (connection) => {
    const [existing] = await connection.execute('SELECT id, reference, state FROM orders WHERE business_id = ? AND idempotency_key = ?', [req.user.businessId, key]);
    if (existing.length) return { id: existing[0].id, reference: existing[0].reference, state: existing[0].state, repeated: true };
    const [sessions] = await connection.execute("SELECT id, table_id AS tableId FROM table_sessions WHERE id = ? AND business_id = ? AND status = 'open' FOR UPDATE", [req.params.sessionId, req.user.businessId]);
    if (!sessions.length) fail(404, 'This table session is closed or was not found');
    const [branchRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]);
    const branchId = branchRows[0].branchId;
    const parsed = [];
    for (const line of items) parsed.push(await loadProductLine(connection, req.user.businessId, branchId, line));
    const [roundRows] = await connection.execute('SELECT COALESCE(MAX(round_no), 0) + 1 AS nextRound FROM orders WHERE table_session_id = ?', [req.params.sessionId]);
    const roundNo = Number(roundRows[0].nextRound);
    const orderId = randomUUID();
    const state = serveNow ? 'served' : 'draft';
    await connection.execute(
      `INSERT INTO orders (id, business_id, table_session_id, reference, idempotency_key, state, round_no, created_by, served_at, served_by)
       VALUES (?, ?, ?, CONCAT('O-', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 12))), ?, ?, ?, ?, ${serveNow ? 'CURRENT_TIMESTAMP' : 'NULL'}, ${serveNow ? '?' : 'NULL'})`,
      serveNow
        ? [orderId, req.user.businessId, req.params.sessionId, key, state, roundNo, req.user.id, req.user.id]
        : [orderId, req.user.businessId, req.params.sessionId, key, state, roundNo, req.user.id],
    );
    for (const line of parsed) {
      if (serveNow) {
        if (line.stockQuantityMilli < line.baseQtyMilli) fail(409, `Not enough stock for ${line.name}`);
      }
      await connection.execute(
        `INSERT INTO order_items (id, business_id, order_id, product_id, product_unit_id, product_name, unit_name, factor_to_base, quantity, base_quantity, unit_price, unit_cost, line_total, line_cost, state, served_at, served_by)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${serveNow ? 'CURRENT_TIMESTAMP' : 'NULL'}, ${serveNow ? '?' : 'NULL'})`,
        serveNow
          ? [req.user.businessId, orderId, line.id, line.unitId, line.name, line.unitName, line.factorToBase, line.quantity, line.baseQuantity, line.sellingPrice, line.costPrice, moneyText(line.lineTotal), moneyText(line.lineCost), state, req.user.id]
          : [req.user.businessId, orderId, line.id, line.unitId, line.name, line.unitName, line.factorToBase, line.quantity, line.baseQuantity, line.sellingPrice, line.costPrice, moneyText(line.lineTotal), moneyText(line.lineCost), state],
      );
      if (serveNow) {
        await connection.execute('UPDATE inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND branch_id = ?', [line.baseQuantity, line.id, branchId]);
        await connection.execute(
          `INSERT INTO stock_movements (id, business_id, branch_id, product_id, user_id, movement_type, quantity_delta, unit, reference_type, reference_id, notes)
           VALUES (UUID(), ?, ?, ?, ?, 'serving', -CAST(? AS DECIMAL(14,3)), ?, 'order', ?, ?)`,
          [req.user.businessId, branchId, line.id, req.user.id, line.baseQuantity, line.baseUnit, orderId, `Round ${roundNo} served at the table`],
        );
      }
    }
    const detail = await loadSessionDetail(connection, req.params.sessionId, req.user.businessId);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: serveNow ? 'served' : 'drafted', module: 'orders', recordId: orderId, reference: detail.orders.find((o) => o.id === orderId)?.reference, details: { sessionId: req.params.sessionId, roundNo, lines: parsed.length, state } });
    return { id: orderId, reference: detail.orders.find((o) => o.id === orderId)?.reference, state, roundNo, repeated: false, session: detail };
  });
  res.status(order.repeated ? 200 : 201).json(jsonSafe({ order }));
}));

router.post('/orders/:orderId/serve', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const result = await withTransaction(async (connection) => {
    const [orders] = await connection.execute(
      `SELECT o.id, o.reference, o.state, o.table_session_id AS sessionId FROM orders o WHERE o.id = ? AND o.business_id = ? FOR UPDATE`,
      [req.params.orderId, req.user.businessId],
    );
    if (!orders.length) fail(404, 'This order round was not found');
    const order = orders[0];
    if (order.state === 'served') return { id: order.id, reference: order.reference, state: order.state, repeated: true };
    if (order.state === 'voided') fail(409, 'This round was voided and cannot be served');
    const [sessions] = await connection.execute("SELECT id FROM table_sessions WHERE id = ? AND business_id = ? AND status = 'open' FOR UPDATE", [order.sessionId, req.user.businessId]);
    if (!sessions.length) fail(409, 'This table session is already closed');
    const [branchRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]);
    const branchId = branchRows[0].branchId;
    const [items] = await connection.execute('SELECT id, product_id AS productId, product_unit_id AS productUnitId, quantity FROM order_items WHERE order_id = ? AND state = ?', [order.id, 'draft']);
    for (const item of items) {
      const [rows] = await connection.execute(
        `SELECT p.id, p.name, p.base_unit AS baseUnit, i.quantity AS stockQuantity, pu.id AS unitId, pu.unit_name AS unitName, pu.factor_to_base AS factorToBase
         FROM products p JOIN inventory i ON i.product_id = p.id AND i.branch_id = p.branch_id JOIN product_units pu ON pu.id = ?
         WHERE p.id = ? AND p.business_id = ? AND p.branch_id = ? FOR UPDATE`,
        [item.productUnitId, item.productId, req.user.businessId, branchId],
      );
      if (!rows.length) fail(404, `The saved unit for ${item.productId} was not found`);
      const line = rows[0];
      const baseQtyMilli = (quantityToMilli(item.quantity) * quantityToMilli(line.factorToBase) + 500n) / 1000n;
      if (quantityToMilli(line.stockQuantity) < baseQtyMilli) fail(409, `Not enough stock for ${line.name}`);
      const baseQuantity = fromMilliQuantity(baseQtyMilli);
      await connection.execute('UPDATE inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND branch_id = ?', [baseQuantity, item.productId, branchId]);
      await connection.execute(
        `INSERT INTO stock_movements (id, business_id, branch_id, product_id, user_id, movement_type, quantity_delta, unit, reference_type, reference_id, notes)
         VALUES (UUID(), ?, ?, ?, ?, 'serving', -CAST(? AS DECIMAL(14,3)), ?, 'order', ?, ?)`,
        [req.user.businessId, branchId, item.productId, req.user.id, baseQuantity, line.baseUnit, order.id, `Served from order ${order.reference}`],
      );
    }
    await connection.execute("UPDATE orders SET state = 'served', served_at = CURRENT_TIMESTAMP, served_by = ? WHERE id = ?", [req.user.id, order.id]);
    await connection.execute("UPDATE order_items SET state = 'served', served_at = CURRENT_TIMESTAMP, served_by = ? WHERE order_id = ? AND state = 'draft'", [req.user.id, order.id]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'served', module: 'orders', recordId: order.id, reference: order.reference, details: { sessionId: order.sessionId, lines: items.length } });
    return { id: order.id, reference: order.reference, state: 'served', repeated: false };
  });
  res.json({ order: result });
}));

router.post('/orders/:orderId/void', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const reason = normalizeLabel(req.body?.reason, 'Reason', 500);
  const result = await withTransaction(async (connection) => {
    const [orders] = await connection.execute('SELECT id, reference, state, table_session_id AS sessionId FROM orders WHERE id = ? AND business_id = ? FOR UPDATE', [req.params.orderId, req.user.businessId]);
    if (!orders.length) fail(404, 'This order round was not found');
    const order = orders[0];
    if (order.state === 'voided') fail(409, 'This round is already voided');
    const [sessions] = await connection.execute('SELECT id, status FROM table_sessions WHERE id = ? AND business_id = ? FOR UPDATE', [order.sessionId, req.user.businessId]);
    if (!sessions.length) fail(404, 'The table session for this round was not found');
    if (sessions[0].status !== 'open') fail(409, 'This session is closed. Use a sale return instead of voiding a closed bill');
    if (order.state === 'served' && !['owner', 'manager'].includes(req.user.role)) fail(403, 'Only an owner or manager can void an already-served round');
    const [branchRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]);
    const branchId = branchRows[0].branchId;
    if (order.state === 'served') {
      const totals = await sessionBill(connection, order.sessionId);
      const [round] = await connection.execute("SELECT COALESCE(SUM(line_total), 0) AS roundTotal FROM order_items WHERE order_id = ? AND state = 'served'", [order.id]);
      const remainingBill = totals.billMinor - toMinor(String(round[0].roundTotal));
      if (remainingBill < totals.paidMinor) fail(409, 'Voiding this round would leave an overpaid bill. Settle the excess with a refund before voiding.');
      const [items] = await connection.execute("SELECT id, product_id AS productId, product_unit_id AS productUnitId, quantity FROM order_items WHERE order_id = ? AND state = 'served'", [order.id]);
      for (const item of items) {
        const [rows] = await connection.execute(
          `SELECT p.id, p.name, p.base_unit AS baseUnit, pu.factor_to_base AS factorToBase
           FROM products p JOIN product_units pu ON pu.id = ? WHERE p.id = ? AND p.business_id = ? FOR UPDATE`,
          [item.productUnitId, item.productId, req.user.businessId],
        );
        if (!rows.length) fail(404, `The saved unit for ${item.productId} was not found`);
        const baseQtyMilli = (quantityToMilli(item.quantity) * quantityToMilli(rows[0].factorToBase) + 500n) / 1000n;
        const baseQuantity = fromMilliQuantity(baseQtyMilli);
        await connection.execute('UPDATE inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND branch_id = ?', [baseQuantity, item.productId, branchId]);
        await connection.execute(
          `INSERT INTO stock_movements (id, business_id, branch_id, product_id, user_id, movement_type, quantity_delta, unit, reference_type, reference_id, notes)
           VALUES (UUID(), ?, ?, ?, ?, 'serving_void', CAST(? AS DECIMAL(14,3)), ?, 'order', ?, ?)`,
          [req.user.businessId, branchId, item.productId, req.user.id, baseQuantity, rows[0].baseUnit, order.id, `Void of order ${order.reference}: ${reason}`],
        );
      }
    }
    await connection.execute("UPDATE orders SET state = 'voided', voided_at = CURRENT_TIMESTAMP, voided_by = ?, void_reason = ? WHERE id = ?", [req.user.id, reason, order.id]);
    await connection.execute("UPDATE order_items SET state = 'voided' WHERE order_id = ?", [order.id]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'voided', module: 'orders', recordId: order.id, reference: order.reference, details: { reason, wasServed: order.state === 'served' } });
    return { id: order.id, state: 'voided' };
  });
  res.json({ order: result });
}));

router.post('/table-sessions/:sessionId/payments', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const key = requireIdempotencyKey(req);
  const { method } = req.body || {};
  const amountMinor = toMinor(req.body?.amount, 'Payment amount');
  if (!METHODS.includes(method)) fail(400, 'Choose a supported payment method');
  if (amountMinor <= 0n) fail(400, 'Payment amounts must be greater than zero');
  let reference = null;
  if (req.body?.reference !== undefined && req.body?.reference !== null) {
    if (typeof req.body.reference !== 'string') fail(400, 'Payment references must be text');
    reference = req.body.reference.trim().slice(0, 120) || null;
  }
  const payment = await withTransaction(async (connection) => {
    const [existing] = await connection.execute('SELECT id, method, reference, amount FROM table_session_payments WHERE business_id = ? AND idempotency_key = ?', [req.user.businessId, key]);
    if (existing.length) return { ...existing[0], repeated: true };
    const [sessions] = await connection.execute("SELECT id FROM table_sessions WHERE id = ? AND business_id = ? AND status = 'open' FOR UPDATE", [req.params.sessionId, req.user.businessId]);
    if (!sessions.length) fail(404, 'This table session is closed or was not found');
    const totals = await sessionBill(connection, req.params.sessionId);
    const balance = totals.billMinor - totals.paidMinor;
    if (balance <= 0n) fail(409, 'This table bill is already fully settled');
    if (amountMinor > balance) fail(400, 'Payment cannot exceed the outstanding bill balance');
    const [sessions2] = await connection.execute('SELECT id FROM cash_sessions WHERE business_id = ? AND user_id = ? AND status = \'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (method === 'cash' && !sessions2.length) fail(409, 'Open a cash session before accepting cash payments');
    const [branchRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]);
    const branchId = branchRows[0].branchId;
    const paymentId = randomUUID();
    await connection.execute('INSERT INTO table_session_payments (id, business_id, table_session_id, user_id, method, reference, amount, idempotency_key, cash_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [paymentId, req.user.businessId, req.params.sessionId, req.user.id, method, reference, moneyText(amountMinor), key, method === 'cash' ? sessions2[0].id : null]);
    if (method === 'cash') {
      await connection.execute(
        `INSERT INTO cash_movements (id, business_id, branch_id, session_id, user_id, movement_type, direction, amount, reference_type, reference_id, notes)
         VALUES (UUID(), ?, ?, ?, ?, 'table_payment', 'in', ?, 'table_session_payment', ?, ?)`,
        [req.user.businessId, branchId, sessions2[0].id, req.user.id, moneyText(amountMinor), paymentId, 'Table bill payment'],
      );
    }
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'recorded', module: 'table_session_payments', recordId: paymentId, details: { sessionId: req.params.sessionId, method, reference, amount: moneyText(amountMinor) } });
    return { id: paymentId, method, reference, amount: moneyText(amountMinor), repeated: false };
  });
  res.status(payment.repeated ? 200 : 201).json({ payment });
}));

router.post('/table-sessions/:sessionId/close', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const closeKey = `close:${req.params.sessionId}`;
  const { discount = '0', customerId = null } = req.body || {};
  const sale = await withTransaction(async (connection) => {
    const [existing] = await connection.execute('SELECT id FROM sales WHERE business_id = ? AND idempotency_key = ?', [req.user.businessId, closeKey]);
    if (existing.length) return { id: existing[0].id, repeated: true };
    const [sessions] = await connection.execute("SELECT id, table_id AS tableId, waiter_id AS waiterId FROM table_sessions WHERE id = ? AND business_id = ? AND status = 'open' FOR UPDATE", [req.params.sessionId, req.user.businessId]);
    if (!sessions.length) fail(404, 'This table session is closed or was not found');
    const session = sessions[0];
    const totals = await sessionBill(connection, req.params.sessionId);
    if (totals.billMinor <= 0n) fail(409, 'Serve at least one round before closing this table');
    const discountMinor = toMinor(discount === null || discount === undefined || discount === '' ? '0' : discount, 'Discount');
    if (discountMinor > 0n && !['owner', 'manager'].includes(req.user.role)) fail(403, 'Only an owner or manager can authorize a table bill discount');
    if (discountMinor > totals.billMinor) fail(400, 'Discount cannot exceed the table bill');
    const totalMinor = totals.billMinor - discountMinor;
    if (totals.paidMinor > totalMinor) fail(409, 'Payments on this bill exceed the discounted total. Void the excess payment or remove the discount.');
    const balanceMinor = totalMinor - totals.paidMinor;
    if (balanceMinor > 0n) {
      if (!['owner', 'manager'].includes(req.user.role)) fail(403, 'Only an owner or manager can transfer an unpaid balance to customer credit');
      if (typeof customerId !== 'string') fail(400, 'Choose the credit customer for the unpaid balance, or settle the bill first');
      const [customer] = await connection.execute('SELECT id FROM customers WHERE id = ? AND business_id = ? AND active = 1', [customerId, req.user.businessId]);
      if (!customer.length) fail(400, 'The selected customer was not found');
    }
    const [branchRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]);
    const branchId = branchRows[0].branchId;
    await connection.execute(
      `INSERT INTO sales (id, business_id, branch_id, cashier_id, customer_id, table_session_id, sales_channel, reference, idempotency_key, status, subtotal, discount_amount, tax_amount, total, amount_paid, balance_due, cost_of_goods_sold)
       VALUES (UUID(), ?, ?, ?, ?, ?, 'TABLE', CONCAT('S-', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 12))), ?, 'completed', ?, ?, 0, ?, ?, ?, ?)`,
      [req.user.businessId, branchId, req.user.id, balanceMinor > 0n ? customerId : null, req.params.sessionId, closeKey, moneyText(totals.billMinor), moneyText(discountMinor), moneyText(totalMinor), moneyText(totals.paidMinor), moneyText(balanceMinor), moneyText(totals.costMinor)],
    );
    const [saleRows] = await connection.execute('SELECT id, reference FROM sales WHERE business_id = ? AND idempotency_key = ?', [req.user.businessId, closeKey]);
    const saleId = saleRows[0].id; const reference = saleRows[0].reference;
    const [servedItems] = await connection.execute(
      `SELECT oi.product_id AS productId, oi.product_name AS productName, oi.quantity, oi.unit_name AS unitName, oi.factor_to_base AS factorToBase,
        oi.unit_price AS unitPrice, oi.unit_cost AS unitCost, oi.line_total AS lineTotal, oi.line_cost AS lineCost, o.id AS orderId
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.table_session_id = ? AND o.state = 'served' AND oi.state = 'served' ORDER BY o.round_no, oi.created_at`,
      [req.params.sessionId],
    );
    for (const item of servedItems) {
      await connection.execute(
        `INSERT INTO sale_items (id, business_id, branch_id, sale_id, product_id, product_name, quantity, unit, factor_to_base, unit_price, unit_cost, line_total, line_cost)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.businessId, branchId, saleId, item.productId, item.productName, item.quantity, item.unitName, item.factorToBase, item.unitPrice, item.unitCost, item.lineTotal, item.lineCost],
      );
    }
    const [sessionPayments] = await connection.execute('SELECT id, method, reference, amount, user_id AS userId FROM table_session_payments WHERE table_session_id = ?', [req.params.sessionId]);
    for (const payment of sessionPayments) {
      await connection.execute('INSERT INTO sale_payments (id, business_id, branch_id, sale_id, user_id, method, reference, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [payment.id, req.user.businessId, branchId, saleId, payment.userId, payment.method, payment.reference, payment.amount]);
    }
    await connection.execute("UPDATE table_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?, sale_id = ? WHERE id = ?", [req.user.id, saleId, req.params.sessionId]);
    await connection.execute("UPDATE bar_tables SET status = 'available' WHERE id = ? AND business_id = ?", [session.tableId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'closed', module: 'table_sessions', recordId: req.params.sessionId, reference, details: { saleId, bill: moneyText(totals.billMinor), discount: moneyText(discountMinor), total: moneyText(totalMinor), paid: moneyText(totals.paidMinor), balance: moneyText(balanceMinor), rounds: servedItems.length } });
    return { id: saleId, reference, repeated: false };
  });
  res.status(sale.repeated ? 200 : 201).json({ sale });
}));

router.patch('/table-sessions/:sessionId/waiter', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const waiterId = req.body?.waiterId;
  if (typeof waiterId !== 'string') fail(400, 'Choose the employee taking responsibility for this table');
  const result = await withTransaction(async (connection) => {
    const [sessions] = await connection.execute("SELECT id, waiter_id AS waiterId FROM table_sessions WHERE id = ? AND business_id = ? AND status = 'open' FOR UPDATE", [req.params.sessionId, req.user.businessId]);
    if (!sessions.length) fail(404, 'This table session is closed or was not found');
    const [waiters] = await connection.execute('SELECT id, name FROM users WHERE id = ? AND business_id = ? AND active = 1', [waiterId, req.user.businessId]);
    if (!waiters.length) fail(400, 'The selected employee was not found');
    await connection.execute('UPDATE table_sessions SET waiter_id = ? WHERE id = ?', [waiterId, req.params.sessionId]);
    await writeAudit(connection, { businessId: req.user.businessId, userId: req.user.id, action: 'assigned', module: 'table_sessions', recordId: req.params.sessionId, details: { from: sessions[0].waiterId, to: waiterId } });
    return { id: req.params.sessionId, waiterId, waiterName: waiters[0].name };
  });
  res.json({ session: result });
}));

router.post('/table-sessions/:sessionId/transfer', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const reason = normalizeLabel(req.body?.reason, 'Reason', 500);
  const targetTableId = req.body?.targetTableId;
  if (typeof targetTableId !== 'string') fail(400, 'Choose the table this session moves to');
  const result = await withTransaction(async (connection) => {
    const [sessions] = await connection.execute("SELECT id, table_id AS tableId FROM table_sessions WHERE id = ? AND business_id = ? AND status = 'open' FOR UPDATE", [req.params.sessionId, req.user.businessId]);
    if (!sessions.length) fail(404, 'This table session is closed or was not found');
    if (sessions[0].tableId === targetTableId) fail(400, 'This session already belongs to that table');
    const [targets] = await connection.execute('SELECT id, code, status, active FROM bar_tables WHERE id = ? AND business_id = ? FOR UPDATE', [targetTableId, req.user.businessId]);
    if (!targets.length) fail(404, 'The target table was not found');
    if (!targets[0].active) fail(409, 'The target table is out of service');
    const [open] = await connection.execute("SELECT id FROM table_sessions WHERE table_id = ? AND business_id = ? AND status = 'open' LIMIT 1", [targetTableId, req.user.businessId]);
    if (open.length) fail(409, 'The target table already has an open session');
    const sourceTableId = sessions[0].tableId;
    await connection.execute('UPDATE table_sessions SET table_id = ? WHERE id = ?', [targetTableId, req.params.sessionId]);
    await connection.execute("UPDATE bar_tables SET status = 'available' WHERE id = ? AND business_id = ?", [sourceTableId, req.user.businessId]);
    await connection.execute("UPDATE bar_tables SET status = 'occupied' WHERE id = ? AND business_id = ?", [targetTableId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, userId: req.user.id, action: 'transferred', module: 'table_sessions', recordId: req.params.sessionId, details: { fromTableId: sourceTableId, toTableId: targetTableId, reason } });
    return { id: req.params.sessionId, tableId: targetTableId, tableCode: targets[0].code };
  });
  res.json({ session: result });
}));

router.post('/table-sessions/:sessionId/merge', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const reason = normalizeLabel(req.body?.reason, 'Reason', 500);
  const targetSessionId = req.body?.targetSessionId;
  if (typeof targetSessionId !== 'string') fail(400, 'Choose the session this table merges into');
  const result = await withTransaction(async (connection) => {
    const [sources] = await connection.execute("SELECT id, table_id AS tableId FROM table_sessions WHERE id = ? AND business_id = ? AND status = 'open' FOR UPDATE", [req.params.sessionId, req.user.businessId]);
    if (!sources.length) fail(404, 'The source table session is closed or was not found');
    const [targets] = await connection.execute("SELECT id, table_id AS tableId FROM table_sessions WHERE id = ? AND business_id = ? AND status = 'open' FOR UPDATE", [targetSessionId, req.user.businessId]);
    if (!targets.length) fail(404, 'The target table session is closed or was not found');
    if (req.params.sessionId === targetSessionId) fail(400, 'A session cannot merge into itself');
    if (sources[0].tableId === targets[0].tableId) fail(400, 'These sessions already belong to the same table');
    const sourceTableId = sources[0].tableId;
    const [targetRounds] = await connection.execute('SELECT COALESCE(MAX(round_no), 0) AS maxRound FROM orders WHERE table_session_id = ?', [targetSessionId]);
    await connection.execute('UPDATE orders SET round_no = round_no + ?, table_session_id = ? WHERE table_session_id = ?', [Number(targetRounds[0].maxRound), targetSessionId, req.params.sessionId]);
    await connection.execute('UPDATE table_session_payments SET table_session_id = ? WHERE table_session_id = ?', [targetSessionId, req.params.sessionId]);
    await connection.execute("UPDATE table_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE id = ?", [req.user.id, req.params.sessionId]);
    await connection.execute("UPDATE bar_tables SET status = 'available' WHERE id = ? AND business_id = ?", [sourceTableId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, userId: req.user.id, action: 'merged', module: 'table_sessions', recordId: targetSessionId, details: { mergedFrom: req.params.sessionId, reason } });
    return { id: targetSessionId, mergedFrom: req.params.sessionId };
  });
  res.json({ session: result });
}));

router.get('/held-sales', asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT h.id, h.label, h.held_by AS heldBy, u.name AS heldByName, h.created_at AS createdAt
     FROM held_sales h LEFT JOIN users u ON u.id = h.held_by
     WHERE h.business_id = ? ORDER BY h.created_at DESC LIMIT 50`,
    [req.user.businessId],
  );
  if (!items.length) return res.json({ items: [] });
  const placeholders = items.map(() => '?').join(',');
  const [lines] = await pool.execute(
    `SELECT held_sale_id AS heldSaleId, id, product_id AS productId, product_unit_id AS productUnitId, product_name AS productName, unit_name AS unitName, unit_price AS unitPrice, quantity
     FROM held_sale_items WHERE business_id = ? AND held_sale_id IN (${placeholders}) ORDER BY created_at`,
    [req.user.businessId, ...items.map((item) => item.id)],
  );
  res.json(jsonSafe({ items: items.map((item) => ({ ...item, items: lines.filter((line) => line.heldSaleId === item.id) })) }));
}));

router.post('/held-sales', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const label = normalizeLabel(req.body?.label, 'Label', 120);
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail(400, 'A held cart must include 1 to 100 product lines');
  const id = randomUUID();
  const held = await withTransaction(async (connection) => {
    const [branchRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]);
    const branchId = branchRows[0].branchId;
    await connection.execute('INSERT INTO held_sales (id, business_id, held_by, label) VALUES (?, ?, ?, ?)', [id, req.user.businessId, req.user.id, label]);
    for (const line of items) {
      const parsed = await loadProductLine(connection, req.user.businessId, branchId, line);
      await connection.execute(
        'INSERT INTO held_sale_items (id, business_id, held_sale_id, product_id, product_unit_id, product_name, unit_name, unit_price, quantity) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)',
        [req.user.businessId, id, parsed.id, parsed.unitId, parsed.name, parsed.unitName, parsed.sellingPrice, parsed.quantity],
      );
    }
    return { id, label, itemCount: items.length };
  });
  res.status(201).json({ held });
}));

router.delete('/held-sales/:heldSaleId', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  await withTransaction(async (connection) => {
    const [held] = await connection.execute('SELECT id, held_by AS heldBy FROM held_sales WHERE id = ? AND business_id = ? FOR UPDATE', [req.params.heldSaleId, req.user.businessId]);
    if (!held.length) fail(404, 'This held cart was not found');
    if (held[0].heldBy !== req.user.id && !['owner', 'manager'].includes(req.user.role)) fail(403, 'Only the holder or a manager can discard a held cart');
    await connection.execute('DELETE FROM held_sale_items WHERE held_sale_id = ?', [req.params.heldSaleId]);
    await connection.execute('DELETE FROM held_sales WHERE id = ?', [req.params.heldSaleId]);
    return true;
  });
  res.json({ discarded: true });
}));

router.get('/reports/tables', authorize('owner', 'manager', 'accountant'), asyncRoute(async (req, res) => {
  const [openTabs] = await pool.execute(
    `SELECT ts.id, ts.opened_at AS openedAt, ts.waiter_id AS waiterId, ww.name AS waiterName,
      t.code AS tableCode, t.name AS tableName, a.name AS areaName,
      COALESCE(bill.billTotal, 0) AS billTotal, COALESCE(pay.paidTotal, 0) AS paidTotal,
      COALESCE(bill.billTotal, 0) - COALESCE(pay.paidTotal, 0) AS balanceDue,
      COALESCE(bill.roundCount, 0) AS roundCount, TIMESTAMPDIFF(MINUTE, ts.opened_at, CURRENT_TIMESTAMP) AS minutesOpen
     FROM table_sessions ts
     JOIN bar_tables t ON t.id = ts.table_id
     LEFT JOIN bar_areas a ON a.id = t.area_id
     LEFT JOIN users ww ON ww.id = ts.waiter_id
     LEFT JOIN (${BILL_QUERY}) bill ON bill.sessionId = ts.id
     LEFT JOIN (${PAID_QUERY}) pay ON pay.sessionId = ts.id
     WHERE ts.business_id = ? AND ts.status = 'open' ORDER BY ts.opened_at`,
    [req.user.businessId],
  );
  const [salesByTable] = await pool.execute(
    `SELECT t.code AS tableCode, a.name AS areaName, COUNT(DISTINCT ts.id) AS sessionCount, COUNT(s.id) AS saleCount,
      COALESCE(SUM(s.total), 0) AS revenue, COALESCE(SUM(s.balance_due), 0) AS creditOutstanding
     FROM sales s JOIN table_sessions ts ON ts.id = s.table_session_id
     JOIN bar_tables t ON t.id = ts.table_id
     LEFT JOIN bar_areas a ON a.id = t.area_id
     WHERE s.business_id = ? GROUP BY t.code, a.name ORDER BY revenue DESC`,
    [req.user.businessId],
  );
  const [waiters] = await pool.execute(
    `SELECT ww.id, ww.name AS waiterName, COUNT(DISTINCT ts.id) AS sessionCount,
      COALESCE(served.roundCount, 0) AS roundsServed, COALESCE(rev.revenue, 0) AS revenue
     FROM table_sessions ts
     JOIN users ww ON ww.id = ts.waiter_id
     LEFT JOIN (SELECT table_session_id AS sid, COUNT(*) AS roundCount FROM orders WHERE state = 'served' GROUP BY table_session_id) served ON served.sid = ts.id
     LEFT JOIN (SELECT table_session_id AS sid, SUM(total) AS revenue FROM sales WHERE table_session_id IS NOT NULL GROUP BY table_session_id) rev ON rev.sid = ts.id
     WHERE ts.business_id = ? GROUP BY ww.id, ww.name ORDER BY revenue DESC`,
    [req.user.businessId],
  );
  const [turnover] = await pool.execute(
    `SELECT t.code AS tableCode, COUNT(ts.id) AS sessionCount, ROUND(AVG(TIMESTAMPDIFF(MINUTE, ts.opened_at, ts.closed_at)), 1) AS avgMinutes,
      COALESCE(SUM(s.total), 0) AS revenue
     FROM table_sessions ts
     JOIN bar_tables t ON t.id = ts.table_id
     LEFT JOIN sales s ON s.table_session_id = ts.id
     WHERE ts.business_id = ? AND ts.status = 'closed' GROUP BY t.code ORDER BY sessionCount DESC`,
    [req.user.businessId],
  );
  res.json(jsonSafe({ openTabs, salesByTable, waiterPerformance: waiters, tableTurnover: turnover }));
}));

export default router;
