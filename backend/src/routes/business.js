import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { asyncRoute, fail } from '../utils/errors.js';
import { fromMilliQuantity, fromMinor, multiplyMinorByQuantity, quantityToMilli, toMinor, toQuantity } from '../utils/money.js';

const router = Router();
router.use(authenticate);
const businessScope = (req) => [req.user.businessId];
const METHODS = ['cash', 'mobile_money', 'bank_transfer', 'card'];
const moneyText = (amount) => fromMinor(amount);
const signedMinor = (value, field = 'amount') => String(value ?? '').trim().startsWith('-')
  ? -toMinor(String(value).trim().slice(1), field)
  : toMinor(value, field);
const portionMinor = (amountMinor, quantityMilli, totalQuantityMilli) =>
  totalQuantityMilli === 0n ? 0n : (amountMinor * quantityMilli + totalQuantityMilli / 2n) / totalQuantityMilli;
function parseReturnPayments(payments) {
  if (!Array.isArray(payments) || payments.length > 4) fail(400, 'A return may have up to four settlement lines');
  return payments.map((payment) => {
    if (!METHODS.includes(payment?.method)) fail(400, 'Choose a supported payment method');
    const amount = toMinor(payment.amount, 'Settlement amount');
    if (amount <= 0n) fail(400, 'Settlement amounts must be greater than zero');
    return { method: payment.method, amount };
  });
}
function normalizeLabel(value, field, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${field} is required and must be ${max} characters or fewer`);
  return value.trim();
}
function nonNegativeQuantity(value, field) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(text)) fail(400, `${field} must be a non-negative quantity with up to three decimal places`);
  return text;
}

router.get('/products', asyncRoute(async (req, res) => {
  const search = typeof req.query.search === 'string' ? `%${req.query.search.trim().slice(0, 80)}%` : null;
  const [items] = await pool.execute(
    `SELECT p.id, p.name, p.sku,p.category_id AS categoryId,pc.name AS categoryName,p.base_unit AS baseUnit, p.selling_price AS sellingPrice, p.cost_price AS costPrice,
      p.low_stock_threshold AS lowStockThreshold, p.active, COALESCE(i.quantity, 0) AS stockQuantity
     FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.branch_id = p.branch_id
     LEFT JOIN product_categories pc ON pc.id=p.category_id AND pc.business_id=p.business_id
     WHERE p.business_id = ? AND p.active = 1 AND (? IS NULL OR p.name LIKE ? OR p.sku LIKE ?)
     ORDER BY p.name LIMIT 250`, [req.user.businessId, search, search, search],
  );
  res.json({ items });
}));

router.post('/products', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const { name, sku = null, categoryId = null, baseUnit = 'bottle', sellingPrice, costPrice, lowStockThreshold = '0' } = req.body || {};
  const label = normalizeLabel(name, 'Product name');
  const unit = normalizeLabel(baseUnit, 'Base unit', 40);
  const sell = moneyText(toMinor(sellingPrice, 'Selling price'));
  const cost = moneyText(toMinor(costPrice, 'Cost price'));
  const threshold = nonNegativeQuantity(lowStockThreshold, 'Low stock threshold');
  if (sku !== null && (typeof sku !== 'string' || sku.trim().length > 60)) fail(400, 'SKU must be 60 characters or fewer');
  const productId = randomUUID();
  const baseUnitId = randomUUID();
  const id = await withTransaction(async (connection) => {
    if (categoryId !== null) {
      if (typeof categoryId !== 'string') fail(400, 'Choose a valid product category');
      const [categories] = await connection.execute('SELECT id FROM product_categories WHERE id=? AND business_id=? AND archived_at IS NULL', [categoryId, req.user.businessId]);
      if (!categories.length) fail(400, 'The selected category is unavailable');
    }
    const [branches] = await connection.execute('SELECT id FROM branches WHERE business_id = ? ORDER BY created_at LIMIT 1', businessScope(req));
    if (!branches.length) fail(400, 'This business has no branch configured');
    const branchId = branches[0].id;
    await connection.execute(
      `INSERT INTO products (id, business_id, branch_id, category_id, name, sku, base_unit, selling_price, cost_price, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [productId, req.user.businessId, branchId, categoryId, label, sku?.trim() || null, unit, sell, cost, threshold],
    );
    await connection.execute('INSERT INTO inventory (id, business_id, branch_id, product_id, quantity) VALUES (UUID(), ?, ?, ?, 0)', [req.user.businessId, branchId, productId]);
    await connection.execute('INSERT INTO product_units (id, business_id, product_id, unit_name, factor_to_base, selling_price, purchase_price, is_base) VALUES (?, ?, ?, ?, 1, ?, ?, 1)', [baseUnitId, req.user.businessId, productId, unit, sell, cost]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'created', module: 'products', recordId: productId, details: { name: label, sku: sku?.trim() || null } });
    return productId;
  });
  const [rows] = await pool.execute('SELECT p.id,p.name,p.sku,p.category_id AS categoryId,pc.name AS categoryName,p.base_unit AS baseUnit,p.selling_price AS sellingPrice,p.cost_price AS costPrice,p.low_stock_threshold AS lowStockThreshold,0 AS stockQuantity FROM products p LEFT JOIN product_categories pc ON pc.id=p.category_id AND pc.business_id=p.business_id WHERE p.id=? AND p.business_id=?', [id, req.user.businessId]);
  res.status(201).json({ product: rows[0] });
}));

router.patch('/products/:productId', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const name = normalizeLabel(req.body?.name, 'Product name');
  const sku = req.body?.sku === '' ? null : req.body?.sku;
  if (sku !== null && (typeof sku !== 'string' || sku.trim().length > 60)) fail(400, 'SKU must be 60 characters or fewer');
  const categoryId = req.body?.categoryId || null;
  const sellingPrice = moneyText(toMinor(req.body?.sellingPrice, 'Selling price'));
  const threshold = nonNegativeQuantity(req.body?.lowStockThreshold, 'Low stock threshold');
  const result = await withTransaction(async (connection) => {
    const [products] = await connection.execute('SELECT id,branch_id AS branchId,category_id AS categoryId FROM products WHERE id=? AND business_id=? AND active=1 FOR UPDATE', [req.params.productId, req.user.businessId]);
    if (!products.length) fail(404, 'Product was not found');
    if (categoryId !== null) {
      if (typeof categoryId !== 'string') fail(400, 'Choose a valid product category');
      const [categories] = await connection.execute('SELECT id,archived_at AS archivedAt FROM product_categories WHERE id=? AND business_id=?', [categoryId, req.user.businessId]);
      if (!categories.length) fail(400, 'The selected category is unavailable');
      if (categories[0].archivedAt && products[0].categoryId !== categoryId) fail(400, 'The selected category is unavailable');
    }
    await connection.execute('UPDATE products SET name=?,sku=?,category_id=?,selling_price=?,low_stock_threshold=? WHERE id=? AND business_id=?', [name, sku?.trim() || null, categoryId, sellingPrice, threshold, req.params.productId, req.user.businessId]);
    await connection.execute('UPDATE product_units SET selling_price=? WHERE product_id=? AND business_id=? AND is_base=1', [sellingPrice, req.params.productId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId: products[0].branchId, userId: req.user.id, action: 'updated', module: 'products', recordId: req.params.productId, details: { name, sku: sku?.trim() || null, categoryId, sellingPrice, lowStockThreshold: threshold } });
    const [rows] = await connection.execute('SELECT p.id,p.name,p.sku,p.category_id AS categoryId,pc.name AS categoryName,p.base_unit AS baseUnit,p.selling_price AS sellingPrice,p.cost_price AS costPrice,p.low_stock_threshold AS lowStockThreshold,COALESCE(i.quantity,0) AS stockQuantity FROM products p LEFT JOIN product_categories pc ON pc.id=p.category_id AND pc.business_id=p.business_id LEFT JOIN inventory i ON i.product_id=p.id AND i.branch_id=p.branch_id WHERE p.id=? AND p.business_id=?', [req.params.productId, req.user.businessId]);
    return rows[0];
  });
  res.json({ product: result });
}));

router.get('/categories', asyncRoute(async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true' && ['owner', 'manager'].includes(req.user.role);
  const [items] = await pool.execute(
    `SELECT id,name,archived_at AS archivedAt,created_at AS createdAt FROM product_categories WHERE business_id=? AND (?=1 OR archived_at IS NULL) ORDER BY archived_at IS NOT NULL,name`,
    [req.user.businessId, includeArchived ? 1 : 0],
  );
  res.json({ items });
}));

router.post('/categories', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const name = normalizeLabel(req.body?.name, 'Category name', 100);
  const id = randomUUID();
  await withTransaction(async (connection) => {
    await connection.execute('INSERT INTO product_categories (id,business_id,name) VALUES (?,?,?)', [id, req.user.businessId, name]);
    await writeAudit(connection, { businessId: req.user.businessId, userId: req.user.id, action: 'created', module: 'categories', recordId: id, details: { name } });
  });
  res.status(201).json({ category: { id, name, archivedAt: null } });
}));

router.patch('/categories/:categoryId', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const name = normalizeLabel(req.body?.name, 'Category name', 100);
  if (typeof req.body?.archived !== 'boolean') fail(400, 'Provide an archived true/false value');
  const result = await withTransaction(async (connection) => {
    const [categories] = await connection.execute('SELECT id FROM product_categories WHERE id=? AND business_id=? FOR UPDATE', [req.params.categoryId, req.user.businessId]);
    if (!categories.length) fail(404, 'Category was not found');
    await connection.execute('UPDATE product_categories SET name=?,archived_at=? WHERE id=? AND business_id=?', [name, req.body.archived ? new Date() : null, req.params.categoryId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId: req.user.branchId || null, userId: req.user.id, action: req.body.archived ? 'archived' : 'updated', module: 'categories', recordId: req.params.categoryId, details: { name } });
    return { id: req.params.categoryId, name, archived: req.body.archived };
  });
  res.json({ category: result });
}));

router.get('/products/:productId/units', asyncRoute(async (req, res) => {
  const [items] = await pool.execute('SELECT id, unit_name AS unitName, factor_to_base AS factorToBase, selling_price AS sellingPrice, purchase_price AS purchasePrice, is_base AS isBase FROM product_units WHERE business_id = ? AND product_id = ? AND active = 1 ORDER BY is_base DESC, factor_to_base, unit_name', [req.user.businessId, req.params.productId]);
  res.json({ items });
}));

router.get('/pos/catalog', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const [products] = await pool.execute(
    `SELECT p.id,p.name,p.sku,p.category_id AS categoryId,pc.name AS categoryName,p.base_unit AS baseUnit,p.selling_price AS sellingPrice,p.cost_price AS costPrice,
      p.low_stock_threshold AS lowStockThreshold,COALESCE(i.quantity,0) AS stockQuantity
     FROM products p LEFT JOIN inventory i ON i.product_id=p.id AND i.branch_id=p.branch_id LEFT JOIN product_categories pc ON pc.id=p.category_id AND pc.business_id=p.business_id
     WHERE p.business_id=? AND p.active=1 ORDER BY p.name LIMIT 250`, businessScope(req),
  );
  if (!products.length) return res.json({ items: [] });
  const placeholders = products.map(() => '?').join(',');
  const [units] = await pool.execute(
    `SELECT id,product_id AS productId,unit_name AS unitName,factor_to_base AS factorToBase,selling_price AS sellingPrice,is_base AS isBase
     FROM product_units WHERE business_id=? AND active=1 AND product_id IN (${placeholders}) ORDER BY is_base DESC,factor_to_base`,
    [req.user.businessId, ...products.map((product) => product.id)],
  );
  const byProduct = new Map();
  for (const unit of units) byProduct.set(unit.productId, [...(byProduct.get(unit.productId) || []), unit]);
  res.json({ items: products.map((product) => ({ ...product, units: byProduct.get(product.id) || [] })) });
}));

