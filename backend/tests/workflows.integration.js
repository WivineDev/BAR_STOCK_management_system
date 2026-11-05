import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const api = process.env.BSSBMS_TEST_API || 'http://localhost:5000/api';
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
const ownerPassword = `LocalSmoke-${randomUUID()}!`;
const setup = await request('/auth/bootstrap', { method: 'POST', body: {
  businessName: `BSSBMS smoke ${suffix}`, name: 'Smoke Owner', email: `owner-${suffix}@example.test`, password: ownerPassword,
} });
assert.equal(setup.status, 201, `Owner bootstrap failed: ${setup.data.error || setup.status}`);
const token = setup.data.token;

const staffPassword = `StaffSmoke-${randomUUID()}!`;
const staff = await request('/users', { method: 'POST', token, body: { name: 'Smoke Cashier', email: `cashier-${suffix}@example.test`, password: staffPassword, role: 'cashier' } });
assert.equal(staff.status, 201, `Staff account creation failed: ${staff.data.error}`);
const staffLogin = await request('/auth/login', { method: 'POST', body: { email: staff.data.user.email, password: staffPassword } });
assert.equal(staffLogin.status, 200, 'Staff login should work');
assert.equal((await request('/users', { token: staffLogin.data.token })).status, 403, 'Staff must not access owner-only user administration');

const noToken = await request('/products');
assert.equal(noToken.status, 401, 'Private API should require authentication');

const categoryResponse = await request('/categories', { method: 'POST', token, body: { name: `Smoke drinks ${suffix}` } });
assert.equal(categoryResponse.status, 201, `Category creation failed: ${categoryResponse.data.error}`);
const productResponse = await request('/products', { method: 'POST', token, body: { name: `Smoke Primus ${suffix}`, sku: `SMOKE-${suffix}`, categoryId: categoryResponse.data.category.id, baseUnit: 'bottle', sellingPrice: '2000', costPrice: '1000', lowStockThreshold: '0' } });
assert.equal(productResponse.status, 201, `Product creation failed: ${productResponse.data.error}`);
const product = productResponse.data.product;
assert.equal(product.categoryId, categoryResponse.data.category.id, 'Product should persist its category');
assert.equal(product.lowStockThreshold, '0.000', 'A zero low-stock threshold should be accepted');
assert.equal((await request('/categories', { token })).data.items[0].name, categoryResponse.data.category.name);
const secondCategory = await request('/categories', { method: 'POST', token, body: { name: `Smoke packaged drinks ${suffix}` } });
assert.equal(secondCategory.status, 201);
const productUpdate = await request(`/products/${product.id}`, { method: 'PATCH', token, body: { name: product.name, sku: product.sku, categoryId: secondCategory.data.category.id, sellingPrice: '2000', lowStockThreshold: '0' } });
assert.equal(productUpdate.status, 200, `Product update failed: ${productUpdate.data.error}`);
assert.equal(productUpdate.data.product.categoryId, secondCategory.data.category.id, 'Existing products should be re-categorized');

const crateResponse = await request(`/products/${product.id}/units`, { method: 'POST', token, body: { unitName: 'crate', factorToBase: '20', sellingPrice: '35000', purchasePrice: '15000' } });
assert.equal(crateResponse.status, 201, `Packaging setup failed: ${crateResponse.data.error}`);
const crateUnit = crateResponse.data.unit;
const catalog = await request('/pos/catalog', { token });
assert.equal(catalog.data.items.find((item) => item.id === product.id).units.some((unit) => unit.id === crateUnit.id), true);

const openingStock = await request(`/inventory/${product.id}/adjustments`, { method: 'POST', token, body: { quantity: '100', notes: 'Integration opening stock' } });
assert.equal(openingStock.status, 201, `Opening stock failed: ${openingStock.data.error}`);
const supplierResponse = await request('/suppliers', { method: 'POST', token, body: { name: `Smoke Supplier ${suffix}` } });
assert.equal(supplierResponse.status, 201);
const supplierId = supplierResponse.data.supplier.id;
const purchase = await request('/purchases', { method: 'POST', token, body: { supplierId, items: [{ productId: product.id, unitId: crateUnit.id, quantity: '5', unitCost: '15000' }], payments: [{ method: 'mobile_money', amount: '5000' }] } });
assert.equal(purchase.status, 201, `Purchase receiving failed: ${purchase.data.error}`);
assert.equal(purchase.data.purchase.total, '75000.00');
assert.equal(purchase.data.purchase.balanceDue, '70000.00');
const receivedProducts = (await request('/products', { token })).data.items;
assert.equal(receivedProducts.find((item) => item.id === product.id).stockQuantity, '200.000', 'Five crates of twenty base units each must add one hundred base units');
assert.equal(receivedProducts.find((item) => item.id === product.id).costPrice, '875.00', 'Receiving should update the weighted-average base cost');
const supplierPayment = await request(`/suppliers/${supplierId}/payments`, { method: 'POST', token, body: { amount: '10000', method: 'mobile_money' } });
assert.equal(supplierPayment.status, 201, `Supplier payment failed: ${supplierPayment.data.error}`);
assert.equal(supplierPayment.data.payment.balanceDue, '60000.00');
const customerResponse = await request('/customers', { method: 'POST', token, body: { name: `Smoke Customer ${suffix}` } });
assert.equal(customerResponse.status, 201);
const customerId = customerResponse.data.customer.id;

