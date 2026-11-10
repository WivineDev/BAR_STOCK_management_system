# API reference (v0.1)

Base URL: `http://localhost:5102/api` in development (the backend port comes from `backend/.env`). Private requests use `Authorization: Bearer <JWT>`. JSON errors use `{ "error": "message" }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | API health |
| POST | `/auth/bootstrap` | One-time first owner and business setup |
| POST | `/auth/login` | Authenticate |
| GET | `/auth/me` | Current account |
| GET/POST | `/products` | List/create active products |
| PATCH | `/products/:productId` | Update product name, SKU, category, sale price, and low-stock threshold |
| GET/POST | `/products/:productId/units` | List/define product packaging conversions |
| PATCH | `/products/:productId/units/:unitId` | Owner/manager update of a packaging conversion's factor and prices; the base unit is immutable |
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
| GET | `/sales/:saleId` | Sale details and receipt data (includes `salesChannel` and, for table sales, `tableCode`, `tableName`, `areaName`, `tableSessionId`) |
| POST | `/sales/:saleId/returns` | Return sold items, apply customer credit, and record required refunds |
| POST | `/debts/:customerId/payments` | Receive and allocate customer debt payment |
| GET/POST | `/expenses` | List/record expenses |
| GET/POST | `/cash-sessions` | List/open till sessions |
| POST | `/cash-sessions/:sessionId/close` | Reconcile a till |
| GET | `/dashboard` | Database-backed daily summary |
| GET | `/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` | Financial, payment, stock, and product summary |
| GET | `/reports/tables` | Owner/manager/accountant table-service report: open tabs, sales by table/area, waiter performance, table turnover |
| GET | `/floor` | Floor layout: areas plus tables with effective occupancy, bill, and paid amounts |
| GET | `/floor/staff` | Active owner/manager/cashier staff list for waiter assignment |
| POST | `/floor/areas`¹ | Create a floor area (e.g. Main Hall, Terrace) |
| PATCH | `/floor/areas/:areaId`¹ | Rename, reorder, activate, or deactivate an area |
| POST | `/floor/tables`¹ | Create a numbered table in an area |
| PATCH | `/floor/tables/:tableId`¹ | Edit a table's code, name, area, capacity, status, or position |
| POST | `/floor/tables/:tableId/sessions` | Open a table tab — anonymous, no customer required |
| GET | `/table-sessions/open` | Open tabs with bills, payments, and waiters |
| GET | `/table-sessions/:sessionId` | Full bill: rounds, items, payments, balance |
| POST | `/table-sessions/:sessionId/orders`² | Record a round of items as draft or served |
| POST | `/orders/:orderId/serve` | Confirm a draft round as served (deducts stock once; idempotent) |
| POST | `/orders/:orderId/void` | Void a round; served rounds restore their stock |
| POST | `/table-sessions/:sessionId/payments`² | Apply a payment to the table bill (split allowed) |
| POST | `/table-sessions/:sessionId/close` | Settle and close the tab into a sale (idempotent) |
| PATCH | `/table-sessions/:sessionId/waiter` | Assign or clear the serving waiter |
| POST | `/table-sessions/:sessionId/transfer`³ | Move the session to a free table |
| POST | `/table-sessions/:sessionId/merge`³ | Merge the session's rounds and payments into another open session |
| GET/POST | `/held-sales` | List/hold a cart for later resume |
| DELETE | `/held-sales/:heldSaleId` | Discard a held cart |
| GET/POST | `/users` | Owner-only staff list/create |
| PATCH | `/users/:userId/active` | Owner-only account activation |
| GET | `/audit-logs` | Owner-only audit history |

¹ Floor configuration is restricted to owners and managers. ² Requires a unique `Idempotency-Key` header. ³ Transfer and merge are restricted to owners and managers.

Sale creation requires a unique `Idempotency-Key` header. Body: `{ "customerId": null, "items": [{"productId":"uuid","unitId":"optional-unit-uuid","quantity":"2"}], "payments": [{"method":"cash","amount":"4000.00"},{"method":"mobile_money","amount":"2000.00","reference":"MM-778812"}], "discount":"500" }`. A remaining balance requires a customer. Payments are the amounts applied to the sale and cannot exceed the total. Electronic payment lines (non-cash methods) accept an optional `reference` string of up to 120 characters, captured at confirmation time per spec v2.1 §3.2.7; cash lines record only the sale cash value and never the gross tendered amount (§3.2.6). If `unitId` is omitted, the configured base unit is used. The optional `discount` is a non-negative amount deducted from the subtotal; it cannot exceed the subtotal and only owners and managers may apply it (cashiers receive `403`). The sale stores the subtotal, discount, and the discounted total.

Product creation accepts `{ "name":"Primus", "sku":"optional", "categoryId":"optional-category-uuid", "baseUnit":"bottle", "sellingPrice":"2000", "costPrice":"1000", "lowStockThreshold":"0" }`. A zero low-stock threshold is valid. Product edits preserve the base unit and weighted-average cost; they can change the name, SKU, category, selling price, and threshold.

Each sale line snapshots its category name when the sale is recorded. Renaming, archiving, or reassigning a product category affects later sales but does not change category reporting for earlier sales.

Purchase receiving accepts `{ "supplierId":"uuid", "items":[{"productId":"uuid","unitId":"uuid","quantity":"5","unitCost":"15000"}], "payments":[{"method":"bank_transfer","amount":"25000"}] }`. Received stock is converted to the product's base unit and product cost is updated using a weighted average. Any unpaid total becomes supplier debt.

Both return endpoints require a unique `Idempotency-Key` header. A sales return body is `{ "items":[{"saleItemId":"uuid","quantity":"1","restock":true}], "payments":[{"method":"mobile_money","amount":"2000"}], "reason":"optional" }`. The item quantity is capped at the sold quantity less earlier returns. `restock` must be true only for items accepted back into saleable stock. The backend calculates the return value at the original sale price, applies it to the outstanding customer balance first, and requires payment lines for exactly the remaining refund. Refunds cannot exceed net amounts collected. Cash refunds require an open session.

A purchase return body is `{ "items":[{"purchaseItemId":"uuid","quantity":"1"}], "payments":[{"method":"cash","amount":"5000"}], "reason":"optional" }`. The backend caps quantity at the received amount less earlier returns and requires enough current stock. It values the return at the original purchase unit cost, reduces that purchase's payable first, and requires payment lines for the exact excess refund received from the supplier. The API does not carry a supplier credit forward when a refund is not paid immediately. Cash receipts require an open session.

Packaging conversions are per product: `{ "unitName":"crate", "factorToBase":"20", "sellingPrice":"22000", "purchasePrice":"12000" }`. The `factorToBase` records how many base units one package contains and is snapshotted onto every purchase, sale, and table-order line, so later edits only affect future transactions. The base unit of a product cannot be changed after creation, and conversions cannot be edited for inactive products.

## Table service (spec v2.1 §7A)

A table session models one occupied table. Opening accepts an optional waiter (`{ "waiterId":"uuid" }`); no customer identity is required — the customers are anonymous until payment. The database enforces a single open session per table, so concurrent open attempts receive `409`.

Rounds are ordered with a unique `Idempotency-Key` and body `{ "items":[{"productId":"uuid","unitId":"uuid","quantity":"3"}], "serveNow":false, "notes":"optional" }`. With `serveNow:false` the round is saved as a draft that does not touch stock. `POST /orders/:orderId/serve` confirms it; stock is deducted exactly once at that moment, and serving more than the available stock is rejected with `409`. Serving is idempotent — a repeated call returns the original result with `repeated:true`.

`POST /orders/:orderId/void` with `{ "reason":"text" }` discards a round. A voided draft never touched stock; voiding a served round returns its stock through a `serving_void` movement and drops the line from the bill while keeping it visible in history. Tables whose bill has already been overpaid cannot void a served round.

Table payments accept `{ "method":"cash", "amount":"5000" }` (methods: `cash`, `mobile_money`, `card`, `bank_transfer`) and cannot exceed the outstanding bill; a bill may be split across several payments. Electronic methods accept an optional `reference` (≤120 characters) recorded on the payment and copied to the sale at close. Cash table payments require an open cash session and create cash movements. `POST /table-sessions/:sessionId/close` settles the tab: served items and payments are copied into one `sales` record with `sales_channel:'TABLE'` and the table context, the table becomes available, and the close is idempotent. An unpaid balance at close requires a registered customer and owner or manager authority; the balance flows into the customer's credit account exactly like a regular credit sale. Table credit never shares an account with open tabs.

`POST /table-sessions/:sessionId/transfer` accepts `{ "targetTableId":"uuid", "reason":"text" }` and moves the whole session to a free table. `POST /table-sessions/:sessionId/merge` accepts `{ "targetSessionId":"uuid", "reason":"text" }`, moves all rounds and payments into the target session (renumbering rounds), and frees the source table. Both preserve full round and payment history.

Held carts store `{ "label":"text", "items":[{"productId":"uuid","unitId":"uuid","quantity":"2"}] }` for later resume. Holding and discarding never touch stock, revenue, or debt.