router.post('/products/:productId/units', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const name = normalizeLabel(req.body?.unitName, 'Unit name', 40);
  const factor = toQuantity(req.body?.factorToBase, 'Base unit conversion');
  const sellingPrice = moneyText(toMinor(req.body?.sellingPrice, 'Selling price'));
  const purchasePrice = moneyText(toMinor(req.body?.purchasePrice, 'Purchase price'));
  const unitId = randomUUID();
  const result = await withTransaction(async (connection) => {
    const [products] = await connection.execute('SELECT id, branch_id AS branchId FROM products WHERE id = ? AND business_id = ? AND active = 1 FOR UPDATE', [req.params.productId, req.user.businessId]);
    if (!products.length) fail(404, 'Product was not found');
    await connection.execute('INSERT INTO product_units (id, business_id, product_id, unit_name, factor_to_base, selling_price, purchase_price) VALUES (?, ?, ?, ?, ?, ?, ?)', [unitId, req.user.businessId, req.params.productId, name, factor, sellingPrice, purchasePrice]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId: products[0].branchId, userId: req.user.id, action: 'created', module: 'product_units', recordId: unitId, details: { productId: req.params.productId, unitName: name, factorToBase: factor, sellingPrice, purchasePrice } });
    return { id: unitId, unitName: name, factorToBase: factor, sellingPrice, purchasePrice, isBase: 0 };
  });
  res.status(201).json({ unit: result });
}));

router.patch('/products/:productId/units/:unitId', authorize('owner', 'manager'), asyncRoute(async (req, res) => {
  const result = await withTransaction(async (connection) => {
    const [units] = await connection.execute(
      `SELECT pu.id, pu.unit_name AS unitName, pu.factor_to_base AS factorToBase, pu.selling_price AS sellingPrice, pu.purchase_price AS purchasePrice, pu.is_base AS isBase, pu.active, p.branch_id AS branchId
       FROM product_units pu JOIN products p ON p.id = pu.product_id
       WHERE pu.id = ? AND pu.business_id = ? AND pu.product_id = ? FOR UPDATE`,
      [req.params.unitId, req.user.businessId, req.params.productId],
    );
    if (!units.length) fail(404, 'This product unit was not found');
    const current = units[0];
    const next = {
      unitName: req.body?.unitName !== undefined ? normalizeLabel(req.body.unitName, 'Unit name', 40) : current.unitName,
      factorToBase: req.body?.factorToBase !== undefined ? toQuantity(req.body.factorToBase, 'Base unit conversion') : current.factorToBase,
      sellingPrice: req.body?.sellingPrice !== undefined ? moneyText(toMinor(req.body.sellingPrice, 'Selling price')) : current.sellingPrice,
      purchasePrice: req.body?.purchasePrice !== undefined ? moneyText(toMinor(req.body.purchasePrice, 'Purchase price')) : current.purchasePrice,
      active: req.body?.active !== undefined ? (req.body.active ? 1 : 0) : Number(current.active),
    };
    if (Number(current.isBase) === 1) {
      if (next.unitName !== current.unitName || String(next.factorToBase) !== String(current.factorToBase)) fail(400, 'The base stock unit is fixed once transactions exist. Add a new unit for a different packing size.');
      if (!next.active) fail(400, 'The base stock unit cannot be disabled');
    }
    await connection.execute('UPDATE product_units SET unit_name = ?, factor_to_base = ?, selling_price = ?, purchase_price = ?, active = ? WHERE id = ? AND business_id = ?', [next.unitName, next.factorToBase, next.sellingPrice, next.purchasePrice, next.active, req.params.unitId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId: current.branchId, userId: req.user.id, action: 'updated', module: 'product_units', recordId: req.params.unitId, details: { productId: req.params.productId, before: { unitName: current.unitName, factorToBase: current.factorToBase, sellingPrice: current.sellingPrice, purchasePrice: current.purchasePrice }, after: next } });
    return { id: req.params.unitId, ...next, isBase: current.isBase };
  });
  res.json({ unit: result });
}));

router.post('/inventory/:productId/adjustments', authorize('owner', 'manager', 'storekeeper'), asyncRoute(async (req, res) => {
  const quantity = toQuantity(req.body?.quantity, 'Adjustment quantity', true);
  const notes = normalizeLabel(req.body?.notes, 'Reason', 500);
  const movement = await withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT p.id, p.branch_id AS branchId, i.quantity FROM products p JOIN inventory i ON i.product_id = p.id AND i.branch_id = p.branch_id
       WHERE p.id = ? AND p.business_id = ? AND p.active = 1 FOR UPDATE`, [req.params.productId, req.user.businessId],
    );
    if (!rows.length) fail(404, 'Product was not found');
    const current = quantityToMilli(rows[0].quantity); const delta = quantityToMilli(quantity); const next = current + delta;
    if (next < 0n) fail(409, 'This adjustment would leave negative stock');
    await connection.execute('UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND branch_id = ?', [fromMilliQuantity(next), req.params.productId, rows[0].branchId]);
    await connection.execute(
      `INSERT INTO stock_movements (id, business_id, branch_id, product_id, user_id, movement_type, quantity_delta, unit, reference_type, notes)
       VALUES (UUID(), ?, ?, ?, ?, 'adjustment', ?, (SELECT base_unit FROM products WHERE id = ?), 'manual_adjustment', ?)`,
      [req.user.businessId, rows[0].branchId, req.params.productId, req.user.id, quantity, req.params.productId, notes],
    );
    await writeAudit(connection, { businessId: req.user.businessId, branchId: rows[0].branchId, userId: req.user.id, action: 'adjusted', module: 'inventory', recordId: req.params.productId, details: { delta: quantity, reason: notes } });
    return { previous: fromMilliQuantity(current), quantity: fromMilliQuantity(next) };
  });
  res.status(201).json({ movement });
}));

router.get('/suppliers', asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT s.id, s.name, s.phone, s.email, s.address, COALESCE(SUM(p.balance_due),0) AS balanceDue
     FROM suppliers s LEFT JOIN purchases p ON p.supplier_id=s.id AND p.business_id=s.business_id AND p.status='received'
     WHERE s.business_id=? AND s.active=1 GROUP BY s.id ORDER BY s.name LIMIT 250`, businessScope(req),
  );
  res.json({ items });
}));

router.post('/suppliers', authorize('owner', 'manager', 'accountant'), asyncRoute(async (req, res) => {
  const name = normalizeLabel(req.body?.name, 'Supplier name');
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 40) || null : null;
  const email = typeof req.body?.email === 'string' && req.body.email.trim() ? req.body.email.trim().slice(0, 190) : null;
  const address = typeof req.body?.address === 'string' ? req.body.address.trim().slice(0, 255) || null : null;
  const supplierId = randomUUID();
  await pool.execute('INSERT INTO suppliers (id, business_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)', [supplierId, req.user.businessId, name, phone, email, address]);
  res.status(201).json({ supplier: { id: supplierId, name, phone, email, address, balanceDue: '0.00' } });
}));

