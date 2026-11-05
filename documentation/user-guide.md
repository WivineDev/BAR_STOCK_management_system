# User guide (implemented workflows)

1. Create the first owner account from the sign-in page.
2. Create product categories from Categories, then add a product with its category, base unit, sale price, cost, and low-stock threshold. The low-stock threshold can be zero.
3. Use the product's Units action to define packages such as `1 crate = 20 bottles`, with separate sale and purchase prices.
4. Add suppliers, then record a received purchase. Choose its package quantity and unit cost; the backend adds converted base stock and recalculates weighted-average cost. Partial supplier payments leave an outstanding balance.
5. Open Inventory and record an opening count with a reason.
6. Open Cash Management and enter the till float before accepting cash.
7. In Point of Sale, add products, enter the amount applied, select a payment method, and complete the sale. A credit remainder requires an identified customer.
8. Record operating expenses. Cash expenses require an open till session.
9. At close, count cash; if counted and expected values differ, enter an explanation.
10. To return a sale, open its Details from Sales and choose Start return. Enter only quantities actually returned and identify whether each item can go back into saleable stock. The system applies the return to customer debt first; when money is due back, select the refund method. A cash refund requires an open cash session.
11. To return stock to a supplier, open the purchase Details and choose Start return. Enter the physical quantity being sent back. The system checks remaining received quantity and stock on hand, reduces the supplier payable first, and requires an immediate supplier refund receipt for any amount above the remaining payable.
12. Owners and managers can archive or restore categories. Editing a product can change its name, SKU, category, selling price, and threshold. The base unit stays fixed and the purchase cost continues to follow weighted-average stock costing.

Implemented workflows cover first-owner setup, owner-managed staff accounts, products, categories, and packaging, suppliers and purchases, purchase and sales returns, inventory adjustments, POS, sales history and printable receipts, customer credit and payments, expenses, cash sessions, dashboard metrics, category and return-adjusted report summary/CSV/print, and audit viewing. Granular permission configuration, full settings, customer and supplier statements, and notification workflows are not available yet.
