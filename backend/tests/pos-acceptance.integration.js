// POS acceptance suite — asserts the ten point-of-sale requirements end to end
// against a real server. Run through tests/run-pos-acceptance.mjs (isolated
// throwaway database) or directly against a running server:
//   BSSBMS_TEST_API=http://localhost:5102/api node tests/pos-acceptance.integration.js
//
// Requirements covered (user spec, POS must support):
//  1. Searching products by name or barcode (sku)
//  2. Selecting beverages
//  3. Entering quantities
//  4. Selecting selling units
//  5. Automatically calculating subtotals
//  6. Calculating the total bill
//  7. Applying authorized discounts
//  8. Selecting payment methods
//  9. Printing or downloading receipts (the sale-detail payload that feeds them)
// 10. Automatically reducing stock after a completed sale
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
const barcode = `RW-BC-${suffix}`; // products.sku doubles as the barcode
const ownerPassword = `PosSmoke-${randomUUID()}!`;
const setup = await request('/auth/bootstrap', { method: 'POST', body: {
  businessName: `BSSBMS pos ${suffix}`, name: 'POS Smoke Owner', email: `owner-${suffix}@example.test`, password: ownerPassword,
} });
assert.equal(setup.status, 201, `Owner bootstrap failed: ${setup.data.error || setup.status}`);
const token = setup.data.token;

// A cashier rings up the sale; the owner authorizes the discount.
const cashierPassword = `Cashier-${randomUUID()}!`;
const cashier = await request('/users', { method: 'POST', token, body: { name: 'POS Smoke Cashier', email: `cashier-${suffix}@example.test`, password: cashierPassword, role: 'cashier' } });
assert.equal(cashier.status, 201, `Cashier creation failed: ${cashier.data.error}`);
const cashierLogin = await request('/auth/login', { method: 'POST', body: { email: cashier.data.user.email, password: cashierPassword } });
assert.equal(cashierLogin.status, 200, `Cashier login failed: ${cashierLogin.data.error}`);
const cashierToken = cashierLogin.data.token;

const cashierSession = await request('/cash-sessions', { method: 'POST', token: cashierToken, body: { openingBalance: '10000' } });
assert.equal(cashierSession.status, 201, `Cashier cash session failed: ${cashierSession.data.error}`);

const category = await request('/categories', { method: 'POST', token, body: { name: `Beers ${suffix}` } });
assert.equal(category.status, 201, `Category creation failed: ${category.data.error}`);
const productResponse = await request('/products', { method: 'POST', token, body: {
  name: `Mutzig ${suffix}`, sku: barcode, categoryId: category.data.category.id, baseUnit: 'bottle', sellingPrice: '1000', costPrice: '600', lowStockThreshold: '0',
} });
assert.equal(productResponse.status, 201, `Product creation failed: ${productResponse.data.error}`);
const product = productResponse.data.product;
const crate = await request(`/products/${product.id}/units`, { method: 'POST', token, body: { unitName: 'crate', factorToBase: '12', sellingPrice: '12000', purchasePrice: '6500' } });
assert.equal(crate.status, 201, `Crate unit creation failed: ${crate.data.error}`);

const openingStock = await request(`/inventory/${product.id}/adjustments`, { method: 'POST', token, body: { quantity: '50', notes: 'POS acceptance opening stock' } });
assert.equal(openingStock.status, 201, `Opening stock failed: ${openingStock.data.error}`);
const stockOf = async () => Number((await request('/pos/catalog', { token: cashierToken })).data.items.find((item) => item.id === product.id).stockQuantity);
assert.equal(await stockOf(), 50, 'Stock should start at 50 bottles');

// ── 1. Search products by name or barcode ───────────────────────────────
const catalog = await request('/pos/catalog', { token: cashierToken });
assert.equal(catalog.status, 200, 'Cashier catalog lookup failed');
const catalogItem = catalog.data.items.find((item) => item.id === product.id);
assert.ok(catalogItem, 'The beverage must appear in the POS catalog');
assert.equal(catalogItem.sku, barcode, 'The catalog must expose the barcode (sku) so the POS can search or scan by it');
const byName = await request(`/products?search=${encodeURIComponent(`Mutzig ${suffix}`)}`, { token });
assert.ok(byName.data.items.some((item) => item.id === product.id), 'Searching by product name must find the product');
const byBarcode = await request(`/products?search=${encodeURIComponent(barcode)}`, { token });
assert.ok(byBarcode.data.items.some((item) => item.id === product.id), 'Searching by barcode/sku must find the product');
const byNothing = await request(`/products?search=${encodeURIComponent('no-such-drink-anywhere')}`, { token });
assert.ok(!byNothing.data.items.some((item) => item.id === product.id), 'Search must not match unrelated products');

