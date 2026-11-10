# Development phase report

## Phase 1: foundation and first transactional slice

**Completed:** created the React/Vite frontend and Express/MySQL backend, migrations, environment templates, and user/developer documentation. Implemented owner bootstrap and login, coarse role-gated staff accounts, products and package conversions, suppliers and purchase receiving with weighted-average cost, inventory adjustments, customer balances and payments, split-payment POS sales, receipts, expenses, cash sessions and reconciliation, dashboard metrics, reports, and audit viewing.

**Main workflows and pages:** sign-in, dashboard, products, inventory, POS, sales, purchases, suppliers, customers/credit, expenses, cash, reports, and users. These are connected to the API and MySQL; the interface is not a static mockup.

## Phase 2: transactional returns

**Completed:** added migrations `0003_transaction_returns.sql` and `0004_sale_category_snapshot.sql`; sale item lines retain their unit conversion factor and category name at the time of sale. Added sales returns and purchase returns with item-level limits against original quantities, transaction-scoped idempotency keys, original transaction pricing, debt/payable adjustments, refunds, stock effects, audit entries, and cash movements. Sales returns can restore accepted items to saleable stock; damaged returns leave their cost in cost of goods sold. Reports subtract returns in the date period they are recorded.

**Return settlement rules:** sales returns reduce outstanding customer debt first. Any excess must be refunded and cannot exceed the net amount collected. Purchase returns reduce the purchase payable first; any excess must be received as an immediate supplier refund. Cash refunds and receipts require an open cash session. Carry-forward supplier credits are not supported.

**Files:** see `backend/src/routes/business.js`, `backend/database/migrations/0003_transaction_returns.sql`, `frontend/src/pages/Sales.jsx`, `frontend/src/pages/Purchases.jsx`, and updated API, database, architecture, user, testing, and installation documentation.

**Database:** added `sales_returns`, `sales_return_items`, `sales_return_payments`, `purchase_returns`, `purchase_return_items`, and `purchase_return_payments`; added `sale_items.factor_to_base`, `category_id`, and `category_name` as historical snapshots.

**APIs:** `POST /sales/:saleId/returns`, `GET /purchases/:purchaseId`, and `POST /purchases/:purchaseId/returns`. See [API documentation](api-documentation.md) for payloads and limits.

**Verification:** five automated unit tests pass. The API integration workflow passes against an isolated XAMPP MySQL database and includes authentication/role enforcement, categories and product edits, zero low-stock threshold, package conversion, purchase receiving and weighted-average cost, split payments, debt, both return types, return idempotency and quantity limits, stock restoration/removal, cash refund reconciliation, supplier payable credit, insufficient stock, dashboard values, category history snapshots, and return-adjusted reports. Vite production build succeeds. The local app database reports all four migrations applied. npm install's audit reported zero known vulnerabilities; a later standalone audit could not complete because the npm registry audit endpoint returned an error, so there is no current standalone audit result.

## Phase 3: product categories and editing

**Completed:** added category creation, rename, archive, and restore APIs and screens; products can be categorized at creation and recategorized when edited. Sales reports now group net quantities and revenue by category. Product edits preserve the original base unit and weighted-average cost. Fixed the default product entry failure: a zero low-stock threshold is now accepted by server validation.

**Verification:** integration covers category create/archive, product assignment/editing, category report aggregation, and product creation with a zero threshold.

## Phase 4: table service (spec v2.1 §7A)

**Completed:** added migration `0005_table_service.sql` — floor areas, numbered tables, table sessions, order rounds with items, table-session payments, held carts, and new movement/enum types; `sales` gained `table_session_id` and `sales_channel`. Built the floor-service API (`backend/src/routes/floor.js`): area/table configuration, anonymous table open (one open session per table enforced by the database), draft and served rounds, idempotent serve that deducts stock exactly once, void with stock restoration for served rounds, split payments with overpay guard, idempotent close that copies the bill into a `TABLE`-channel sale, waiter assignment, table transfer and merge with preserved history, held carts, and a table report endpoint. Editing packaging conversions after creation (`PATCH /products/:id/units/:unitId`) is supported; the base unit remains immutable and snapshots keep historical lines stable.

**Frontend:** a Floor page (occupancy dashboard, live bills), a dual-channel Point of Sale (walk-in checkout and table service), Settings tabs for floor & seating and product-unit conversions, table context on receipts and the sales list, and a table-service section in Reports (open tabs, sales by table/area, waiter performance, turnover) for owners/managers/accountants.

**Verification:** an isolated-database integration suite (`npm run test:tables`) creates a throwaway MySQL database, boots a dedicated server, runs the full spec §7A.6 and §16 checks, and drops the database afterwards. It covers anonymous open, drafts leaving stock untouched, stock deducted exactly once at serving, serve/order/payment/close idempotency, one open session per table under concurrent opens, split payments with an overpay guard, close freeing the table without re-deducting stock, insufficient-stock rejection, draft and served voids, merge/transfer with preserved history and renumbered rounds, walk-in sales unaffected, credit close flowing into the customer account and staying separate from tabs, held carts with no movement, and table reports. An additional 79-check end-to-end run passed against the local development database. Vite production build succeeds.

**POS acceptance:** a second isolated suite (`npm run test:pos`, throwaway database on port 5198) asserts the ten point-of-sale requirements end to end: search by product name and barcode/sku, the catalog contract behind the beverage picker (categories, live stock, selling units with conversion factors), quantity validation and the insufficient-stock guard, per-line subtotals priced by the selected selling unit, the total bill with and without discounts, the cashier discount refusal (403 — only owner/manager may authorize, so cashiers cannot bypass the UI), discount-above-subtotal rejection, split payments with unsupported-method and overpay guards, idempotent sale retries that never double-deduct stock, automatic stock reduction in base units on completion, and the sale-detail payload that receipts print and download from.

## Outstanding before commercial use

- Customer/supplier statements and transaction history screens.
- Granular permission configuration, password change/reset, and hardened login-attempt protection.
- Notifications and business settings, including localization and reviewed Rwanda tax configuration.
- Report filters beyond date range and PDF/XLSX export.
- Scheduled backups, retention, and tested restore procedures.
- Production configuration, security review, monitoring, and verified deployment.
- Concurrency, database failure/recovery, cross-tenant isolation, and backup restore testing.
- Cash tender/change and tax calculations. Authorized discount capture is available at the point of sale (owner/manager only).
- Return UI currently supports one settlement method per return; supplier overpayments require an immediate refund instead of a carry-forward credit.
- Table-service scope not yet built: batch/expiry tracking, stock counts, price history, reservations, offline sync, multi-branch floors, and kitchen-display integrations. Deactivated QA tables/areas from verification runs remain in the local development database as inactive rows.

Do not treat this build as a complete commercial release or as the only ledger for a live business.

## Local database and repository state

The ignored local `backend/.env` points to the fresh `bssbms_app_20261105_484744` database with all five migrations applied. The pre-existing populated `bssbms` database has a different legacy schema; it was left untouched, and the migration runner refuses to apply this app's migrations to an unmarked existing database.

The workspace has a local `main` branch and no configured Git remote, GitHub branches, pull request, or production deployment.

## Next phase

Implement granular role permissions, then customer/supplier statements and business settings. Continue with the backup and recovery workflow, expanded isolation/failure/concurrency tests, and production preparation. Do not claim production readiness before the remaining requirements and deployment criteria pass.