router.get('/purchases', asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT p.id, p.reference, p.total, p.amount_paid AS amountPaid, p.balance_due AS balanceDue, p.created_at AS createdAt,
      s.name AS supplierName FROM purchases p JOIN suppliers s ON s.id=p.supplier_id AND s.business_id=p.business_id
     WHERE p.business_id=? ORDER BY p.created_at DESC LIMIT 100`, businessScope(req),
  );
  res.json({ items });
}));

router.post('/purchases', authorize('owner', 'manager', 'storekeeper', 'accountant'), asyncRoute(async (req, res) => {
  const { supplierId, items, payments = [] } = req.body || {};
  if (typeof supplierId !== 'string') fail(400, 'Choose a supplier');
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail(400, 'A purchase must include 1 to 100 product lines');
  if (!Array.isArray(payments) || payments.length > 4) fail(400, 'A purchase may have up to four payment lines');
  const purchaseId = randomUUID();
  const purchase = await withTransaction(async (connection) => {
    const [supplierRows] = await connection.execute('SELECT id FROM suppliers WHERE id=? AND business_id=? AND active=1 FOR UPDATE', [supplierId, req.user.businessId]);
    if (!supplierRows.length) fail(404, 'Supplier was not found');
    const [userRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id=? AND business_id=?', [req.user.id, req.user.businessId]);
    const branchId = userRows[0].branchId;
    const parsed = [];
    let totalMinor = 0n;
    for (const line of items) {
      if (typeof line.productId !== 'string') fail(400, 'Every purchase line needs a product');
      const quantity = toQuantity(line.quantity, 'Quantity');
      const [unitRows] = await connection.execute(
        `SELECT p.id, p.name, p.base_unit AS baseUnit, p.cost_price AS costPrice, i.quantity AS stockQuantity,
          pu.id AS unitId, pu.unit_name AS unitName, pu.factor_to_base AS factorToBase, pu.purchase_price AS purchasePrice
         FROM products p JOIN inventory i ON i.product_id=p.id AND i.branch_id=p.branch_id
         JOIN product_units pu ON pu.product_id=p.id AND pu.business_id=p.business_id AND pu.active=1
         WHERE p.id=? AND p.business_id=? AND p.branch_id=? AND p.active=1 FOR UPDATE`, [line.productId, req.user.businessId, branchId],
      );
      const unit = unitRows.find((row) => line.unitId ? row.unitId === line.unitId : Number(row.factorToBase) === 1 && row.unitName === row.baseUnit);
      if (!unit) fail(404, line.unitId ? 'The selected product unit was not found' : 'A selected product was not found');
      const unitCost = line.unitCost === undefined ? unit.purchasePrice : moneyText(toMinor(line.unitCost, 'Unit purchase price'));
      const baseQtyMilli = (quantityToMilli(quantity) * quantityToMilli(unit.factorToBase) + 500n) / 1000n;
      if (baseQtyMilli <= 0n) fail(400, 'Converted purchase quantity must be greater than zero');
      const lineTotal = multiplyMinorByQuantity(unitCost, quantity);
      totalMinor += lineTotal;
      parsed.push({ ...unit, quantity, baseQuantity: fromMilliQuantity(baseQtyMilli), baseQtyMilli, unitCost, lineTotal: moneyText(lineTotal) });
    }
    const paymentLines = payments.map((payment) => {
      if (!METHODS.includes(payment.method)) fail(400, 'Choose a supported payment method');
      const amount = toMinor(payment.amount, 'Payment amount');
      if (amount <= 0n) fail(400, 'Payment amounts must be greater than zero');
      return { method: payment.method, amount };
    });
    const paidMinor = paymentLines.reduce((sum, payment) => sum + payment.amount, 0n);
    if (paidMinor > totalMinor) fail(400, 'Payment total cannot exceed the purchase total');
    const balanceMinor = totalMinor - paidMinor;
    const [cashSessions] = await connection.execute('SELECT id FROM cash_sessions WHERE business_id=? AND user_id=? AND status=\'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (paymentLines.some((payment) => payment.method === 'cash') && !cashSessions.length) fail(409, 'Open a cash session before recording cash paid to a supplier');
    await connection.execute(
      `INSERT INTO purchases (id,business_id,branch_id,supplier_id,user_id,reference,status,subtotal,total,amount_paid,balance_due)
       VALUES (?,?,?, ?, ?, CONCAT('P-',UPPER(SUBSTRING(REPLACE(UUID(),'-',''),1,12))),'received',?,?,?,?)`,
      [purchaseId, req.user.businessId, branchId, supplierId, req.user.id, moneyText(totalMinor), moneyText(totalMinor), moneyText(paidMinor), moneyText(balanceMinor)],
    );
    const [references] = await connection.execute('SELECT reference FROM purchases WHERE id=? AND business_id=?', [purchaseId, req.user.businessId]);
    for (const line of parsed) {
      await connection.execute(
        `INSERT INTO purchase_items (id,business_id,branch_id,purchase_id,product_id,product_name,quantity,unit,factor_to_base,base_quantity,unit_cost,line_total)
         VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?)`,
        [req.user.businessId, branchId, purchaseId, line.id, line.name, line.quantity, line.unitName, line.factorToBase, line.baseQuantity, line.unitCost, line.lineTotal],
      );
      const previousQty = quantityToMilli(line.stockQuantity); const nextQty = previousQty + line.baseQtyMilli;
      const oldCostMinor = toMinor(line.costPrice);
      const incomingTotalMinor = toMinor(line.lineTotal);
      const weightedCostMinor = nextQty === 0n ? oldCostMinor : (previousQty * oldCostMinor + incomingTotalMinor * 1000n + nextQty / 2n) / nextQty;
      const newCost = moneyText(weightedCostMinor);
      await connection.execute('UPDATE inventory SET quantity=?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND branch_id=?', [fromMilliQuantity(nextQty), line.id, branchId]);
      await connection.execute('UPDATE products SET cost_price=? WHERE id=? AND business_id=?', [newCost, line.id, req.user.businessId]);
      await connection.execute('UPDATE product_units SET purchase_price=? WHERE product_id=? AND business_id=? AND is_base=1', [newCost, line.id, req.user.businessId]);
      await connection.execute(
        `INSERT INTO stock_movements (id,business_id,branch_id,product_id,user_id,movement_type,quantity_delta,unit,reference_type,reference_id,notes)
         VALUES (UUID(),?,?,?,?, 'purchase', ?, ?, 'purchase', ?, ?)`,
        [req.user.businessId, branchId, line.id, req.user.id, line.baseQuantity, line.baseUnit, purchaseId, references[0].reference],
      );
    }
    for (const payment of paymentLines) {
      const paymentId = randomUUID();
      await connection.execute('INSERT INTO purchase_payments (id,business_id,branch_id,purchase_id,user_id,method,amount) VALUES (?,?,?,?,?,?,?)', [paymentId, req.user.businessId, branchId, purchaseId, req.user.id, payment.method, moneyText(payment.amount)]);
      if (payment.method === 'cash') await connection.execute('INSERT INTO cash_movements (id,business_id,branch_id,session_id,user_id,movement_type,direction,amount,reference_type,reference_id,notes) VALUES (?,?,?,?,?,\'expense\',\'out\',?,\'purchase\',?,?)', [req.user.businessId, branchId, cashSessions[0].id, req.user.id, moneyText(payment.amount), purchaseId, `Supplier purchase ${references[0].reference}`]);
    }
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'received', module: 'purchases', recordId: purchaseId, reference: references[0].reference, details: { supplierId, total: moneyText(totalMinor), paid: moneyText(paidMinor), balance: moneyText(balanceMinor), lines: parsed.length } });
    return { id: purchaseId, reference: references[0].reference, total: moneyText(totalMinor), amountPaid: moneyText(paidMinor), balanceDue: moneyText(balanceMinor), status: 'received' };
  });
  res.status(201).json({ purchase });
}));

router.get('/purchases/:purchaseId', asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.id,p.reference,p.status,p.total,p.amount_paid AS amountPaid,p.balance_due AS balanceDue,p.created_at AS createdAt,
      s.id AS supplierId,s.name AS supplierName FROM purchases p JOIN suppliers s ON s.id=p.supplier_id AND s.business_id=p.business_id
     WHERE p.id=? AND p.business_id=? LIMIT 1`, [req.params.purchaseId, req.user.businessId],
  );
  if (!rows.length) fail(404, 'Purchase was not found');
  const [items] = await pool.execute(
    `SELECT pi.id,pi.product_id AS productId,pi.product_name AS productName,pi.quantity,pi.unit,pi.factor_to_base AS factorToBase,
      pi.unit_cost AS unitCost,pi.line_total AS lineTotal,COALESCE(r.returnedQuantity,0) AS returnedQuantity,COALESCE(r.returnedTotal,0) AS returnedTotal
     FROM purchase_items pi LEFT JOIN (SELECT purchase_item_id,SUM(quantity) AS returnedQuantity,SUM(line_total) AS returnedTotal FROM purchase_return_items WHERE business_id=? GROUP BY purchase_item_id) r ON r.purchase_item_id=pi.id
     WHERE pi.purchase_id=? AND pi.business_id=? ORDER BY pi.created_at`, [req.user.businessId, req.params.purchaseId, req.user.businessId],
  );
  const [returns] = await pool.execute('SELECT id,reference,total,payable_credit AS payableCredit,refund_received AS refundReceived,reason,created_at AS createdAt FROM purchase_returns WHERE purchase_id=? AND business_id=? ORDER BY created_at DESC', [req.params.purchaseId, req.user.businessId]);
  res.json({ purchase: { ...rows[0], items, returns } });
}));