// ── 2. Selecting beverages ─────────────────────────────────────────────
assert.equal(catalogItem.categoryName, category.data.category.name, 'Catalog entries carry their category for the beverage picker');
assert.equal(Number(catalogItem.stockQuantity), 50, 'Catalog entries carry live stock for availability');
assert.equal(catalogItem.units.length, 2, 'Both selling units must be selectable');
const bottleUnit = catalogItem.units.find((unit) => Number(unit.isBase) === 1);
const crateUnit = catalogItem.units.find((unit) => unit.unitName === 'crate');
assert.ok(bottleUnit && crateUnit, 'Base and crate selling units must both exist');
assert.equal(Number(crateUnit.factorToBase), 12, 'Selling units carry their conversion factor');

// ── 3. Entering quantities ─────────────────────────────────────────────
const zeroQty = await request('/sales', { method: 'POST', token: cashierToken, key: `pos-zero-${suffix}`, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '0' }], payments: [{ method: 'cash', amount: '0' }] } });
assert.equal(zeroQty.status, 400, 'A zero quantity must be rejected');
assert.equal((zeroQty.data.error || '').length > 0, true);
const tooMany = await request('/sales', { method: 'POST', token: cashierToken, key: `pos-toomuch-${suffix}`, body: {
  items: [{ productId: product.id, unitId: crateUnit.id, quantity: '30' }], payments: [{ method: 'cash', amount: '360000' }],
} });
assert.equal(tooMany.status, 409, 'Selling beyond stock must be rejected');
assert.equal(await stockOf(), 50, 'Rejected sales must leave stock untouched');

// ── 7. Applying authorized discounts (cashier must be refused) ─────────
const cashierDiscount = await request('/sales', { method: 'POST', token: cashierToken, key: `pos-cashdisc-${suffix}`, body: {
  items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '2' }],
  payments: [{ method: 'cash', amount: '1500' }], discount: '500',
} });
assert.equal(cashierDiscount.status, 403, 'A cashier must not be allowed to apply a discount');
assert.match(cashierDiscount.data.error || '', /owner or manager/i, 'The refusal must explain who can authorize discounts');
assert.equal(await stockOf(), 50, 'A refused discount sale must not touch stock');

// ── 4, 5, 6, 8, 10. A complete sale: units, subtotals, total, split payment, stock ──
// 3 bottles @ 1000 + 2 crates @ 12000 = 27 000; paid 5 000 cash + 22 000 mobile money.
const saleKey = `pos-sale-${suffix}`;
const mmReference = `MM-${suffix}-778812`;
const saleResponse = await request('/sales', { method: 'POST', token: cashierToken, key: saleKey, body: {
  items: [
    { productId: product.id, unitId: bottleUnit.id, quantity: '3' },
    { productId: product.id, unitId: crateUnit.id, quantity: '2' },
  ],
  payments: [ { method: 'cash', amount: '5000' }, { method: 'mobile_money', amount: '22000', reference: mmReference } ],
} });
assert.equal(saleResponse.status, 201, `Sale failed: ${saleResponse.data.error}`);
const sale = saleResponse.data.sale;
assert.equal(Number(sale.subtotal), 27000, 'The subtotal must be the sum of per-line unit prices times quantities');
assert.equal(Number(sale.total), 27000, 'The total bill must equal the subtotal when no discount applies');
assert.equal(Number(sale.amountPaid), 27000, 'Both split payments count toward the amount paid');
assert.equal(Number(sale.balanceDue), 0, 'A fully paid sale leaves no balance');
assert.equal(await stockOf(), 50 - (3 + 2 * 12), 'Stock must reduce automatically by the base-unit quantity (3 bottles + 2 crates of 12)');

// Retrying with the same idempotency key must not double-charge or double-deduct.
const saleRetry = await request('/sales', { method: 'POST', token: cashierToken, key: saleKey, body: { items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '3' }], payments: [] } });
assert.equal(saleRetry.status, 200, 'Idempotent retries should return the original sale');
assert.equal(saleRetry.data.sale.id, sale.id, 'A retried sale must return the same sale');
assert.equal(await stockOf(), 23, 'An idempotent retry must not deduct stock again');

