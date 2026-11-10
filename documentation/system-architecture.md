# System architecture

## Runtime

The React/Vite client in `frontend/` communicates with the Node.js/Express API in `backend/` over JSON HTTP. The API accesses MySQL through Prisma (`$queryRawUnsafe`/`$executeRawUnsafe` behind a thin `pool.execute` shim) and a transaction helper that wraps `prisma.$transaction`. The browser never connects to MySQL.

## Current transaction boundaries

- A completed sale and all its lines, payments, stock decrements, stock movements, optional cash movements, and audit record commit in a single MySQL transaction.
- A received purchase, its item snapshots, stock receipts, weighted-average cost updates, payment records, supplier debt, optional cash outflow, and audit record commit in one MySQL transaction.
- A sales return and its item quantities, customer debt credit, refund payments, accepted stock, weighted-average cost updates, cash outflows, and audit record commit in one MySQL transaction. Only accepted items return to saleable stock; damaged items remain in cost of goods sold.
- A purchase return and its item quantities, supplier payable credit, immediate supplier refund receipts, stock removals, cash inflows, and audit record commit in one MySQL transaction. Returned quantities cannot exceed current stock.
- A table-service round commit: order, item snapshots, and — when `serveNow` is set — the stock decrements, movements, and audit entry commit together. Confirming a draft (`serve`) applies the same deduction inside one transaction; a failure rolls the whole round back.
- A table payment, its optional cash movement, and audit entry commit in one transaction. Closing a table session copies served items and payments into one sale plus its sale-items, sale-payments, stock-linked cost fields, and audit entry in a single transaction.
- An `Idempotency-Key` is required on sale, sales return, purchase return, table round, table payment, and table-close creation and is unique per business, so retries return the original transaction.
- Cash expenses, debt receipts, session open/close, stock adjustments, held carts, floor configuration, transfers, and merges are transactional.
- Product quantities use a product's configured smallest stock unit. Per-product package factors are configured in `product_units` and applied to purchase receipts, sales, and table orders.
- Sale and table-order lines retain unit-conversion and category snapshots; later category or conversion changes do not reclassify historical lines.

## Table service model (spec v2.1 §7A)

- `bar_areas` and `bar_tables` hold the floor plan. A generated column plus a unique key on `table_sessions` enforce at most one open session per table at the database level, mirroring the single-open-cash-session rule.
- A session's bill is the sum of its served rounds; drafts and voided rounds are excluded. Stock is deducted exactly once, at the moment a round is served — drafts and held carts never move stock.
- Voiding a served round restores stock through a `serving_void` movement and is owner/manager-only; a session whose bill is overpaid cannot void.
- Splitting a bill across payment methods is supported; payments above the outstanding balance are rejected. Cash payments require an open cash session and post cash movements.
- Closing a tab creates the sale (`sales_channel='TABLE'`, `table_session_id`) only after settlement, or — with owner/manager authority and a registered customer — books the unpaid balance onto the customer's existing credit account. Open tabs and customer credit stay separate accounts.
- Transfers move a session between tables; merges move all rounds (renumbered) and payments into another open session and free the source table. Both keep full history.
- Raw MySQL aggregate results (`COUNT`, `MAX`, `SUM`) arrive as BigInt/Decimal values; route responses pass through a `jsonSafe` serializer so JSON output stays web-safe.

## Tenant boundary

Every business record is keyed by `business_id`. Authenticated claims identify a user and business, and API queries scope reads and writes to that business. The main branch is created during one-time owner bootstrap.

## Authentication and authorization

Passwords are hashed with bcrypt. JWTs carry the user and business IDs; middleware reloads the active account on each request. APIs enforce role checks, owners can create and deactivate staff accounts, and the final active owner cannot be disabled. This is a coarse role gate, not the complete granular permissions editor specified by the product brief.

## Decisions that need business review

- Authorized discounts are applied at the point of sale and stored on the sale (subtotal, discount amount, discounted total). Only owners and managers may apply a discount; cashiers cannot. Tax is still not applied and must be reviewed against current Rwanda Revenue Authority requirements before production configuration.
- Sale payment lines represent amounts applied to the invoice and can be split across methods. Cash tender received and change due are not modeled yet.
- Credit requires an identified customer; walk-in sales must be fully paid.
- Inventory cost of goods sold uses the weighted-average base-unit cost captured at sale time.
- Quantities allow up to three decimal places internally; each product's package factors convert into its base unit.
- Sales returns first reduce the sale's outstanding customer balance; any excess must be refunded and cannot exceed net payments collected. Cash refunds require an open cash session.
- Purchase returns first reduce that purchase's outstanding supplier balance; any excess must be received as a supplier refund at the time of the return. Carry-forward supplier credit is not implemented.
- Reports subtract returns in the period they are recorded. Returned sale cost is removed from cost of goods sold only when the item is accepted back into saleable stock.
- Table customers are anonymous by design: a numbered table identifies the tab, and a customer identity is required only when an unpaid balance is authorized onto a credit account at close. Waiter assignment, transfer, and merge keep the original audit trail.
- Point of sale supports two channels: instant walk-in checkout (anonymous or credit customer) and table service. Both deduct stock at the moment of sale/service and produce standard receipts; table receipts additionally show the table code and area.