router.post('/purchases/:purchaseId/returns', authorize('owner', 'manager', 'storekeeper', 'accountant'), asyncRoute(async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || key.length < 8 || key.length > 120) fail(400, 'A unique Idempotency-Key is required for each purchase return');
  const { items, payments = [], reason = null } = req.body || {};
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail(400, 'A purchase return must include 1 to 100 product lines');
  if (items.some((line) => typeof line.purchaseItemId !== 'string') || new Set(items.map((line) => line.purchaseItemId)).size !== items.length) fail(400, 'Each purchase return line must identify a unique purchase item');
  const paymentLines = parseReturnPayments(payments);
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) || null : null;
  const result = await withTransaction(async (connection) => {
    const [repeated] = await connection.execute('SELECT id,reference,total,payable_credit AS payableCredit,refund_received AS refundReceived,purchase_id AS purchaseId FROM purchase_returns WHERE business_id=? AND idempotency_key=?', [req.user.businessId, key]);
    if (repeated.length) {
      if (repeated[0].purchaseId !== req.params.purchaseId) fail(409, 'That idempotency key was used for a different purchase return');
      return { ...repeated[0], repeated: true };
    }
    const [purchaseRows] = await connection.execute('SELECT id,branch_id AS branchId,reference,balance_due AS balanceDue,status FROM purchases WHERE id=? AND business_id=? FOR UPDATE', [req.params.purchaseId, req.user.businessId]);
    if (!purchaseRows.length || purchaseRows[0].status !== 'received') fail(404, 'Received purchase was not found');
    const purchase = purchaseRows[0];
    const [userRows] = await connection.execute('SELECT name FROM users WHERE id=? AND business_id=?', [req.user.id, req.user.businessId]);
    if (!userRows.length) fail(401, 'The signed-in account is no longer available');
    const parsed = [];
    let totalMinor = 0n;
    for (const line of items) {
      const quantity = toQuantity(line.quantity, 'Return quantity');
      const [sourceRows] = await connection.execute(
        `SELECT pi.id,pi.product_id AS productId,pi.product_name AS productName,pi.quantity,pi.unit,pi.factor_to_base AS factorToBase,
          pi.unit_cost AS unitCost,pi.line_total AS lineTotal,pr.base_unit AS baseUnit,pr.cost_price AS currentCost,i.quantity AS stockQuantity
         FROM purchase_items pi JOIN products pr ON pr.id=pi.product_id AND pr.business_id=pi.business_id
         JOIN inventory i ON i.product_id=pi.product_id AND i.branch_id=pi.branch_id
         WHERE pi.id=? AND pi.purchase_id=? AND pi.business_id=? FOR UPDATE`, [line.purchaseItemId, purchase.id, req.user.businessId],
      );
      if (!sourceRows.length) fail(404, 'A returned item was not part of this purchase');
      const source = sourceRows[0];
      const [priorRows] = await connection.execute('SELECT COALESCE(SUM(quantity),0) AS returnedQuantity,COALESCE(SUM(line_total),0) AS returnedTotal FROM purchase_return_items WHERE business_id=? AND purchase_item_id=?', [req.user.businessId, source.id]);
      const sourceQty = quantityToMilli(source.quantity); const alreadyQty = quantityToMilli(priorRows[0].returnedQuantity); const requestedQty = quantityToMilli(quantity);
      if (requestedQty > sourceQty - alreadyQty) fail(409, `Return quantity exceeds the remaining purchased quantity for ${source.productName}`);
      const factorMilli = quantityToMilli(source.factorToBase); const baseQtyMilli = (requestedQty * factorMilli + 500n) / 1000n;
      const sourceBaseQty = (sourceQty * factorMilli + 500n) / 1000n;
      if (baseQtyMilli <= 0n) fail(400, 'Converted return quantity must be greater than zero');
      const stockMilli = quantityToMilli(source.stockQuantity);
      if (baseQtyMilli > stockMilli) fail(409, `Not enough current stock to return ${source.productName} to the supplier`);
      const remainingSourceQty = sourceQty - alreadyQty;
      const remainingTotal = toMinor(source.lineTotal) - toMinor(priorRows[0].returnedTotal);
      const lineTotal = requestedQty === remainingSourceQty ? remainingTotal : portionMinor(toMinor(source.lineTotal), requestedQty, sourceQty);
      const lineBaseQuantity = fromMilliQuantity(baseQtyMilli);
      totalMinor += lineTotal;
      parsed.push({ ...source, quantity, requestedQty, baseQuantity: lineBaseQuantity, baseQtyMilli, sourceBaseQty, lineTotal: moneyText(lineTotal), remainingStockMilli: stockMilli });
    }
    if (totalMinor <= 0n) fail(400, 'The return total must be greater than zero');
    const payableMinor = toMinor(purchase.balanceDue) < totalMinor ? toMinor(purchase.balanceDue) : totalMinor;
    const refundMinor = totalMinor - payableMinor;
    const paymentTotal = paymentLines.reduce((sum, payment) => sum + payment.amount, 0n);
    if (paymentTotal !== refundMinor) fail(400, `Supplier refund receipts must total ${moneyText(refundMinor)}`);
    const [sessions] = await connection.execute('SELECT id FROM cash_sessions WHERE business_id=? AND user_id=? AND status=\'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (paymentLines.some((payment) => payment.method === 'cash') && !sessions.length) fail(409, 'Open a cash session before recording a cash refund from the supplier');
    const returnId = randomUUID();
    await connection.execute(
      `INSERT INTO purchase_returns (id,business_id,branch_id,purchase_id,user_id,reference,idempotency_key,total,payable_credit,refund_received,reason)
       VALUES (?,?,?, ?, ?, CONCAT('PR-',UPPER(SUBSTRING(REPLACE(UUID(),'-',''),1,12))),?,?,?,?,?)`,
      [returnId, req.user.businessId, purchase.branchId, purchase.id, req.user.id, key, moneyText(totalMinor), moneyText(payableMinor), moneyText(refundMinor), cleanReason],
    );
    const [referenceRows] = await connection.execute('SELECT reference FROM purchase_returns WHERE id=? AND business_id=?', [returnId, req.user.businessId]);
    for (const line of parsed) {
      await connection.execute(
        `INSERT INTO purchase_return_items (id,business_id,branch_id,return_id,purchase_item_id,product_id,product_name,quantity,unit,factor_to_base,base_quantity,unit_cost,line_total)
         VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.user.businessId, purchase.branchId, returnId, line.id, line.productId, line.productName, line.quantity, line.unit, line.factorToBase, line.baseQuantity, line.unitCost, line.lineTotal],
      );
      const nextStock = line.remainingStockMilli - line.baseQtyMilli;
      await connection.execute('UPDATE inventory SET quantity=?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND branch_id=?', [fromMilliQuantity(nextStock), line.productId, purchase.branchId]);
      await connection.execute(
        `INSERT INTO stock_movements (id,business_id,branch_id,product_id,user_id,movement_type,quantity_delta,unit,reference_type,reference_id,notes)
         VALUES (UUID(),?,?,?,?, 'purchase_return', -CAST(? AS DECIMAL(14,3)), ?, 'purchase_return', ?, ?)`,
        [req.user.businessId, purchase.branchId, line.productId, req.user.id, line.baseQuantity, line.baseUnit, returnId, referenceRows[0].reference],
      );
    }
    await connection.execute('UPDATE purchases SET balance_due=balance_due-? WHERE id=? AND business_id=?', [moneyText(payableMinor), purchase.id, req.user.businessId]);
    for (const payment of paymentLines) {
      await connection.execute('INSERT INTO purchase_return_payments (id,business_id,branch_id,return_id,user_id,method,amount) VALUES (UUID(),?,?,?,?,?,?)', [req.user.businessId, purchase.branchId, returnId, req.user.id, payment.method, moneyText(payment.amount)]);
      if (payment.method === 'cash') await connection.execute('INSERT INTO cash_movements (id,business_id,branch_id,session_id,user_id,movement_type,direction,amount,reference_type,reference_id,notes) VALUES (UUID(),?,?,?,?,\'deposit\',\'in\',?,\'purchase_return\',?,?)', [req.user.businessId, purchase.branchId, sessions[0].id, req.user.id, moneyText(payment.amount), returnId, `Supplier return ${referenceRows[0].reference}`]);
    }
    await writeAudit(connection, { businessId: req.user.businessId, branchId: purchase.branchId, userId: req.user.id, action: 'returned', module: 'purchase_returns', recordId: returnId, reference: referenceRows[0].reference, details: { purchaseId: purchase.id, total: moneyText(totalMinor), payableCredit: moneyText(payableMinor), refundReceived: moneyText(refundMinor), lines: parsed.length } });
    return { id: returnId, reference: referenceRows[0].reference, total: moneyText(totalMinor), payableCredit: moneyText(payableMinor), refundReceived: moneyText(refundMinor), balanceDue: moneyText(toMinor(purchase.balanceDue) - payableMinor), repeated: false };
  });
  res.status(result.repeated ? 200 : 201).json({ purchaseReturn: result });
}));

router.post('/suppliers/:supplierId/payments', authorize('owner', 'manager', 'accountant'), asyncRoute(async (req, res) => {
  const amount = toMinor(req.body?.amount, 'Payment amount'); const method = req.body?.method;
  if (amount <= 0n || !METHODS.includes(method)) fail(400, 'Provide a positive payment and supported payment method');
  const paymentId = randomUUID();
  const payment = await withTransaction(async (connection) => {
    const [suppliers] = await connection.execute('SELECT id FROM suppliers WHERE id=? AND business_id=? AND active=1 FOR UPDATE', [req.params.supplierId, req.user.businessId]);
    if (!suppliers.length) fail(404, 'Supplier was not found');
    const [debts] = await connection.execute('SELECT id,balance_due AS balanceDue FROM purchases WHERE business_id=? AND supplier_id=? AND status=\'received\' AND balance_due>0 ORDER BY created_at,id FOR UPDATE', [req.user.businessId, req.params.supplierId]);
    const outstanding = debts.reduce((sum, debt) => sum + toMinor(debt.balanceDue), 0n);
    if (amount > outstanding) fail(400, 'Payment cannot exceed the outstanding supplier balance');
    const [users] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id=? AND business_id=?', [req.user.id, req.user.businessId]); const branchId = users[0].branchId;
    const [sessions] = await connection.execute('SELECT id FROM cash_sessions WHERE business_id=? AND user_id=? AND status=\'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (method === 'cash' && !sessions.length) fail(409, 'Open a cash session before making a cash supplier payment');
    let remaining = amount; const allocations = [];
    for (const debt of debts) {
      if (remaining === 0n) break;
      const balance = toMinor(debt.balanceDue); const applied = remaining < balance ? remaining : balance;
      await connection.execute('UPDATE purchases SET amount_paid=amount_paid+?,balance_due=balance_due-? WHERE id=? AND business_id=?', [moneyText(applied), moneyText(applied), debt.id, req.user.businessId]);
      allocations.push({ purchaseId: debt.id, amount: moneyText(applied) }); remaining -= applied;
    }
    await connection.execute('INSERT INTO supplier_payments (id,business_id,branch_id,supplier_id,user_id,method,amount) VALUES (?,?,?,?,?,?,?)', [paymentId, req.user.businessId, branchId, req.params.supplierId, req.user.id, method, moneyText(amount)]);
    for (const allocation of allocations) await connection.execute('INSERT INTO supplier_payment_allocations (id,business_id,payment_id,purchase_id,amount) VALUES (UUID(),?,?,?,?)', [req.user.businessId, paymentId, allocation.purchaseId, allocation.amount]);
    if (method === 'cash') await connection.execute('INSERT INTO cash_movements (id,business_id,branch_id,session_id,user_id,movement_type,direction,amount,reference_type,reference_id,notes) VALUES (?,?,?,?,?,\'expense\',\'out\',?,\'supplier_payment\',?,\'Supplier balance payment\')', [req.user.businessId, branchId, sessions[0].id, req.user.id, moneyText(amount), paymentId]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'recorded', module: 'supplier_payments', recordId: paymentId, details: { supplierId: req.params.supplierId, amount: moneyText(amount), method, allocations } });
    return { id: paymentId, amount: moneyText(amount), allocations, balanceDue: moneyText(outstanding - amount) };
  });
  res.status(201).json({ payment });
}));

router.get('/customers', asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT c.id,c.full_name AS name,c.phone,COALESCE(SUM(s.balance_due),0) AS balanceDue
     FROM customers c LEFT JOIN sales s ON s.customer_id=c.id AND s.business_id=c.business_id AND s.status IN ('completed','partially_returned')
     WHERE c.business_id=? AND c.active=1 GROUP BY c.id ORDER BY c.full_name LIMIT 250`, businessScope(req),
  );
  res.json({ items });
}));

router.get('/customers/:customerId/sales', asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT id,reference,total,amount_paid AS amountPaid,balance_due AS balanceDue,created_at AS createdAt,status
     FROM sales WHERE business_id=? AND customer_id=? ORDER BY created_at DESC LIMIT 100`, [req.user.businessId, req.params.customerId],
  );
  res.json({ items });
}));

router.post('/customers', authorize('owner', 'manager', 'cashier', 'accountant'), asyncRoute(async (req, res) => {
  const name = normalizeLabel(req.body?.name, 'Customer name'); const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 40) || null : null;
  const id = randomUUID();
  await pool.execute('INSERT INTO customers (id, business_id, full_name, phone) VALUES (?, ?, ?, ?)', [id, req.user.businessId, name, phone]);
  res.status(201).json({ customer: { id, name, phone } });
}));

router.get('/sales', asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT s.id, s.reference, s.status, s.total, s.amount_paid AS amountPaid, s.balance_due AS balanceDue, s.created_at AS createdAt,
      s.sales_channel AS salesChannel, t.code AS tableCode, a.name AS areaName,
      COALESCE(c.full_name, CASE WHEN s.sales_channel = 'TABLE' THEN CONCAT('Table ', t.code) ELSE 'Walk-in customer' END) AS customerName,
      CASE WHEN s.balance_due > 0 THEN 'part-paid' ELSE 'paid' END AS paymentStatus,
      COALESCE(r.returnedTotal,0) AS returnedTotal
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN table_sessions ts ON ts.id = s.table_session_id AND ts.business_id = s.business_id
     LEFT JOIN bar_tables t ON t.id = ts.table_id
     LEFT JOIN bar_areas a ON a.id = t.area_id
     LEFT JOIN (SELECT sale_id,SUM(total) AS returnedTotal FROM sales_returns WHERE business_id=? GROUP BY sale_id) r ON r.sale_id=s.id
     WHERE s.business_id = ? ORDER BY s.created_at DESC LIMIT 100`, [req.user.businessId, req.user.businessId],
  );
  res.json({ items });
}));

router.get('/sales/:saleId', asyncRoute(async (req, res) => {
  const [sales] = await pool.execute(
    `SELECT s.id,s.reference,s.status,s.subtotal,s.discount_amount AS discountAmount,s.tax_amount AS taxAmount,s.total,
      s.amount_paid AS amountPaid,s.balance_due AS balanceDue,s.created_at AS createdAt,s.sales_channel AS salesChannel,
      COALESCE(c.full_name,'Walk-in customer') AS customerName,
      ts.id AS tableSessionId,t.code AS tableCode,t.name AS tableName,a.name AS areaName,
      u.name AS cashierName FROM sales s LEFT JOIN customers c ON c.id=s.customer_id AND c.business_id=s.business_id
      LEFT JOIN table_sessions ts ON ts.id=s.table_session_id AND ts.business_id=s.business_id
      LEFT JOIN bar_tables t ON t.id=ts.table_id
      LEFT JOIN bar_areas a ON a.id=t.area_id
      JOIN users u ON u.id=s.cashier_id AND u.business_id=s.business_id WHERE s.id=? AND s.business_id=? LIMIT 1`, [req.params.saleId, req.user.businessId],
  );
  if (!sales.length) fail(404, 'Sale was not found');
  const [items] = await pool.execute(
    `SELECT si.id,si.product_id AS productId,si.product_name AS productName,si.quantity,si.unit,si.factor_to_base AS factorToBase,
      si.unit_price AS unitPrice,si.unit_cost AS unitCost,si.line_total AS lineTotal,si.line_cost AS lineCost,
      COALESCE(r.returnedQuantity,0) AS returnedQuantity,COALESCE(r.returnedTotal,0) AS returnedTotal
     FROM sale_items si LEFT JOIN (SELECT sale_item_id,SUM(quantity) AS returnedQuantity,SUM(line_total) AS returnedTotal FROM sales_return_items WHERE business_id=? GROUP BY sale_item_id) r ON r.sale_item_id=si.id
     WHERE si.sale_id=? AND si.business_id=? ORDER BY si.created_at`, [req.user.businessId, req.params.saleId, req.user.businessId],
  );
  const [payments] = await pool.execute('SELECT method,amount,created_at AS createdAt FROM sale_payments WHERE sale_id=? AND business_id=? ORDER BY created_at', [req.params.saleId, req.user.businessId]);
  const [returns] = await pool.execute('SELECT id,reference,total,credit_applied AS creditApplied,refund_amount AS refundAmount,reason,created_at AS createdAt FROM sales_returns WHERE sale_id=? AND business_id=? ORDER BY created_at DESC', [req.params.saleId, req.user.businessId]);
  const [refunds] = await pool.execute('SELECT COALESCE(SUM(amount),0) AS amount FROM sales_return_payments WHERE business_id=? AND return_id IN (SELECT id FROM sales_returns WHERE sale_id=? AND business_id=?)', [req.user.businessId, req.params.saleId, req.user.businessId]);
  res.json({ sale: { ...sales[0], items, payments, returns, refundedAmount: refunds[0].amount } });
}));