const opened = await request('/cash-sessions', { method: 'POST', token, body: { openingBalance: '50000' } });
assert.equal(opened.status, 201, `Cash session open failed: ${opened.data.error}`);

const firstSaleKey = randomUUID();
const firstSaleBody = { customerId, items: [{ productId: product.id, quantity: 5 }], payments: [{ method: 'mobile_money', amount: '3000' }, { method: 'bank_transfer', amount: '2000' }] };
const partialSale = await request('/sales', { method: 'POST', token, key: firstSaleKey, body: firstSaleBody });
assert.equal(partialSale.status, 201, `Partial sale failed: ${partialSale.data.error}`);
assert.equal(partialSale.data.sale.total, '10000.00');
assert.equal(partialSale.data.sale.balanceDue, '5000.00');
const repeatedSale = await request('/sales', { method: 'POST', token, key: firstSaleKey, body: firstSaleBody });
assert.equal(repeatedSale.status, 200, 'Retry with the same idempotency key should return the original transaction');
assert.equal(repeatedSale.data.sale.repeated, true);

const saleDetailBeforeReturn = await request(`/sales/${partialSale.data.sale.id}`, { token });
const creditReturnKey = randomUUID();
const creditReturnBody = { items: [{ saleItemId: saleDetailBeforeReturn.data.sale.items[0].id, quantity: '1', restock: true }], reason: 'Integration return accepted for resale' };
const creditReturn = await request(`/sales/${partialSale.data.sale.id}/returns`, { method: 'POST', token, key: creditReturnKey, body: creditReturnBody });
assert.equal(creditReturn.status, 201, `Sales return failed: ${creditReturn.data.error}`);
assert.equal(creditReturn.data.salesReturn.total, '2000.00');
assert.equal(creditReturn.data.salesReturn.creditApplied, '2000.00');
assert.equal(creditReturn.data.salesReturn.refundAmount, '0.00');
assert.equal(creditReturn.data.salesReturn.balanceDue, '3000.00');
const duplicateCreditReturn = await request(`/sales/${partialSale.data.sale.id}/returns`, { method: 'POST', token, key: creditReturnKey, body: creditReturnBody });
assert.equal(duplicateCreditReturn.status, 200, 'Retry with the same return idempotency key must not duplicate stock or credit');
assert.equal(duplicateCreditReturn.data.salesReturn.repeated, true);
const excessiveReturn = await request(`/sales/${partialSale.data.sale.id}/returns`, { method: 'POST', token, key: randomUUID(), body: { items: [{ saleItemId: saleDetailBeforeReturn.data.sale.items[0].id, quantity: '5', restock: true }] } });
assert.equal(excessiveReturn.status, 409, 'Sales returns cannot exceed the unreturned quantity');

const overpayment = await request(`/debts/${customerId}/payments`, { method: 'POST', token, body: { amount: '4000', method: 'mobile_money' } });
assert.equal(overpayment.status, 400, 'Customer debt payment must not exceed outstanding balance');
const paidDebt = await request(`/debts/${customerId}/payments`, { method: 'POST', token, body: { amount: '3000', method: 'mobile_money' } });
assert.equal(paidDebt.status, 201, `Debt payment failed: ${paidDebt.data.error}`);
assert.equal(paidDebt.data.payment.outstanding, '0.00');

const crateSale = await request('/sales', { method: 'POST', token, key: randomUUID(), body: { items: [{ productId: product.id, unitId: crateUnit.id, quantity: '1' }], payments: [{ method: 'mobile_money', amount: '35000' }] } });
assert.equal(crateSale.status, 201, `Package sale failed: ${crateSale.data.error}`);
const afterCrateSale = (await request('/products', { token })).data.items;
assert.equal(afterCrateSale.find((item) => item.id === product.id).stockQuantity, '176.000', 'Selling one crate must deduct twenty base units after the earlier one-bottle sale return');