// ── 6, 7. Total bill with an authorized discount (owner) ────────────────
const discountedKey = `pos-discount-${suffix}`;
const discounted = await request('/sales', { method: 'POST', token, key: discountedKey, body: {
  items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '2' }],
  payments: [{ method: 'mobile_money', amount: '1500' }], discount: '500',
} });
assert.equal(discounted.status, 201, `Discounted sale failed: ${discounted.data.error}`);
assert.equal(Number(discounted.data.sale.subtotal), 2000, 'Discounted sale subtotal is before the discount');
assert.equal(Number(discounted.data.sale.discountAmount), 500, 'The authorized discount is recorded on the sale');
assert.equal(Number(discounted.data.sale.total), 1500, 'The total bill must be the subtotal minus the discount');
assert.equal(await stockOf(), 23 - 2, 'The discounted sale also reduces stock automatically');

const excessive = await request('/sales', { method: 'POST', token, key: `pos-excess-${suffix}`, body: {
  items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '1' }],
  payments: [{ method: 'mobile_money', amount: '1' }], discount: '999999',
} });
assert.equal(excessive.status, 400, 'A discount larger than the subtotal must be rejected');

// ── 8. Payment methods ─────────────────────────────────────────────────
const badMethod = await request('/sales', { method: 'POST', token: cashierToken, key: `pos-badpay-${suffix}`, body: {
  items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '1' }], payments: [{ method: 'crypto', amount: '1000' }],
} });
assert.equal(badMethod.status, 400, 'Unsupported payment methods must be rejected');
const overpay = await request('/sales', { method: 'POST', token: cashierToken, key: `pos-overpay-${suffix}`, body: {
  items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '1' }], payments: [{ method: 'cash', amount: '5000' }],
} });
assert.equal(overpay.status, 400, 'Paying more than the total must be rejected');
const badReference = await request('/sales', { method: 'POST', token: cashierToken, key: `pos-badref-${suffix}`, body: {
  items: [{ productId: product.id, unitId: bottleUnit.id, quantity: '1' }], payments: [{ method: 'mobile_money', amount: '1000', reference: 12345 }],
} });
assert.equal(badReference.status, 400, 'Non-text payment references must be rejected (spec 3.2.7)');

// ── 9. Printing or downloading receipts ────────────────────────────────
const detail = await request(`/sales/${sale.id}`, { token: cashierToken });
assert.equal(detail.status, 200, `Sale detail lookup failed: ${detail.data.error}`);
const receipt = detail.data.sale;
assert.match(receipt.reference, /^S-/, 'Receipts carry a human-readable sale reference');
assert.equal(receipt.cashierName, 'POS Smoke Cashier', 'Receipts name the cashier');
assert.equal(receipt.items.length, 2, 'Receipts list every line');
const bottleLine = receipt.items.find((line) => line.unit === 'bottle');
const crateLine = receipt.items.find((line) => line.unit === 'crate');
assert.ok(bottleLine && crateLine, 'Receipt lines name their selling unit');
assert.equal(Number(bottleLine.lineTotal), 3000, 'Receipt lines carry per-line subtotals');
assert.equal(Number(crateLine.lineTotal), 24000, 'Crate lines are priced by the crate selling unit');
assert.equal(receipt.payments.length, 2, 'Receipts show every payment method used');
assert.ok(receipt.payments.some((payment) => payment.method === 'cash') && receipt.payments.some((payment) => payment.method === 'mobile_money'), 'Split payment methods appear on the receipt');
assert.equal(receipt.payments.find((payment) => payment.method === 'mobile_money').reference, mmReference, 'Electronic payment references are captured at confirmation and returned for receipts (spec 3.2.7)');
assert.equal(receipt.payments.find((payment) => payment.method === 'cash').reference, null, 'Cash payments record only the sale cash value, never tendered cash (spec 3.2.6)');
assert.equal(Number(receipt.total), 27000, 'Receipts show the total bill');

// 10 re-check: the rejected payments and the retried sale left stock intact.
assert.equal(await stockOf(), 21, 'No rejected request may change stock');

console.log('POS acceptance suite passed: all 10 requirements verified.');
