import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const api = process.env.BSSBMS_TEST_API || 'http://localhost:5102/api';
async function request(path, { method = 'GET', body, token, key } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}

const suffix = randomUUID().slice(0, 8);
const ownerPassword = `TableSmoke-${randomUUID()}!`;
const setup = await request('/auth/bootstrap', { method: 'POST', body: {
  businessName: `BSSBMS tables ${suffix}`, name: 'Table Smoke Owner', email: `owner-${suffix}@example.test`, password: ownerPassword,
} });
assert.equal(setup.status, 201, `Owner bootstrap failed: ${setup.data.error || setup.status}`);
const token = setup.data.token;

const cashSession = await request('/cash-sessions', { method: 'POST', token, body: { openingBalance: '10000' } });
assert.equal(cashSession.status, 201, `Cash session failed: ${cashSession.data.error}`);

const area = await request('/floor/areas', { method: 'POST', token, body: { name: 'Main Hall', sortOrder: 1 } });
assert.equal(area.status, 201, `Area creation failed: ${area.data.error}`);
const tables = [];
for (const code of ['T01', 'T02', 'T03']) {
  const table = await request('/floor/tables', { method: 'POST', token, body: { code, areaId: area.data.area.id, capacity: 4 } });
  assert.equal(table.status, 201, `Table ${code} creation failed: ${table.data.error}`);
  tables.push(table.data.table);
}
const duplicateTable = await request('/floor/tables', { method: 'POST', token, body: { code: 'T01', areaId: area.data.area.id, capacity: 4 } });
assert.equal(duplicateTable.status, 409, 'Duplicate table codes must be rejected');

const productResponse = await request('/products', { method: 'POST', token, body: { name: `Primus ${suffix}`, sku: `PRIM-${suffix}`, baseUnit: 'bottle', sellingPrice: '1200', costPrice: '700', lowStockThreshold: '0' } });
assert.equal(productResponse.status, 201, `Product creation failed: ${productResponse.data.error}`);
const product = productResponse.data.product;
const crate = await request(`/products/${product.id}/units`, { method: 'POST', token, body: { unitName: 'crate', factorToBase: '20', sellingPrice: '22000', purchasePrice: '12000' } });
assert.equal(crate.status, 201, `Crate conversion setup failed: ${crate.data.error}`);
const crateUnit = crate.data.unit;

const catalog = await (await request('/pos/catalog', { token })).data.items.find((item) => item.id === product.id);
const bottleUnit = catalog.units.find((unit) => Number(unit.isBase) === 1);
const stockOf = async () => Number((await request('/pos/catalog', { token })).data.items.find((item) => item.id === product.id).stockQuantity);

const openingStock = await request(`/inventory/${product.id}/adjustments`, { method: 'POST', token, body: { quantity: '100', notes: 'Table integration opening stock' } });
assert.equal(openingStock.status, 201, `Opening stock failed: ${openingStock.data.error}`);
assert.equal(await stockOf(), 100, 'Stock should start at 100 bottles (spec 16.25: 5 crates x 20)');

// ── Anonymous open + draft (spec 7A.6 test 41 / 16.41) ──────────────────
const opened = await request(`/floor/tables/${tables[0].id}/sessions`, { method: 'POST', token, body: {} });
assert.equal(opened.status, 201, `Table session open failed: ${opened.data.error}`);
assert.equal(opened.data.session.customerId, undefined, 'Opening a table must not require a customer identity');
const sessionId = opened.data.session.id;

const draftKey = `table-draft-${suffix}`;
const draft = await request(`/table-sessions/${sessionId}/orders`, { method: 'POST', token, key: draftKey, body: {
  items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '3' }, { productId: product.id, unitId: bottleUnit.id, quantity: '4' }], serveNow: false,
} });
assert.equal(draft.status, 201, `Draft round failed: ${draft.data.error}`);
assert.equal(draft.data.order.state, 'draft');
assert.equal(await stockOf(), 100, 'Unserved draft rounds must not deduct stock');

// ── Serve deducts once; retries are safe (spec 7A.6 tests 42 + 29) ──────
const orderId = draft.data.order.id;
const served = await request(`/orders/${orderId}/serve`, { method: 'POST', token });
assert.equal(served.status, 200, `Serve failed: ${served.data.error}`);
assert.equal(await stockOf(), 93, 'Serving 7 bottles must leave 93 (spec 16.25)');
const serveRetry = await request(`/orders/${orderId}/serve`, { method: 'POST', token });
assert.equal(serveRetry.status, 200);
assert.equal(serveRetry.data.order.repeated, true, 'Serve retries must be idempotent');
assert.equal(await stockOf(), 93, 'Serve retries must not deduct stock twice');

