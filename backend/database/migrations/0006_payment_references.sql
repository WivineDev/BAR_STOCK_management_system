-- 0006_payment_references.sql
-- Spec v2.1 §3.2.7: electronic payments (Mobile Money, bank transfer, card)
-- capture a transaction reference at confirmation time. Manual-reference mode
-- is the approved initial integration (spec §17), so the reference is stored
-- on each payment line — walk-in sale payments and table-session payments
-- alike. Cash stays reference-free: only the sale cash value is recorded,
-- never the gross tendered amount (spec §3.2.6).

ALTER TABLE sale_payments
  ADD COLUMN reference VARCHAR(120) NULL AFTER method;

ALTER TABLE table_session_payments
  ADD COLUMN reference VARCHAR(120) NULL AFTER method;