const replenishment = await request(`/inventory/${product.id}/adjustments`, { method: 'POST', token, body: { quantity: '50', notes: 'Integration stock top-up' } });
assert.equal(replenishment.status, 201);
const cashSaleKey = randomUUID();
const cashSaleBody = { items: [{ productId: product.id, quantity: 50 }], payments: [{ method: 'cash', amount: '100000' }] };
const cashSale = await request('/sales', { method: 'POST', token, key: cashSaleKey, body: cashSaleBody });
assert.equal(cashSale.status, 201, `Cash sale failed: ${cashSale.data.error}`);
assert.equal(cashSale.data.sale.total, '100000.00');
const cashSaleRetry = await request('/sales', { method: 'POST', token, key: cashSaleKey, body: cashSaleBody });
assert.equal(cashSaleRetry.status, 200);

const expense = await request('/expenses', { method: 'POST', token, body: { category: 'Utilities', description: 'Integration cash expense', amount: '20000', paymentMethod: 'cash' } });
assert.equal(expense.status, 201, `Cash expense failed: ${expense.data.error}`);
const session = (await request('/cash-sessions', { token })).data.active;
assert.equal(session.expectedCash, '130000.00', 'Expected cash should be opening + cash sale - cash expense; non-cash receipts are excluded');

const unexplainedClose = await request(`/cash-sessions/${session.id}/close`, { method: 'POST', token, body: { actualCash: '129999' } });
assert.equal(unexplainedClose.status, 400, 'Cash discrepancy requires an explanation');
const closed = await request(`/cash-sessions/${session.id}/close`, { method: 'POST', token, body: { actualCash: '130000' } });
assert.equal(closed.status, 200, `Cash close failed: ${closed.data.error}`);
assert.equal(closed.data.session.variance, '0.00');

const cashSaleDetail = await request(`/sales/${cashSale.data.sale.id}`, { token });
const cashReturnKey = randomUUID();
const cashReturnBody = { items: [{ saleItemId: cashSaleDetail.data.sale.items[0].id, quantity: '1', restock: true }], payments: [{ method: 'cash', amount: '2000' }], reason: 'Integration cash refund' };
const closedTillCashReturn = await request(`/sales/${cashSale.data.sale.id}/returns`, { method: 'POST', token, key: cashReturnKey, body: cashReturnBody });
assert.equal(closedTillCashReturn.status, 409, 'Cash refunds require an open till session');
const secondTill = await request('/cash-sessions', { method: 'POST', token, body: { openingBalance: '5000' } });
assert.equal(secondTill.status, 201);
const cashReturn = await request(`/sales/${cashSale.data.sale.id}/returns`, { method: 'POST', token, key: cashReturnKey, body: cashReturnBody });
assert.equal(cashReturn.status, 201, `Cash refund failed: ${cashReturn.data.error}`);
assert.equal(cashReturn.data.salesReturn.refundAmount, '2000.00');
const secondTillState = (await request('/cash-sessions', { token })).data.active;
assert.equal(secondTillState.expectedCash, '3000.00', 'A cash refund must reduce expected till cash');
const secondTillClose = await request(`/cash-sessions/${secondTillState.id}/close`, { method: 'POST', token, body: { actualCash: '3000' } });
assert.equal(secondTillClose.status, 200);

const purchaseDetail = await request(`/purchases/${purchase.data.purchase.id}`, { token });
assert.equal(purchaseDetail.status, 200);
const purchaseReturnKey = randomUUID();
const purchaseReturnBody = { items: [{ purchaseItemId: purchaseDetail.data.purchase.items[0].id, quantity: '1' }], reason: 'Integration supplier return' };
const purchaseReturn = await request(`/purchases/${purchase.data.purchase.id}/returns`, { method: 'POST', token, key: purchaseReturnKey, body: purchaseReturnBody });
assert.equal(purchaseReturn.status, 201, `Purchase return failed: ${purchaseReturn.data.error}`);
assert.equal(purchaseReturn.data.purchaseReturn.total, '15000.00');
assert.equal(purchaseReturn.data.purchaseReturn.payableCredit, '15000.00');
assert.equal(purchaseReturn.data.purchaseReturn.balanceDue, '45000.00');
const duplicatePurchaseReturn = await request(`/purchases/${purchase.data.purchase.id}/returns`, { method: 'POST', token, key: purchaseReturnKey, body: purchaseReturnBody });
assert.equal(duplicatePurchaseReturn.status, 200, 'Retrying a purchase return must not remove stock twice');
assert.equal(duplicatePurchaseReturn.data.purchaseReturn.repeated, true);
const excessivePurchaseReturn = await request(`/purchases/${purchase.data.purchase.id}/returns`, { method: 'POST', token, key: randomUUID(), body: { items: [{ purchaseItemId: purchaseDetail.data.purchase.items[0].id, quantity: '5' }] } });
assert.equal(excessivePurchaseReturn.status, 409, 'Purchase returns cannot exceed the unreturned quantity');