const draftRetry = await request(`/table-sessions/${sessionId}/orders`, { method: 'POST', token, key: draftKey, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '3' }], serveNow: false } });
assert.equal(draftRetry.status, 200);
assert.equal(draftRetry.data.order.repeated, true, 'Order retries with the same idempotency key return the original');
assert.equal((await request(`/table-sessions/${sessionId}`, { token })).data.session.orders.length, 1, 'Retries must not duplicate order rows');

const round2 = await request(`/table-sessions/${sessionId}/orders`, { method: 'POST', token, key: `table-round2-${suffix}`, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '2' }], serveNow: true } });
assert.equal(round2.status, 201, `Second round failed: ${round2.data.error}`);
assert.equal(await stockOf(), 91, 'A second served round deducts its own units exactly once');
const bill = round2.data.order.session;
assert.equal(Number(bill.billTotal), 9 * 1200, 'One ongoing table bill totals both rounds (spec 7A.6 test 42)');
assert.equal(bill.balanceDue, bill.billTotal, 'The bill is unpaid until settlement');

// ── One session per table; concurrent opens (spec 16.27) ────────────────
const secondOpen = await request(`/floor/tables/${tables[0].id}/sessions`, { method: 'POST', token, body: {} });
assert.equal(secondOpen.status, 409, 'A table cannot hold two open sessions');
const concurrent = await Promise.all([1, 2].map(() => request(`/floor/tables/${tables[1].id}/sessions`, { method: 'POST', token, body: {} })));
assert.equal(concurrent.filter((result) => result.status === 201).length, 1, 'Exactly one of two simultaneous opens wins');
assert.equal(concurrent.filter((result) => result.status === 409).length, 1, 'The losing simultaneous open gets a clean conflict');
const qa2SessionId = concurrent.find((result) => result.status === 201).data.session.id;

// ── Split payments, overpay guard, close (spec 7A.6 test 43) ────────────
const billTotal = 9 * 1200;
const overpay = await request(`/table-sessions/${sessionId}/payments`, { method: 'POST', token, key: `overpay-${suffix}`, body: { method: 'cash', amount: String(billTotal + 100) } });
assert.equal(overpay.status, 400, 'Payments above the outstanding balance must be rejected');
const pay1 = await request(`/table-sessions/${sessionId}/payments`, { method: 'POST', token, key: `pay1-${suffix}`, body: { method: 'cash', amount: '5000' } });
assert.equal(pay1.status, 201, `First split payment failed: ${pay1.data.error}`);
const pay1retry = await request(`/table-sessions/${sessionId}/payments`, { method: 'POST', token, key: `pay1-${suffix}`, body: { method: 'cash', amount: '5000' } });
assert.equal(pay1retry.status, 200);
assert.equal(pay1retry.data.payment.repeated, true, 'Payment retries must be idempotent');
const pay2 = await request(`/table-sessions/${sessionId}/payments`, { method: 'POST', token, key: `pay2-${suffix}`, body: { method: 'mobile_money', amount: String(billTotal - 5000) } });
assert.equal(pay2.status, 201, `Second split payment failed: ${pay2.data.error}`);

const floorOccupied = (await request('/floor', { token })).data.tables.find((table) => table.id === tables[0].id);
assert.equal(floorOccupied.effectiveStatus, 'occupied', 'The table stays occupied while the bill is open');
assert.equal(Number(floorOccupied.paidTotal), billTotal, 'The floor shows amounts already paid');

const closed = await request(`/table-sessions/${sessionId}/close`, { method: 'POST', token, body: {} });
assert.equal(closed.status, 201, `Table close failed: ${closed.data.error}`);
const closeRetry = await request(`/table-sessions/${sessionId}/close`, { method: 'POST', token, body: {} });
assert.equal(closeRetry.status, 200);
assert.equal(closeRetry.data.sale.id, closed.data.sale.id, 'Close retries return the same sale once');
const saleDetail = await request(`/sales/${closed.data.sale.id}`, { token });
assert.equal(saleDetail.data.sale.tableCode, 'T01', 'Table sale receipts carry the table code (spec 3.2 item 9)');
assert.equal(Number(saleDetail.data.sale.total), billTotal);
assert.equal(saleDetail.data.sale.payments.length, 2, 'Both split payments are copied into the sale');
assert.equal(await stockOf(), 91, 'Closing the bill must not deduct stock again (spec 3.2 item 8)');
const floorAfterClose = (await request('/floor', { token })).data.tables.find((table) => table.id === tables[0].id);
assert.equal(floorAfterClose.effectiveStatus, 'available', 'A settled table returns to available');