router.post('/sales/:saleId/returns', authorize('owner', 'manager', 'accountant'), asyncRoute(async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || key.length < 8 || key.length > 120) fail(400, 'A unique Idempotency-Key is required for each sales return');
  const { items, payments = [], reason = null } = req.body || {};
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail(400, 'A sales return must include 1 to 100 product lines');
  if (items.some((line) => typeof line.saleItemId !== 'string' || typeof line.restock !== 'boolean') || new Set(items.map((line) => line.saleItemId)).size !== items.length) fail(400, 'Each sales return line must identify a unique sale item and whether it is accepted back into saleable stock');
  const paymentLines = parseReturnPayments(payments);
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) || null : null;
  const result = await withTransaction(async (connection) => {
    const [repeated] = await connection.execute('SELECT id,reference,total,credit_applied AS creditApplied,refund_amount AS refundAmount,sale_id AS saleId FROM sales_returns WHERE business_id=? AND idempotency_key=?', [req.user.businessId, key]);
    if (repeated.length) {
      if (repeated[0].saleId !== req.params.saleId) fail(409, 'That idempotency key was used for a different sales return');
      return { ...repeated[0], repeated: true };
    }
    const [saleRows] = await connection.execute('SELECT id,branch_id AS branchId,reference,total,balance_due AS balanceDue,status FROM sales WHERE id=? AND business_id=? FOR UPDATE', [req.params.saleId, req.user.businessId]);
    if (!saleRows.length || saleRows[0].status === 'voided') fail(404, 'Completed sale was not found');
    const sale = saleRows[0];
    const parsed = [];
    let totalMinor = 0n;
    for (const line of items) {
      const quantity = toQuantity(line.quantity, 'Return quantity');
      const [sourceRows] = await connection.execute(
        `SELECT si.id,si.product_id AS productId,si.product_name AS productName,si.quantity,si.unit,si.factor_to_base AS factorToBase,
          si.unit_price AS unitPrice,si.unit_cost AS unitCost,si.line_total AS lineTotal,si.line_cost AS lineCost,pr.base_unit AS baseUnit
         FROM sale_items si JOIN products pr ON pr.id=si.product_id AND pr.business_id=si.business_id
         WHERE si.id=? AND si.sale_id=? AND si.business_id=? FOR UPDATE`, [line.saleItemId, sale.id, req.user.businessId],
      );
      if (!sourceRows.length) fail(404, 'A returned item was not part of this sale');
      const source = sourceRows[0];
      const [priorRows] = await connection.execute('SELECT COALESCE(SUM(quantity),0) AS returnedQuantity,COALESCE(SUM(line_total),0) AS returnedTotal,COALESCE(SUM(line_cost),0) AS returnedCost FROM sales_return_items WHERE business_id=? AND sale_item_id=?', [req.user.businessId, source.id]);
      const sourceQty = quantityToMilli(source.quantity); const alreadyQty = quantityToMilli(priorRows[0].returnedQuantity); const requestedQty = quantityToMilli(quantity);
      if (requestedQty > sourceQty - alreadyQty) fail(409, `Return quantity exceeds the remaining sold quantity for ${source.productName}`);
      const factorMilli = quantityToMilli(source.factorToBase); const baseQtyMilli = (requestedQty * factorMilli + 500n) / 1000n;
      if (baseQtyMilli <= 0n) fail(400, 'Converted return quantity must be greater than zero');
      const remainingQty = sourceQty - alreadyQty;
      const remainingTotal = toMinor(source.lineTotal) - toMinor(priorRows[0].returnedTotal);
      const remainingCost = toMinor(source.lineCost) - toMinor(priorRows[0].returnedCost);
      const lineTotal = requestedQty === remainingQty ? remainingTotal : portionMinor(toMinor(source.lineTotal), requestedQty, sourceQty);
      const lineCost = requestedQty === remainingQty ? remainingCost : portionMinor(toMinor(source.lineCost), requestedQty, sourceQty);
      totalMinor += lineTotal;
      parsed.push({ ...source, quantity, requestedQty, baseQtyMilli, baseQuantity: fromMilliQuantity(baseQtyMilli), lineTotal: moneyText(lineTotal), lineCost: moneyText(lineCost), restock: line.restock });
    }
    if (totalMinor <= 0n) fail(400, 'The return total must be greater than zero');
    const balanceMinor = toMinor(sale.balanceDue);
    const creditMinor = balanceMinor < totalMinor ? balanceMinor : totalMinor;
    const refundMinor = totalMinor - creditMinor;
    const paymentTotal = paymentLines.reduce((sum, payment) => sum + payment.amount, 0n);
    if (paymentTotal !== refundMinor) fail(400, `Customer refund payments must total ${moneyText(refundMinor)}`);
    const [collectedRows] = await connection.execute(
      `SELECT
        (SELECT COALESCE(SUM(amount),0) FROM sale_payments WHERE business_id=? AND sale_id=?) +
        (SELECT COALESCE(SUM(amount),0) FROM customer_payment_allocations WHERE business_id=? AND sale_id=?) AS collected,
        (SELECT COALESCE(SUM(srp.amount),0) FROM sales_return_payments srp JOIN sales_returns sr ON sr.id=srp.return_id AND sr.business_id=srp.business_id WHERE srp.business_id=? AND sr.sale_id=?) AS refunded`,
      [req.user.businessId, sale.id, req.user.businessId, sale.id, req.user.businessId, sale.id],
    );
    if (refundMinor > toMinor(collectedRows[0].collected) - toMinor(collectedRows[0].refunded)) fail(409, 'The refund exceeds the net amount collected for this sale');
    const [sessions] = await connection.execute('SELECT id FROM cash_sessions WHERE business_id=? AND user_id=? AND status=\'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (paymentLines.some((payment) => payment.method === 'cash') && !sessions.length) fail(409, 'Open a cash session before issuing a cash refund');
    const returnId = randomUUID();
    await connection.execute(
      `INSERT INTO sales_returns (id,business_id,branch_id,sale_id,user_id,reference,idempotency_key,total,credit_applied,refund_amount,reason)
       VALUES (?,?,?, ?, ?, CONCAT('SR-',UPPER(SUBSTRING(REPLACE(UUID(),'-',''),1,12))),?,?,?,?,?)`,
      [returnId, req.user.businessId, sale.branchId, sale.id, req.user.id, key, moneyText(totalMinor), moneyText(creditMinor), moneyText(refundMinor), cleanReason],
    );
    const [referenceRows] = await connection.execute('SELECT reference FROM sales_returns WHERE id=? AND business_id=?', [returnId, req.user.businessId]);
    for (const line of parsed) {
      await connection.execute(
        `INSERT INTO sales_return_items (id,business_id,branch_id,return_id,sale_item_id,product_id,product_name,quantity,unit,factor_to_base,base_quantity,unit_price,unit_cost,line_total,line_cost,restock)
         VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.user.businessId, sale.branchId, returnId, line.id, line.productId, line.productName, line.quantity, line.unit, line.factorToBase, line.baseQuantity, line.unitPrice, line.unitCost, line.lineTotal, line.lineCost, line.restock ? 1 : 0],
      );
      if (line.restock) {
        const [inventoryRows] = await connection.execute('SELECT i.quantity,p.cost_price AS costPrice FROM inventory i JOIN products p ON p.id=i.product_id AND p.business_id=i.business_id WHERE i.product_id=? AND i.branch_id=? AND i.business_id=? FOR UPDATE', [line.productId, sale.branchId, req.user.businessId]);
        if (!inventoryRows.length) fail(409, `Inventory for ${line.productName} is unavailable`);
        const previousQty = quantityToMilli(inventoryRows[0].quantity); const nextQty = previousQty + line.baseQtyMilli;
        const incomingCost = toMinor(line.lineCost); const oldCost = toMinor(inventoryRows[0].costPrice);
        const newCost = (previousQty * oldCost + incomingCost * 1000n + nextQty / 2n) / nextQty;
        await connection.execute('UPDATE inventory SET quantity=?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND branch_id=?', [fromMilliQuantity(nextQty), line.productId, sale.branchId]);
        await connection.execute('UPDATE products SET cost_price=? WHERE id=? AND business_id=?', [moneyText(newCost), line.productId, req.user.businessId]);
        await connection.execute('UPDATE product_units SET purchase_price=? WHERE product_id=? AND business_id=? AND is_base=1', [moneyText(newCost), line.productId, req.user.businessId]);
        await connection.execute(
          `INSERT INTO stock_movements (id,business_id,branch_id,product_id,user_id,movement_type,quantity_delta,unit,reference_type,reference_id,notes)
           VALUES (UUID(),?,?,?,?, 'sale_return', CAST(? AS DECIMAL(14,3)), ?, 'sales_return', ?, ?)`,
          [req.user.businessId, sale.branchId, line.productId, req.user.id, line.baseQuantity, line.baseUnit, returnId, referenceRows[0].reference],
        );
      }
    }
    await connection.execute('UPDATE sales SET balance_due=balance_due-? WHERE id=? AND business_id=?', [moneyText(creditMinor), sale.id, req.user.businessId]);
    const [returnTotals] = await connection.execute('SELECT COALESCE(SUM(total),0) AS returned FROM sales_returns WHERE business_id=? AND sale_id=?', [req.user.businessId, sale.id]);
    const newStatus = toMinor(returnTotals[0].returned) >= toMinor(sale.total) ? 'returned' : 'partially_returned';
    await connection.execute('UPDATE sales SET status=? WHERE id=? AND business_id=?', [newStatus, sale.id, req.user.businessId]);
    for (const payment of paymentLines) {
      await connection.execute('INSERT INTO sales_return_payments (id,business_id,branch_id,return_id,user_id,method,amount) VALUES (UUID(),?,?,?,?,?,?)', [req.user.businessId, sale.branchId, returnId, req.user.id, payment.method, moneyText(payment.amount)]);
      if (payment.method === 'cash') await connection.execute('INSERT INTO cash_movements (id,business_id,branch_id,session_id,user_id,movement_type,direction,amount,reference_type,reference_id,notes) VALUES (UUID(),?,?,?,?,\'refund\',\'out\',?,\'sales_return\',?,?)', [req.user.businessId, sale.branchId, sessions[0].id, req.user.id, moneyText(payment.amount), returnId, `Customer refund ${referenceRows[0].reference}`]);
    }
    await writeAudit(connection, { businessId: req.user.businessId, branchId: sale.branchId, userId: req.user.id, action: 'returned', module: 'sales_returns', recordId: returnId, reference: referenceRows[0].reference, details: { saleId: sale.id, total: moneyText(totalMinor), customerCredit: moneyText(creditMinor), refund: moneyText(refundMinor), lines: parsed.length } });
    return { id: returnId, reference: referenceRows[0].reference, total: moneyText(totalMinor), creditApplied: moneyText(creditMinor), refundAmount: moneyText(refundMinor), balanceDue: moneyText(balanceMinor - creditMinor), status: newStatus, repeated: false };
  });
  res.status(result.repeated ? 200 : 201).json({ salesReturn: result });
}));

router.post('/sales', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || key.length < 8 || key.length > 120) fail(400, 'A unique Idempotency-Key is required for each sale');
  const { items, payments = [], customerId = null, discount = '0' } = req.body || {};
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail(400, 'A sale must include 1 to 100 product lines');
  if (!Array.isArray(payments) || payments.length > 4) fail(400, 'A sale may have up to four payment lines');
  const sale = await withTransaction(async (connection) => {
    const [existing] = await connection.execute('SELECT id, reference, subtotal, discount_amount AS discountAmount, total, amount_paid AS amountPaid, balance_due AS balanceDue FROM sales WHERE business_id = ? AND idempotency_key = ?', [req.user.businessId, key]);
    if (existing.length) return { ...existing[0], repeated: true };
    const [branchRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]);
    const branchId = branchRows[0].branchId;
    const parsed = [];
    let subtotalMinor = 0n; let totalCostMinor = 0n;
    for (const line of items) {
      if (typeof line.productId !== 'string') fail(400, 'Every sale line needs a product');
      const quantity = toQuantity(line.quantity, 'Quantity');
      const [rows] = await connection.execute(
        `SELECT p.id, p.name,p.category_id AS categoryId,pc.name AS categoryName,p.base_unit AS baseUnit,p.cost_price AS costPrice,i.quantity AS stockQuantity,
          pu.id AS unitId, pu.unit_name AS unitName, pu.factor_to_base AS factorToBase, pu.selling_price AS sellingPrice, pu.is_base AS isBase
         FROM products p LEFT JOIN product_categories pc ON pc.id=p.category_id AND pc.business_id=p.business_id
         JOIN inventory i ON i.product_id = p.id AND i.branch_id = p.branch_id
         JOIN product_units pu ON pu.product_id = p.id AND pu.business_id = p.business_id AND pu.active = 1
         WHERE p.id = ? AND p.business_id = ? AND p.branch_id = ? AND p.active = 1 FOR UPDATE`, [line.productId, req.user.businessId, branchId],
      );
      const selected = rows.find((row) => line.unitId ? row.unitId === line.unitId : Number(row.isBase) === 1);
      if (!selected) fail(404, line.unitId ? 'The selected product unit was not found' : 'A selected product was not found');
      const baseQtyMilli = (quantityToMilli(quantity) * quantityToMilli(selected.factorToBase) + 500n) / 1000n;
      const baseQuantity = fromMilliQuantity(baseQtyMilli);
      if (quantityToMilli(selected.stockQuantity) < baseQtyMilli) fail(409, `Not enough stock for ${selected.name}`);
      const lineTotal = multiplyMinorByQuantity(selected.sellingPrice, quantity);
      const lineCost = multiplyMinorByQuantity(selected.costPrice, baseQuantity);
      subtotalMinor += lineTotal; totalCostMinor += lineCost;
      parsed.push({ ...selected, quantity, baseQuantity, lineTotal: moneyText(lineTotal), lineCost: moneyText(lineCost) });
    }
    const discountMinor = toMinor(discount === null || discount === undefined || discount === '' ? '0' : discount, 'Discount');
    if (discountMinor > 0n && !['owner', 'manager'].includes(req.user.role)) fail(403, 'Only an owner or manager can authorize a sale discount');
    if (discountMinor > subtotalMinor) fail(400, 'Discount cannot exceed the sale subtotal');
    const totalMinor = subtotalMinor - discountMinor;
    const paymentLines = payments.map((payment) => {
      if (!METHODS.includes(payment.method)) fail(400, 'Choose a supported payment method');
      const amount = toMinor(payment.amount, 'Payment amount');
      if (amount === 0n) fail(400, 'Payment amounts must be greater than zero');
      return { method: payment.method, amount };
    });
    const paidMinor = paymentLines.reduce((sum, item) => sum + item.amount, 0n);
    if (paidMinor > totalMinor) fail(400, 'Payment total cannot exceed the sale total. Enter the amount applied to this sale.');
    const balanceMinor = totalMinor - paidMinor;
    if (balanceMinor > 0n) {
      if (typeof customerId !== 'string') fail(400, 'Select a customer when recording a sale with an unpaid balance');
      const [customer] = await connection.execute('SELECT id FROM customers WHERE id = ? AND business_id = ? AND active = 1', [customerId, req.user.businessId]);
      if (!customer.length) fail(400, 'The selected customer was not found');
    }
    const [existingSession] = await connection.execute('SELECT id FROM cash_sessions WHERE business_id = ? AND user_id = ? AND status = \'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (paymentLines.some((item) => item.method === 'cash') && !existingSession.length) fail(409, 'Open a cash session before accepting cash payments');
    const [saleResult] = await connection.execute(
      `INSERT INTO sales (id, business_id, branch_id, cashier_id, customer_id, reference, idempotency_key, subtotal, discount_amount, tax_amount, total, amount_paid, balance_due, cost_of_goods_sold)
       VALUES (UUID(), ?, ?, ?, ?, CONCAT('S-', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 12))), ?, ?, ?, 0, ?, ?, ?, ?)`,
      [req.user.businessId, branchId, req.user.id, customerId, key, moneyText(subtotalMinor), moneyText(discountMinor), moneyText(totalMinor), moneyText(paidMinor), moneyText(balanceMinor), moneyText(totalCostMinor)],
    );
    const [idRows] = await connection.execute('SELECT id, reference FROM sales WHERE business_id = ? AND idempotency_key = ?', [req.user.businessId, key]);
    const saleId = idRows[0].id; const reference = idRows[0].reference;
    for (const line of parsed) {
      await connection.execute(
        `INSERT INTO sale_items (id, business_id, branch_id, sale_id, product_id, category_id, product_name, category_name, quantity, unit, factor_to_base, unit_price, unit_cost, line_total, line_cost)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.businessId, branchId, saleId, line.id, line.categoryId, line.name, line.categoryName, line.quantity, line.unitName, line.factorToBase, line.sellingPrice, line.costPrice, line.lineTotal, line.lineCost],
      );
      await connection.execute('UPDATE inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND branch_id = ?', [line.baseQuantity, line.id, branchId]);
      await connection.execute(
        `INSERT INTO stock_movements (id, business_id, branch_id, product_id, user_id, movement_type, quantity_delta, unit, reference_type, reference_id, notes)
         VALUES (UUID(), ?, ?, ?, ?, 'sale', -CAST(? AS DECIMAL(14,3)), ?, 'sale', ?, ?)`,
        [req.user.businessId, branchId, line.id, req.user.id, line.baseQuantity, line.baseUnit, saleId, reference],
      );
    }
    for (const payment of paymentLines) {
      await connection.execute('INSERT INTO sale_payments (id, business_id, branch_id, sale_id, user_id, method, amount) VALUES (UUID(), ?, ?, ?, ?, ?, ?)', [req.user.businessId, branchId, saleId, req.user.id, payment.method, moneyText(payment.amount)]);
      if (payment.method === 'cash') await connection.execute('INSERT INTO cash_movements (id, business_id, branch_id, session_id, user_id, movement_type, direction, amount, reference_type, reference_id, notes) VALUES (UUID(), ?, ?, ?, ?, \'sale_payment\', \'in\', ?, \'sale\', ?, ?)', [req.user.businessId, branchId, existingSession[0].id, req.user.id, moneyText(payment.amount), saleId, reference]);
    }
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'completed', module: 'sales', recordId: saleId, reference, details: { subtotal: moneyText(subtotalMinor), discount: moneyText(discountMinor), total: moneyText(totalMinor), paid: moneyText(paidMinor), balance: moneyText(balanceMinor), lines: parsed.length } });
    return { id: saleId, reference, subtotal: moneyText(subtotalMinor), discountAmount: moneyText(discountMinor), total: moneyText(totalMinor), amountPaid: moneyText(paidMinor), balanceDue: moneyText(balanceMinor), repeated: false };
  });
  res.status(sale.repeated ? 200 : 201).json({ sale });
}));

