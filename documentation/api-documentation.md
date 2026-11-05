# API reference (v0.1)

Base URL: `http://localhost:5000/api`. Private requests use `Authorization: Bearer <JWT>`. JSON errors use `{ "error": "message" }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | API health |
| POST | `/auth/bootstrap` | One-time first owner and business setup |
| POST | `/auth/login` | Authenticate |
| GET | `/auth/me` | Current account |
| GET/POST | `/products` | List/create active products |
| PATCH | `/products/:productId` | Update product name, SKU, category, sale price, and low-stock threshold |
| GET/POST | `/products/:productId/units` | List/define product packaging conversions |
| GET/POST | `/categories` | List/create product categories |
| PATCH | `/categories/:categoryId` | Rename, archive, or restore a category |
| GET | `/pos/catalog` | Product and package list with available stock |
| POST | `/inventory/:productId/adjustments` | Audited stock correction |
| GET/POST | `/suppliers` | List/create suppliers with outstanding balances |
| GET/POST | `/purchases` | List/receive purchases (atomically adds stock and records payments/debt) |
| GET | `/purchases/:purchaseId` | Purchase details, returnable quantities, and return history |
| POST | `/purchases/:purchaseId/returns` | Return received stock, reduce supplier payable, and record any supplier refund received |
| POST | `/suppliers/:supplierId/payments` | Pay and allocate an outstanding supplier balance |
| GET/POST | `/customers` | List/create customers |
| GET | `/customers/:customerId/sales` | Customer sales history |
| GET/POST | `/sales` | List/complete sales |
| GET | `/sales/:saleId` | Sale details and receipt data |
| POST | `/sales/:saleId/returns` | Return sold items, apply customer credit, and record required refunds |
| POST | `/debts/:customerId/payments` | Receive and allocate customer debt payment |
| GET/POST | `/expenses` | List/record expenses |
| GET/POST | `/cash-sessions` | List/open till sessions |
| POST | `/cash-sessions/:sessionId/close` | Reconcile a till |
| GET | `/dashboard` | Database-backed daily summary |
| GET | `/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` | Financial, payment, stock, and product summary |
| GET/POST | `/users` | Owner-only staff list/create |
| PATCH | `/users/:userId/active` | Owner-only account activation |
| GET | `/audit-logs` | Owner-only audit history |

Sale creation requires a unique `Idempotency-Key` header. Body: `{ "customerId": null, "items": [{"productId":"uuid","unitId":"optional-unit-uuid","quantity":"2"}], "payments": [{"method":"cash","amount":"4000.00"}] }`. A remaining balance requires a customer. Payments are the amounts applied to the sale and cannot exceed the total. If `unitId` is omitted, the configured base unit is used.

Product creation accepts `{ "name":"Primus", "sku":"optional", "categoryId":"optional-category-uuid", "baseUnit":"bottle", "sellingPrice":"2000", "costPrice":"1000", "lowStockThreshold":"0" }`. A zero low-stock threshold is valid. Product edits preserve the base unit and weighted-average cost; they can change the name, SKU, category, selling price, and threshold.

Each sale line snapshots its category name when the sale is recorded. Renaming, archiving, or reassigning a product category affects later sales but does not change category reporting for earlier sales.

Purchase receiving accepts `{ "supplierId":"uuid", "items":[{"productId":"uuid","unitId":"uuid","quantity":"5","unitCost":"15000"}], "payments":[{"method":"bank_transfer","amount":"25000"}] }`. Received stock is converted to the product's base unit and product cost is updated using a weighted average. Any unpaid total becomes supplier debt.

Both return endpoints require a unique `Idempotency-Key` header. A sales return body is `{ "items":[{"saleItemId":"uuid","quantity":"1","restock":true}], "payments":[{"method":"mobile_money","amount":"2000"}], "reason":"optional" }`. The item quantity is capped at the sold quantity less earlier returns. `restock` must be true only for items accepted back into saleable stock. The backend calculates the return value at the original sale price, applies it to the outstanding customer balance first, and requires payment lines for exactly the remaining refund. Refunds cannot exceed net amounts collected. Cash refunds require an open session.

A purchase return body is `{ "items":[{"purchaseItemId":"uuid","quantity":"1"}], "payments":[{"method":"cash","amount":"5000"}], "reason":"optional" }`. The backend caps quantity at the received amount less earlier returns and requires enough current stock. It values the return at the original purchase unit cost, reduces that purchase's payable first, and requires payment lines for the exact excess refund received from the supplier. The API does not carry a supplier credit forward when a refund is not paid immediately. Cash receipts require an open session.