// ── Insufficient stock + draft void (spec 16.27) ───────────────────────
const tooMuch = await request(`/table-sessions/${qa2SessionId}/orders`, { method: 'POST', token, key: `toomuch-${suffix}`, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '9999' }], serveNow: true } });
assert.equal(tooMuch.status, 409, 'Serving beyond stock must be rejected');
assert.equal(await stockOf(), 91, 'A rejected serving leaves stock untouched');
const heldDraft = await request(`/table-sessions/${qa2SessionId}/orders`, { method: 'POST', token, key: `void-draft-${suffix}`, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '5' }], serveNow: false } });
const voidedDraft = await request(`/orders/${heldDraft.data.order.id}/void`, { method: 'POST', token, body: { reason: 'Customer changed the order' } });
assert.equal(voidedDraft.status, 200, `Draft void failed: ${voidedDraft.data.error}`);
assert.equal(await stockOf(), 91, 'Voiding an unserved draft never touched stock');

// ── Merge and transfer preserve history (spec 7A.6 test 44) ────────────
const qa3Open = await request(`/floor/tables/${tables[2].id}/sessions`, { method: 'POST', token, body: {} });
const qa3SessionId = qa3Open.data.session.id;
await request(`/table-sessions/${qa2SessionId}/orders`, { method: 'POST', token, key: `merge-a-${suffix}`, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '1' }], serveNow: true } });
await request(`/table-sessions/${qa3SessionId}/orders`, { method: 'POST', token, key: `merge-b-${suffix}`, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '2' }], serveNow: true } });
assert.equal(await stockOf(), 88, 'Merge rounds serve their own units');
const merge = await request(`/table-sessions/${qa3SessionId}/merge`, { method: 'POST', token, body: { targetSessionId: qa2SessionId, reason: 'Two parties joined' } });
assert.equal(merge.status, 200, `Merge failed: ${merge.data.error}`);
const merged = (await request(`/table-sessions/${qa2SessionId}`, { token })).data.session;
assert.equal(Number(merged.billTotal), 3 * 1200, 'A merged bill combines both tables exactly once');
assert.equal(merged.orders.filter((order) => order.state === 'served').length, 2, 'Merged sessions keep full round history');
assert.equal((await request('/floor', { token })).data.tables.find((table) => table.id === tables[2].id).effectiveStatus, 'available', 'The source table is freed by a merge');

const staffList = await request('/floor/staff', { token });
assert.equal(staffList.status, 200);
const assigned = await request(`/table-sessions/${qa2SessionId}/waiter`, { method: 'PATCH', token, body: { waiterId: staffList.data.items[0].id } });
assert.equal(assigned.status, 200, `Waiter assignment failed: ${assigned.data.error}`);

const transfer = await request(`/table-sessions/${qa2SessionId}/transfer`, { method: 'POST', token, body: { targetTableId: tables[0].id, reason: 'Customers moved to the terrace' } });
assert.equal(transfer.status, 200, `Transfer failed: ${transfer.data.error}`);
const transferred = (await request(`/table-sessions/${qa2SessionId}`, { token })).data.session;
assert.equal(transferred.tableCode, 'T01', 'A transferred session shows the new table');
assert.equal(Number(transferred.billTotal), 3 * 1200, 'Transfers preserve the outstanding bill');
assert.equal((await request('/floor', { token })).data.tables.find((table) => table.id === tables[1].id).effectiveStatus, 'available', 'The source table is freed by a transfer');

// ── Void of a served round restores stock (spec 7A.3 step 7) ───────────
const servedTwoBottleRound = transferred.orders.find((order) => order.state === 'served' && Number(order.items[0].quantity) === 2);
const voidServed = await request(`/orders/${servedTwoBottleRound.id}/void`, { method: 'POST', token, body: { reason: 'Mistakenly confirmed round' } });
assert.equal(voidServed.status, 200, `Served void failed: ${voidServed.data.error}`);
assert.equal(await stockOf(), 90, 'Voiding a served round restores its stock');
const afterVoid = (await request(`/table-sessions/${qa2SessionId}`, { token })).data.session;
assert.equal(Number(afterVoid.billTotal), 1 * 1200, 'A voided round drops out of the bill');
assert.equal(afterVoid.orders.some((order) => order.state === 'voided'), true, 'Voided rounds stay visible in history');

await request(`/table-sessions/${qa2SessionId}/orders`, { method: 'POST', token, key: `final-round-${suffix}`, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '1' }], serveNow: true } });
await request(`/table-sessions/${qa2SessionId}/payments`, { method: 'POST', token, key: `final-pay-${suffix}`, body: { method: 'cash', amount: String(2 * 1200) } });
const mergedClose = await request(`/table-sessions/${qa2SessionId}/close`, { method: 'POST', token, body: {} });
assert.equal(mergedClose.status, 201, `Merged/transferred session close failed: ${mergedClose.data.error}`);