const insufficient = await request('/sales', { method: 'POST', token, key: randomUUID(), body: { items: [{ productId: product.id, quantity: 1000 }], payments: [] } });
assert.equal(insufficient.status, 409, 'Insufficient stock should reject the entire sale');
const finalProducts = (await request('/products', { token })).data.items;
assert.equal(finalProducts.find((item) => item.id === product.id).stockQuantity, '157.000');
const sales = await request('/sales', { token });
assert.equal(sales.data.items.length, 3, 'Failed and retried submissions must not create duplicate sales');
const saleDetails = await request(`/sales/${cashSale.data.sale.id}`, { token });
assert.equal(saleDetails.status, 200);
assert.equal(saleDetails.data.sale.items[0].quantity, '50.000');
const dashboard = await request('/dashboard', { token });
assert.equal(dashboard.data.customerDebt, '0.00');
assert.equal(dashboard.data.cashReceived, '98000.00');
assert.equal(dashboard.data.todayExpenses, '20000.00');
assert.equal(dashboard.data.supplierDebt, '45000.00');
const report = await request('/reports?from=2026-01-01&to=2026-12-31', { token });
assert.equal(report.status, 200, `Financial report failed: ${report.data.error}`);
assert.equal(report.data.sales.revenue, '141000.00');
assert.equal(report.data.sales.costOfGoodsSold, '63875.00');
assert.equal(report.data.sales.grossProfit, '77125.00');
assert.equal(report.data.sales.creditIssued, '3000.00');
assert.equal(report.data.salesByCategory[0].categoryName, secondCategory.data.category.name);
assert.equal(report.data.salesByCategory[0].revenue, '141000.00');
assert.equal(report.data.operatingExpenses, '20000.00');
assert.equal(report.data.operatingProfit, '57125.00');
assert.equal((await request('/reports?from=2026-99-99&to=2026-12-31', { token })).status, 400);
const laterCategory = await request('/categories', { method: 'POST', token, body: { name: `Smoke later group ${suffix}` } });
assert.equal(laterCategory.status, 201);
const recategorized = await request(`/products/${product.id}`, { method: 'PATCH', token, body: { name: product.name, sku: product.sku, categoryId: laterCategory.data.category.id, sellingPrice: '2000', lowStockThreshold: '0' } });
assert.equal(recategorized.status, 200);
const historicalCategoryReport = await request('/reports?from=2026-01-01&to=2026-12-31', { token });
assert.equal(historicalCategoryReport.data.salesByCategory[0].categoryName, secondCategory.data.category.name, 'Historical sales retain the category captured at sale time');
const archivedCategory = await request(`/categories/${secondCategory.data.category.id}`, { method: 'PATCH', token, body: { name: secondCategory.data.category.name, archived: true } });
assert.equal(archivedCategory.status, 200);
assert.equal((await request('/categories', { token })).data.items.some((category) => category.id === secondCategory.data.category.id), false, 'Archived categories should be hidden from active category lists');
assert.equal((await request('/categories?includeArchived=true', { token })).data.items.find((category) => category.id === secondCategory.data.category.id).archivedAt !== null, true, 'Owners can view archived categories');
const disabled = await request(`/users/${staff.data.user.id}/active`, { method: 'PATCH', token, body: { active: false } });
assert.equal(disabled.status, 200);
assert.equal((await request('/auth/login', { method: 'POST', body: { email: staff.data.user.email, password: staffPassword } })).status, 401, 'Deactivated users must not sign in');

console.log('Integration workflows passed: auth, role enforcement, deactivation, categories and product assignment, packaging conversion, purchase receiving, weighted-average cost, customer credit, sales and purchase returns, return idempotency and quantity limits, cash refunds, supplier credit, split payments, debt, expense, cash reconciliation, insufficient stock, receipt data, dashboard, category and financial reports.');