router.post('/debts/:customerId/payments', authorize('owner', 'manager', 'accountant', 'cashier'), asyncRoute(async (req, res) => {
  const amount = toMinor(req.body?.amount, 'Payment amount'); const method = req.body?.method;
  if (amount <= 0n || !METHODS.includes(method)) fail(400, 'Provide a positive payment and supported payment method');
  const paymentId = randomUUID();
  const result = await withTransaction(async (connection) => {
    const [customers] = await connection.execute('SELECT id FROM customers WHERE id = ? AND business_id = ? AND active = 1', [req.params.customerId, req.user.businessId]);
    if (!customers.length) fail(404, 'Customer was not found');
    const [debts] = await connection.execute('SELECT id, balance_due AS balanceDue FROM sales WHERE business_id = ? AND customer_id = ? AND balance_due > 0 ORDER BY created_at, id FOR UPDATE', [req.user.businessId, req.params.customerId]);
    const outstanding = debts.reduce((sum, debt) => sum + toMinor(debt.balanceDue), 0n);
    if (amount > outstanding) fail(400, 'Payment cannot exceed the customer’s outstanding balance');
    const [sessions] = await connection.execute('SELECT id, branch_id AS branchId FROM cash_sessions WHERE business_id = ? AND user_id = ? AND status = \'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (method === 'cash' && !sessions.length) fail(409, 'Open a cash session before accepting cash payments');
    let remaining = amount;
    const allocations = [];
    for (const debt of debts) {
      if (remaining === 0n) break;
      const balance = toMinor(debt.balanceDue); const applied = remaining < balance ? remaining : balance;
      await connection.execute('UPDATE sales SET amount_paid = amount_paid + ?, balance_due = balance_due - ? WHERE id = ? AND business_id = ?', [moneyText(applied), moneyText(applied), debt.id, req.user.businessId]);
      allocations.push({ saleId: debt.id, amount: moneyText(applied) }); remaining -= applied;
    }
    const [branchRows] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ?', [req.user.id]); const branchId = sessions[0]?.branchId || branchRows[0].branchId;
    await connection.execute('INSERT INTO customer_payments (id, business_id, branch_id, customer_id, user_id, method, amount) VALUES (?, ?, ?, ?, ?, ?, ?)', [paymentId, req.user.businessId, branchId, req.params.customerId, req.user.id, method, moneyText(amount)]);
    for (const allocation of allocations) await connection.execute('INSERT INTO customer_payment_allocations (id, business_id, payment_id, sale_id, amount) VALUES (UUID(), ?, ?, ?, ?)', [req.user.businessId, paymentId, allocation.saleId, allocation.amount]);
    if (method === 'cash') await connection.execute('INSERT INTO cash_movements (id, business_id, branch_id, session_id, user_id, movement_type, direction, amount, reference_type, reference_id) VALUES (UUID(), ?, ?, ?, ?, \'debt_payment\', \'in\', ?, \'customer_payment\', ?)', [req.user.businessId, branchId, sessions[0].id, req.user.id, moneyText(amount), paymentId]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'recorded', module: 'customer_payments', recordId: paymentId, details: { amount: moneyText(amount), method, allocations } });
    return { paymentId, amount: moneyText(amount), allocations, outstanding: moneyText(outstanding - amount) };
  });
  res.status(201).json({ payment: result });
}));

router.get('/expenses', asyncRoute(async (req, res) => {
  const [items] = await pool.execute('SELECT id, category, description, amount, payment_method AS paymentMethod, created_at AS createdAt FROM expenses WHERE business_id = ? ORDER BY created_at DESC LIMIT 100', businessScope(req));
  res.json({ items });
}));

router.post('/expenses', authorize('owner', 'manager', 'accountant'), asyncRoute(async (req, res) => {
  const category = normalizeLabel(req.body?.category, 'Category', 80); const description = normalizeLabel(req.body?.description, 'Description', 250);
  const amount = toMinor(req.body?.amount, 'Amount'); const method = req.body?.paymentMethod || 'cash';
  if (amount <= 0n || !METHODS.includes(method)) fail(400, 'Provide a positive amount and supported payment method');
  const expenseId = randomUUID();
  const expense = await withTransaction(async (connection) => {
    const [users] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]);
    const branchId = users[0].branchId;
    const [sessions] = await connection.execute('SELECT id FROM cash_sessions WHERE business_id = ? AND user_id = ? AND status = \'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (method === 'cash' && !sessions.length) fail(409, 'Open a cash session before recording a cash expense');
    await connection.execute('INSERT INTO expenses (id, business_id, branch_id, user_id, category, description, amount, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [expenseId, req.user.businessId, branchId, req.user.id, category, description, moneyText(amount), method]);
    if (method === 'cash') await connection.execute('INSERT INTO cash_movements (id, business_id, branch_id, session_id, user_id, movement_type, direction, amount, reference_type, reference_id, notes) VALUES (UUID(), ?, ?, ?, ?, \'expense\', \'out\', ?, \'expense\', ?, ?)', [req.user.businessId, branchId, sessions[0].id, req.user.id, moneyText(amount), expenseId, description]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'recorded', module: 'expenses', recordId: expenseId, details: { category, amount: moneyText(amount), method } });
    return { id: expenseId, category, description, amount: moneyText(amount), paymentMethod: method };
  });
  res.status(201).json({ expense });
}));