// ── Anonymous walk-in unaffected (spec 7A.6 test 45 / 16.45) ───────────
const walkIn = await request('/sales', { method: 'POST', token, key: `walkin-${suffix}`, body: {
  items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '2' }, { productId: product.id, unitId: crateUnit.id, quantity: '1' }],
  payments: [{ method: 'cash', amount: String(2 * 1200 + 22000) }],
} });
assert.equal(walkIn.status, 201, `Walk-in sale failed: ${walkIn.data.error}`);
assert.equal(await stockOf(), 89 - 22, 'Walk-in sales deduct bottle and crate quantities in base units (spec 16.30)');
const walkInDetail = await request(`/sales/${walkIn.data.sale.id}`, { token });
assert.equal(walkInDetail.data.sale.tableCode, null, 'Walk-in sales carry no table');
assert.equal(walkInDetail.data.sale.customerName, 'Walk-in customer', 'Walk-in sales stay anonymous');

// ── Credit transfer stays separate from open tabs (spec 7A.6 test 8) ───
const creditOpen = await request(`/floor/tables/${tables[1].id}/sessions`, { method: 'POST', token, body: {} });
const creditSessionId = creditOpen.data.session.id;
await request(`/table-sessions/${creditSessionId}/orders`, { method: 'POST', token, key: `credit-${suffix}`, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '4' }], serveNow: true } });
const unpaidClose = await request(`/table-sessions/${creditSessionId}/close`, { method: 'POST', token, body: {} });
assert.equal(unpaidClose.status, 400, 'Closing an unpaid bill without a credit customer must be rejected');
const customer = await request('/customers', { method: 'POST', token, body: { name: `Tab regular ${suffix}` } });
const creditClose = await request(`/table-sessions/${creditSessionId}/close`, { method: 'POST', token, body: { customerId: customer.data.customer.id } });
assert.equal(creditClose.status, 201, `Credit close failed: ${creditClose.data.error}`);
const creditSale = (await request(`/sales/${creditClose.data.sale.id}`, { token })).data.sale;
assert.equal(Number(creditSale.balanceDue), 4 * 1200, 'The unpaid balance becomes customer credit');
const customersAfter = (await request('/customers', { token })).data.items.find((entry) => entry.id === customer.data.customer.id);
assert.equal(Number(customersAfter.balanceDue), 4 * 1200, 'Open tabs and customer credit debts stay separate accounts');
const repayment = await request(`/debts/${customer.data.customer.id}/payments`, { method: 'POST', token, key: `repay-${suffix}`, body: { method: 'cash', amount: String(4 * 1200) } });
assert.equal(repayment.status, 201, `Repayment failed: ${repayment.data.error}`);
const customersSettled = (await request('/customers', { token })).data.items.find((entry) => entry.id === customer.data.customer.id);
assert.equal(Number(customersSettled.balanceDue), 0, 'Repayment clears the debt without a second sale');

// ── Held carts never move stock (spec 3.3) ─────────────────────────────
const held = await request('/held-sales', { method: 'POST', token, body: { label: `Counter hold ${suffix}`, items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '2' }] } });
assert.equal(held.status, 201, `Held cart failed: ${held.data.error}`);
const heldStock = await stockOf();
assert.equal((await request('/held-sales', { token })).data.items.some((entry) => entry.id === held.data.held.id), true, 'Held carts are listed for resume');
assert.equal((await request(`/held-sales/${held.data.held.id}`, { method: 'DELETE', token })).status, 200, 'Held carts can be discarded');
assert.equal(await stockOf(), heldStock, 'Held carts never touch stock');

// ── Table reports (spec 10) ────────────────────────────────────────────
const reports = await request('/reports/tables', { token });
assert.equal(reports.status, 200, `Table reports failed: ${reports.data.error}`);
assert.equal(Array.isArray(reports.data.openTabs) && reports.data.openTabs.length, 0, 'Fully settled tabs leave no open-tab report rows');
assert.ok(reports.data.salesByTable.some((row) => row.tableCode === 'T01'), 'Sales by table include the transferred table');
assert.ok(reports.data.waiterPerformance.some((row) => row.waiterName === 'Table Smoke Owner'), 'Waiter performance is reported');
assert.ok(reports.data.tableTurnover.some((row) => row.tableCode === 'T01'), 'Table turnover is reported');

const stillOpen = (await request('/floor', { token })).data.tables.filter((table) => table.effectiveStatus === 'occupied');
assert.equal(stillOpen.length, 0, `Every test table must end available (leftover: ${stillOpen.map((table) => table.code).join(', ')})`);

console.log('Table service integration: all assertions passed.');
