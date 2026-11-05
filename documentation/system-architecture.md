# System architecture

## Runtime

The React/Vite client in `frontend/` communicates with the Node.js/Express API in `backend/` over JSON HTTP. The API uses `mysql2` connection pooling and the MySQL database `bssbms`. The browser never connects to MySQL.

## Current transaction boundaries

- A completed sale and all its lines, payments, stock decrements, stock movements, optional cash movements, and audit record commit in a single MySQL transaction.
- A received purchase, its item snapshots, stock receipts, weighted-average cost updates, payment records, supplier debt, optional cash outflow, and audit record commit in one MySQL transaction.
- A sales return and its item quantities, customer debt credit, refund payments, accepted stock, weighted-average cost updates, cash outflows, and audit record commit in one MySQL transaction. Only accepted items return to saleable stock; damaged items remain in cost of goods sold.
- A purchase return and its item quantities, supplier payable credit, immediate supplier refund receipts, stock removals, cash inflows, and audit record commit in one MySQL transaction. Returned quantities cannot exceed current stock.
- An `Idempotency-Key` is required on sale, sales return, and purchase return creation and is unique per business, so retries return the original transaction.
- Cash expenses, debt receipts, session open/close, and stock adjustments are transactional.
- Product quantities use a product's configured smallest stock unit. Per-product package factors are configured in `product_units` and applied to purchase receipts and sales.
- Sale lines retain category and package-conversion snapshots; later category changes do not reclassify historical sales reports.

## Tenant boundary

Every business record is keyed by `business_id`. Authenticated claims identify a user and business, and API queries scope reads and writes to that business. The main branch is created during one-time owner bootstrap.

## Authentication and authorization

Passwords are hashed with bcrypt. JWTs carry the user and business IDs; middleware reloads the active account on each request. APIs enforce role checks, owners can create and deactivate staff accounts, and the final active owner cannot be disabled. This is a coarse role gate, not the complete granular permissions editor specified by the product brief.

## Decisions that need business review

- No tax or discount is applied in the first slice. Tax handling must be reviewed against current Rwanda Revenue Authority requirements before production configuration.
- Sale payment lines represent amounts applied to the invoice and can be split across methods. Cash tender received and change due are not modeled yet.
- Credit requires an identified customer; walk-in sales must be fully paid.
- Inventory cost of goods sold uses the weighted-average base-unit cost captured at sale time.
- Quantities allow up to three decimal places internally; each product's package factors convert into its base unit.
- Sales returns first reduce the sale's outstanding customer balance; any excess must be refunded and cannot exceed net payments collected. Cash refunds require an open cash session.
- Purchase returns first reduce that purchase's outstanding supplier balance; any excess must be received as a supplier refund at the time of the return. Carry-forward supplier credit is not implemented.
- Reports subtract returns in the period they are recorded. Returned sale cost is removed from cost of goods sold only when the item is accepted back into saleable stock.