router.get('/cash-sessions', asyncRoute(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT cs.id, cs.status, cs.opening_balance AS openingBalance, cs.actual_cash AS actualCash, cs.discrepancy_note AS discrepancyNote, cs.opened_at AS openedAt, cs.closed_at AS closedAt,
      cs.opening_balance + COALESCE(SUM(CASE WHEN cm.movement_type='opening_float' THEN 0 WHEN cm.direction='in' THEN cm.amount WHEN cm.direction='out' THEN -cm.amount ELSE 0 END),0) AS expectedCash
     FROM cash_sessions cs LEFT JOIN cash_movements cm ON cm.session_id = cs.id AND cm.business_id = cs.business_id
     WHERE cs.business_id = ? AND cs.user_id = ? GROUP BY cs.id ORDER BY cs.opened_at DESC LIMIT 50`, [req.user.businessId, req.user.id],
  );
  res.json({ active: items.find((item) => item.status === 'open') || null, items });
}));

router.post('/cash-sessions', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const opening = toMinor(req.body?.openingBalance, 'Opening balance');
  const sessionId = randomUUID();
  const session = await withTransaction(async (connection) => {
    const [open] = await connection.execute('SELECT id FROM cash_sessions WHERE business_id = ? AND user_id = ? AND status = \'open\' LIMIT 1 FOR UPDATE', [req.user.businessId, req.user.id]);
    if (open.length) fail(409, 'You already have an open cash session');
    const [users] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id = ? AND business_id = ?', [req.user.id, req.user.businessId]); const branchId = users[0].branchId;
    await connection.execute('INSERT INTO cash_sessions (id, business_id, branch_id, user_id, opening_balance, status) VALUES (?, ?, ?, ?, ?, \'open\')', [sessionId, req.user.businessId, branchId, req.user.id, moneyText(opening)]);
    await connection.execute('INSERT INTO cash_movements (id, business_id, branch_id, session_id, user_id, movement_type, direction, amount, notes) VALUES (UUID(), ?, ?, ?, ?, \'opening_float\', \'in\', ?, \'Opening cash float\')', [req.user.businessId, branchId, sessionId, req.user.id, moneyText(opening)]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId, userId: req.user.id, action: 'opened', module: 'cash_sessions', recordId: sessionId, details: { openingBalance: moneyText(opening) } });
    const [rows] = await connection.execute('SELECT opened_at AS openedAt FROM cash_sessions WHERE id = ?', [sessionId]);
    return { id: sessionId, openedAt: rows[0].openedAt, openingBalance: moneyText(opening), expectedCash: moneyText(opening), status: 'open' };
  });
  res.status(201).json({ session });
}));

router.post('/cash-sessions/:sessionId/close', authorize('owner', 'manager', 'cashier'), asyncRoute(async (req, res) => {
  const actual = toMinor(req.body?.actualCash, 'Actual cash'); const discrepancyNote = typeof req.body?.discrepancyNote === 'string' ? req.body.discrepancyNote.trim().slice(0, 500) : '';
  const result = await withTransaction(async (connection) => {
    const [sessions] = await connection.execute('SELECT id, branch_id AS branchId, opening_balance AS openingBalance FROM cash_sessions WHERE id = ? AND business_id = ? AND user_id = ? AND status = \'open\' FOR UPDATE', [req.params.sessionId, req.user.businessId, req.user.id]);
    if (!sessions.length) fail(404, 'Open cash session was not found');
    const [rows] = await connection.execute('SELECT COALESCE(SUM(CASE WHEN movement_type=\'opening_float\' THEN 0 WHEN direction=\'in\' THEN amount WHEN direction=\'out\' THEN -amount ELSE 0 END),0) AS movementTotal FROM cash_movements WHERE session_id = ? AND business_id = ?', [req.params.sessionId, req.user.businessId]);
    const expected = toMinor(sessions[0].openingBalance) + signedMinor(rows[0].movementTotal, 'Cash movement total');
    if (actual !== expected && discrepancyNote.length < 5) fail(400, 'Please explain the cash discrepancy (at least 5 characters)');
    await connection.execute('UPDATE cash_sessions SET status = \'closed\', actual_cash = ?, expected_cash = ?, discrepancy_note = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?', [moneyText(actual), moneyText(expected), discrepancyNote || null, req.params.sessionId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId: sessions[0].branchId, userId: req.user.id, action: 'closed', module: 'cash_sessions', recordId: req.params.sessionId, details: { actualCash: moneyText(actual), expectedCash: moneyText(expected), variance: moneyText(actual - expected), discrepancyNote: discrepancyNote || null } });
    return { id: req.params.sessionId, expectedCash: moneyText(expected), actualCash: moneyText(actual), variance: moneyText(actual - expected), status: 'closed' };
  });
  res.json({ session: result });
}));

router.get('/dashboard', asyncRoute(async (req, res) => {
  const [salesRows] = await pool.execute(
    `SELECT COALESCE(SUM(total),0) AS todaySales, COALESCE(SUM(cost_of_goods_sold),0) AS todayCost, COUNT(*) AS salesCount
     FROM sales WHERE business_id = ? AND status <> 'voided' AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL 1 DAY`, businessScope(req),
  );
  const [todayReturnRows] = await pool.execute(
    `SELECT COALESCE(SUM(total),0) AS total,COALESCE(SUM(credit_applied),0) AS creditApplied
     FROM sales_returns WHERE business_id=? AND created_at>=CURRENT_DATE AND created_at<CURRENT_DATE+INTERVAL 1 DAY`, businessScope(req),
  );
  const [todayReturnCostRows] = await pool.execute(
    `SELECT COALESCE(SUM(sri.line_cost),0) AS cost FROM sales_return_items sri JOIN sales_returns sr ON sr.id=sri.return_id AND sr.business_id=sri.business_id
     WHERE sri.business_id=? AND sri.restock=1 AND sr.created_at>=CURRENT_DATE AND sr.created_at<CURRENT_DATE+INTERVAL 1 DAY`, businessScope(req),
  );
  const [paymentRows] = await pool.execute(
    `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS cashReceived FROM cash_movements
     WHERE business_id = ? AND movement_type IN ('sale_payment','debt_payment','refund')
       AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL 1 DAY`, businessScope(req),
  );
  const [expenseRows] = await pool.execute('SELECT COALESCE(SUM(amount),0) AS todayExpenses FROM expenses WHERE business_id=? AND created_at>=CURRENT_DATE AND created_at<CURRENT_DATE+INTERVAL 1 DAY', businessScope(req));
  const [creditRows] = await pool.execute(
    `SELECT COALESCE(SUM(s.total-COALESCE(paid.applied,0)),0) AS creditIssued FROM sales s
     LEFT JOIN (SELECT business_id,sale_id,SUM(amount) AS applied FROM sale_payments GROUP BY business_id,sale_id) paid ON paid.sale_id=s.id AND paid.business_id=s.business_id
     WHERE s.business_id=? AND s.status<>'voided' AND s.created_at>=CURRENT_DATE AND s.created_at<CURRENT_DATE+INTERVAL 1 DAY`, businessScope(req),
  );
  const [returnsCreditRows] = await pool.execute('SELECT COALESCE(SUM(credit_applied),0) AS creditApplied FROM sales_returns WHERE business_id=? AND created_at>=CURRENT_DATE AND created_at<CURRENT_DATE+INTERVAL 1 DAY', businessScope(req));
  const [inventoryRows] = await pool.execute(
    `SELECT COUNT(*) AS productCount, SUM(CASE WHEN COALESCE(i.quantity,0) <= p.low_stock_threshold THEN 1 ELSE 0 END) AS lowStockCount,
      SUM(CASE WHEN COALESCE(i.quantity,0) = 0 THEN 1 ELSE 0 END) AS outOfStockCount, COALESCE(SUM(i.quantity * p.cost_price),0) AS inventoryValue
     FROM products p LEFT JOIN inventory i ON i.product_id=p.id AND i.branch_id=p.branch_id WHERE p.business_id=? AND p.active=1`, businessScope(req),
  );
  const [debtRows] = await pool.execute('SELECT COALESCE(SUM(balance_due),0) AS customerDebt FROM sales WHERE business_id = ? AND balance_due > 0', businessScope(req));
  const [supplierDebtRows] = await pool.execute('SELECT COALESCE(SUM(balance_due),0) AS supplierDebt FROM purchases WHERE business_id=? AND status=\'received\' AND balance_due>0', businessScope(req));
  const [recentSales] = await pool.execute(
    `SELECT s.id, s.reference, s.total, s.created_at AS createdAt, COALESCE(c.full_name, 'Walk-in customer') AS customerName,
      CASE WHEN s.balance_due > 0 THEN 'part-paid' ELSE 'paid' END AS paymentStatus FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
     WHERE s.business_id=? AND s.status<>'voided' AND s.created_at >= CURRENT_DATE AND s.created_at < CURRENT_DATE + INTERVAL 1 DAY ORDER BY s.created_at DESC LIMIT 5`, businessScope(req),
  );
  const [trendRows] = await pool.execute(
    `SELECT DATE(created_at) AS day,COALESCE(SUM(total),0) AS amount FROM sales
     WHERE business_id=? AND status<>'voided' AND created_at>=CURRENT_DATE-INTERVAL 6 DAY AND created_at<CURRENT_DATE+INTERVAL 1 DAY
     GROUP BY DATE(created_at) ORDER BY day`, businessScope(req),
  );
  const [trendReturns] = await pool.execute('SELECT DATE(created_at) AS day,COALESCE(SUM(total),0) AS amount FROM sales_returns WHERE business_id=? AND created_at>=CURRENT_DATE-INTERVAL 6 DAY AND created_at<CURRENT_DATE+INTERVAL 1 DAY GROUP BY DATE(created_at)', businessScope(req));
  const row = salesRows[0]; const stock = inventoryRows[0];
  const todaySalesMinor = toMinor(row.todaySales) - toMinor(todayReturnRows[0].total);
  const todayCostMinor = toMinor(row.todayCost) - toMinor(todayReturnCostRows[0].cost);
  const grossProfit = todaySalesMinor - todayCostMinor;
  const salesByDay = new Map(trendRows.map((item) => [new Date(item.day).toISOString().slice(0, 10), toMinor(item.amount)]));
  for (const item of trendReturns) { const key = new Date(item.day).toISOString().slice(0, 10); salesByDay.set(key, (salesByDay.get(key) || 0n) - toMinor(item.amount)); }
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index)); const key = date.toISOString().slice(0, 10); const amount = salesByDay.get(key) || 0n;
    return { day: date.toLocaleDateString('en', { weekday: 'short' }), amount: moneyText(amount) };
  });
  const maxTrend = Math.max(1, ...trend.map((item) => Number(item.amount)));
  const salesTrend = trend.map((item) => ({ ...item, percent: Math.round(Number(item.amount) / maxTrend * 100) }));
  const creditIssuedMinor = toMinor(creditRows[0].creditIssued) - toMinor(returnsCreditRows[0].creditApplied);
  res.json({ todaySales: moneyText(todaySalesMinor), grossProfit: moneyText(grossProfit), todayExpenses: expenseRows[0].todayExpenses, netOperatingProfit: moneyText(grossProfit - toMinor(expenseRows[0].todayExpenses)), salesCount: Number(row.salesCount), cashReceived: paymentRows[0].cashReceived, creditIssued: moneyText(creditIssuedMinor), customerDebt: debtRows[0].customerDebt, supplierDebt: supplierDebtRows[0].supplierDebt, productCount: Number(stock.productCount || 0), lowStockCount: Number(stock.lowStockCount || 0), outOfStockCount: Number(stock.outOfStockCount || 0), inventoryValue: stock.inventoryValue, recentSales, salesTrend });
}));

router.get('/reports', authorize('owner', 'manager', 'accountant'), asyncRoute(async (req, res) => {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = (value) => {
    if (typeof value !== 'string' || !datePattern.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  };
  if ((req.query.from !== undefined && !validDate(req.query.from)) || (req.query.to !== undefined && !validDate(req.query.to))) fail(400, 'Report dates must be valid YYYY-MM-DD dates');
  const from = validDate(req.query.from) ? req.query.from : new Date().toISOString().slice(0, 8) + '01';
  const to = validDate(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
  if (from > to) fail(400, 'The report start date must be on or before the end date');
  const [financialRows] = await pool.execute(
    `SELECT COALESCE(SUM(s.total),0) AS grossSales,COALESCE(SUM(s.cost_of_goods_sold),0) AS costOfGoodsSold,
      COALESCE(SUM(s.total-COALESCE(paid.applied,0)),0) AS creditIssued,COALESCE(SUM(s.balance_due),0) AS creditOutstandingForPeriod,COUNT(*) AS saleCount
     FROM sales s LEFT JOIN (SELECT business_id,sale_id,SUM(amount) AS applied FROM sale_payments GROUP BY business_id,sale_id) paid
       ON paid.sale_id=s.id AND paid.business_id=s.business_id
     WHERE s.business_id=? AND s.status<>'voided' AND s.created_at>=? AND s.created_at<DATE_ADD(?,INTERVAL 1 DAY)`, [req.user.businessId, from, to],
  );
  const [returnRows] = await pool.execute('SELECT COALESCE(SUM(total),0) AS total,COALESCE(SUM(credit_applied),0) AS creditApplied FROM sales_returns WHERE business_id=? AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)', [req.user.businessId, from, to]);
  const [returnCostRows] = await pool.execute(
    `SELECT COALESCE(SUM(sri.line_cost),0) AS cost FROM sales_return_items sri JOIN sales_returns sr ON sr.id=sri.return_id AND sr.business_id=sri.business_id
     WHERE sri.business_id=? AND sri.restock=1 AND sr.created_at>=? AND sr.created_at<DATE_ADD(?,INTERVAL 1 DAY)`, [req.user.businessId, from, to],
  );
  const [expenseRows] = await pool.execute('SELECT COALESCE(SUM(amount),0) AS operatingExpenses FROM expenses WHERE business_id=? AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)', [req.user.businessId, from, to]);
  const [salePaymentRows] = await pool.execute('SELECT method,SUM(amount) AS amount FROM sale_payments WHERE business_id=? AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY) GROUP BY method', [req.user.businessId, from, to]);
  const [returnPaymentRows] = await pool.execute('SELECT method,SUM(amount) AS amount FROM sales_return_payments WHERE business_id=? AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY) GROUP BY method', [req.user.businessId, from, to]);
  const [productRows] = await pool.execute(
    `SELECT productId,productName,SUM(quantity) AS quantity,SUM(revenue) AS revenue FROM (
       SELECT si.product_id AS productId,si.product_name AS productName,si.quantity AS quantity,si.line_total AS revenue
       FROM sale_items si JOIN sales s ON s.id=si.sale_id AND s.business_id=si.business_id
       WHERE si.business_id=? AND s.status<>'voided' AND s.created_at>=? AND s.created_at<DATE_ADD(?,INTERVAL 1 DAY)
       UNION ALL
       SELECT sri.product_id AS productId,sri.product_name AS productName,-sri.quantity AS quantity,-sri.line_total AS revenue
       FROM sales_return_items sri JOIN sales_returns sr ON sr.id=sri.return_id AND sr.business_id=sri.business_id
       WHERE sri.business_id=? AND sr.created_at>=? AND sr.created_at<DATE_ADD(?,INTERVAL 1 DAY)
     ) productActivity GROUP BY productId,productName ORDER BY revenue DESC LIMIT 10`, [req.user.businessId, from, to, req.user.businessId, from, to],
  );
  const [categoryRows] = await pool.execute(
    `SELECT categoryName,SUM(quantity) AS quantity,SUM(revenue) AS revenue FROM (
       SELECT COALESCE(si.category_name,'Uncategorized') AS categoryName,si.quantity AS quantity,si.line_total AS revenue
       FROM sale_items si JOIN sales s ON s.id=si.sale_id AND s.business_id=si.business_id
       WHERE si.business_id=? AND s.status<>'voided' AND s.created_at>=? AND s.created_at<DATE_ADD(?,INTERVAL 1 DAY)
       UNION ALL
       SELECT COALESCE(si.category_name,'Uncategorized') AS categoryName,-sri.quantity AS quantity,-sri.line_total AS revenue
       FROM sales_return_items sri JOIN sales_returns sr ON sr.id=sri.return_id AND sr.business_id=sri.business_id
       JOIN sale_items si ON si.id=sri.sale_item_id AND si.business_id=sri.business_id
       WHERE sri.business_id=? AND sr.created_at>=? AND sr.created_at<DATE_ADD(?,INTERVAL 1 DAY)
     ) categoryActivity GROUP BY categoryName ORDER BY revenue DESC`, [req.user.businessId, from, to, req.user.businessId, from, to],
  );
  const [stockRows] = await pool.execute(
    `SELECT COALESCE(SUM(i.quantity*p.cost_price),0) AS inventoryValue,
      SUM(CASE WHEN i.quantity<=p.low_stock_threshold THEN 1 ELSE 0 END) AS lowStockCount
     FROM products p JOIN inventory i ON i.product_id=p.id AND i.branch_id=p.branch_id WHERE p.business_id=? AND p.active=1`, businessScope(req),
  );
  const [debtRows] = await pool.execute('SELECT COALESCE(SUM(balance_due),0) AS customerDebt FROM sales WHERE business_id=? AND balance_due>0', businessScope(req));
  const [supplierRows] = await pool.execute('SELECT COALESCE(SUM(balance_due),0) AS supplierDebt FROM purchases WHERE business_id=? AND status=\'received\' AND balance_due>0', businessScope(req));
  const financial = financialRows[0]; const expenses = expenseRows[0];
  const returnTotalMinor = toMinor(returnRows[0].total); const netRevenue = toMinor(financial.grossSales) - returnTotalMinor;
  const netCost = toMinor(financial.costOfGoodsSold) - toMinor(returnCostRows[0].cost);
  const grossProfit = netRevenue - netCost;
  const paymentMap = new Map();
  for (const item of salePaymentRows) paymentMap.set(item.method, toMinor(item.amount));
  for (const item of returnPaymentRows) paymentMap.set(item.method, (paymentMap.get(item.method) || 0n) - toMinor(item.amount));
  const paymentSummary = [...paymentMap.entries()].map(([method, amount]) => ({ method, amount: moneyText(amount) })).sort((a, b) => Number(b.amount) - Number(a.amount));
  const creditIssued = toMinor(financial.creditIssued) - toMinor(returnRows[0].creditApplied);
  res.json({ period: { from, to }, sales: { revenue: moneyText(netRevenue), grossSales: financial.grossSales, returns: moneyText(returnTotalMinor), count: Number(financial.saleCount), costOfGoodsSold: moneyText(netCost), grossProfit: moneyText(grossProfit), creditIssued: moneyText(creditIssued), creditOutstandingForPeriod: financial.creditOutstandingForPeriod },
    operatingExpenses: expenses.operatingExpenses, operatingProfit: moneyText(grossProfit - toMinor(expenses.operatingExpenses)), paymentSummary, topProducts: productRows, salesByCategory: categoryRows,
    inventory: { valuation: stockRows[0].inventoryValue, lowStockCount: Number(stockRows[0].lowStockCount || 0) }, customerDebt: debtRows[0].customerDebt, supplierDebt: supplierRows[0].supplierDebt });
}));

router.get('/users', authorize('owner'), asyncRoute(async (req, res) => {
  const [items] = await pool.execute('SELECT id,name,email,role,active,created_at AS createdAt FROM users WHERE business_id=? ORDER BY created_at', businessScope(req));
  res.json({ items });
}));

router.post('/users', authorize('owner'), asyncRoute(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  const allowedRoles = ['manager', 'cashier', 'storekeeper', 'accountant'];
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) fail(400, 'A name of up to 120 characters is required');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) fail(400, 'Provide a valid email address');
  if (typeof password !== 'string' || password.length < 10) fail(400, 'The initial password must have at least 10 characters');
  if (!allowedRoles.includes(role)) fail(400, 'Choose a supported staff role');
  const userId = randomUUID();
  const result = await withTransaction(async (connection) => {
    const [owner] = await connection.execute('SELECT branch_id AS branchId FROM users WHERE id=? AND business_id=? AND role=\'owner\' FOR UPDATE', [req.user.id, req.user.businessId]);
    if (!owner.length) fail(403, 'Only an owner can create staff accounts');
    await connection.execute('INSERT INTO users (id,business_id,branch_id,name,email,password_hash,role) VALUES (?,?,?,?,?,?,?)', [userId, req.user.businessId, owner[0].branchId, name.trim(), email.toLowerCase().trim(), await bcrypt.hash(password, 12), role]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId: owner[0].branchId, userId: req.user.id, action: 'created', module: 'users', recordId: userId, details: { name: name.trim(), email: email.toLowerCase().trim(), role } });
    return { id: userId, name: name.trim(), email: email.toLowerCase().trim(), role, active: 1 };
  });
  res.status(201).json({ user: result });
}));

router.patch('/users/:userId/active', authorize('owner'), asyncRoute(async (req, res) => {
  if (typeof req.body?.active !== 'boolean') fail(400, 'Active must be true or false');
  if (req.params.userId === req.user.id && !req.body.active) fail(400, 'You cannot deactivate your own account');
  const result = await withTransaction(async (connection) => {
    const [users] = await connection.execute('SELECT id,branch_id AS branchId,role,active FROM users WHERE id=? AND business_id=? FOR UPDATE', [req.params.userId, req.user.businessId]);
    if (!users.length) fail(404, 'User was not found');
    if (users[0].role === 'owner' && !req.body.active) {
      const [owners] = await connection.execute('SELECT COUNT(*) AS count FROM users WHERE business_id=? AND role=\'owner\' AND active=1 FOR UPDATE', [req.user.businessId]);
      if (Number(owners[0].count) <= 1) fail(409, 'The business must keep at least one active owner');
    }
    await connection.execute('UPDATE users SET active=? WHERE id=? AND business_id=?', [req.body.active ? 1 : 0, req.params.userId, req.user.businessId]);
    await writeAudit(connection, { businessId: req.user.businessId, branchId: users[0].branchId, userId: req.user.id, action: req.body.active ? 'activated' : 'deactivated', module: 'users', recordId: req.params.userId });
    return { id: req.params.userId, active: req.body.active };
  });
  res.json({ user: result });
}));

router.get('/audit-logs', authorize('owner'), asyncRoute(async (req, res) => {
  const [items] = await pool.execute('SELECT id, user_id AS userId, action, module, record_id AS recordId, transaction_reference AS reference, details, created_at AS createdAt FROM audit_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT 100', businessScope(req));
  res.json({ items });
}));

export default router;
