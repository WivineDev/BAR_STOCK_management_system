# Testing

Automated tests verify exact money parsing, rejected precision, line totals, base-stock arithmetic, and fractional stock arithmetic. Run them with `npm test` from the project root.

The optional API integration smoke test exercises a full workflow against the API and a fresh isolated database. Start the API and run `npm run test:integration -w backend`; it bootstraps an owner, so run it only against an empty development database. It creates test business records and must not target a live or shared database.

The table-service integration suite runs fully isolated: `npm run test:tables -w backend` creates a throwaway MySQL database (`bssbms_tables_<random>`), applies all migrations, boots a dedicated server on port 5199, runs the spec v2.1 §7A.6/§16 table-service assertions, then drops the database. It bootstraps its own owner, so it is safe to run at any time and never touches the development database. It covers anonymous table open, drafts not touching stock, stock deducted exactly once on serve, idempotent serve/order/payment/close, concurrent open attempts yielding exactly one winner, split payments with an overpay guard, close freeing the table without re-deducting stock, insufficient-stock rejection, draft and served voids with stock restoration, transfer and merge with preserved history, walk-in sales unaffected, credit close flowing into customer debt separately from tabs, held carts with no movement, and table reports.

Once XAMPP MySQL is running and migrations have been applied, manually exercise:

- Create the owner, add a product, record opening stock, then complete a sale and confirm stock, payment, debt, and audit rows commit together.
- Retry a sale with the same `Idempotency-Key` and confirm only one sale and one stock decrement exist.
- Attempt a sale above stock and confirm no sale or payment records remain.
- Open cash at 50,000 RWF, record 100,000 RWF cash sales and a 20,000 RWF cash expense, then confirm expected close is 130,000 RWF.
- Try to close with a cash variance without a note and confirm the request is rejected; record a note and confirm reconciliation.
- Create a 10,000 RWF sale with 8,000 RWF applied, then pay 2,000 RWF on the debt and confirm the remaining balance is zero.
- Verify users cannot read or mutate another business's rows and unauthorized roles receive 403 responses.

The integration smoke test has been run successfully against a fresh isolated XAMPP database. It covers owner/staff authentication, role checks and deactivation, category creation/archive and product assignment/editing, zero low-stock threshold, packaging conversion, weighted-average purchase receiving, supplier payment, split sale payments and retries, customer debt, sales and purchase returns, return quantity limits and idempotency, accepted stock restoration, supplier payable credit, cash refund close, insufficient inventory, receipt data, dashboard balances, category summaries, and return-adjusted report totals. Database failure injection, concurrency stress, cross-tenant isolation, and backup recovery still need coverage.
