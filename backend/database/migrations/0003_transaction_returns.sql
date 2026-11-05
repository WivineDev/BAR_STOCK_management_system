ALTER TABLE sale_items
  ADD COLUMN factor_to_base DECIMAL(14,3) NOT NULL DEFAULT 1 AFTER unit;

UPDATE sale_items si
JOIN product_units pu ON pu.product_id=si.product_id AND pu.unit_name=si.unit
SET si.factor_to_base=pu.factor_to_base;

CREATE TABLE sales_returns (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, sale_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL, reference VARCHAR(24) NOT NULL, idempotency_key VARCHAR(120) NOT NULL,
  total DECIMAL(12,2) NOT NULL, credit_applied DECIMAL(12,2) NOT NULL DEFAULT 0, refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sales_return_reference (business_id,reference), UNIQUE KEY uq_sales_return_idempotency (business_id,idempotency_key),
  KEY ix_sales_returns_sale_time (business_id,sale_id,created_at),
  CONSTRAINT fk_sales_returns_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_sales_returns_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_sales_returns_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_sales_returns_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_sales_return_amounts CHECK (total > 0 AND credit_applied >= 0 AND refund_amount >= 0 AND credit_applied + refund_amount = total)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_return_items (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, return_id CHAR(36) NOT NULL,
  sale_item_id CHAR(36) NOT NULL, product_id CHAR(36) NOT NULL, product_name VARCHAR(160) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL, unit VARCHAR(40) NOT NULL, factor_to_base DECIMAL(14,3) NOT NULL,
  base_quantity DECIMAL(14,3) NOT NULL, unit_price DECIMAL(12,2) NOT NULL, unit_cost DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL, line_cost DECIMAL(12,2) NOT NULL, restock TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_sales_return_items_return (business_id,return_id), KEY ix_sales_return_items_sale_item (business_id,sale_item_id),
  CONSTRAINT fk_sales_return_items_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_sales_return_items_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_sales_return_items_return FOREIGN KEY (return_id) REFERENCES sales_returns(id),
  CONSTRAINT fk_sales_return_items_sale_item FOREIGN KEY (sale_item_id) REFERENCES sale_items(id),
  CONSTRAINT fk_sales_return_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT chk_sales_return_item_quantities CHECK (quantity > 0 AND factor_to_base > 0 AND base_quantity > 0 AND line_total >= 0 AND line_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_return_payments (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, return_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL, method ENUM('cash','mobile_money','bank_transfer','card') NOT NULL, amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_sales_return_payments_return (business_id,return_id),
  CONSTRAINT fk_sales_return_payments_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_sales_return_payments_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_sales_return_payments_return FOREIGN KEY (return_id) REFERENCES sales_returns(id),
  CONSTRAINT fk_sales_return_payments_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_sales_return_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_returns (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, purchase_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL, reference VARCHAR(24) NOT NULL, idempotency_key VARCHAR(120) NOT NULL,
  total DECIMAL(12,2) NOT NULL, payable_credit DECIMAL(12,2) NOT NULL DEFAULT 0, refund_received DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_purchase_return_reference (business_id,reference), UNIQUE KEY uq_purchase_return_idempotency (business_id,idempotency_key),
  KEY ix_purchase_returns_purchase_time (business_id,purchase_id,created_at),
  CONSTRAINT fk_purchase_returns_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_purchase_returns_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_purchase_returns_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_purchase_returns_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_purchase_return_amounts CHECK (total > 0 AND payable_credit >= 0 AND refund_received >= 0 AND payable_credit + refund_received = total)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_return_items (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, return_id CHAR(36) NOT NULL,
  purchase_item_id CHAR(36) NOT NULL, product_id CHAR(36) NOT NULL, product_name VARCHAR(160) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL, unit VARCHAR(40) NOT NULL, factor_to_base DECIMAL(14,3) NOT NULL,
  base_quantity DECIMAL(14,3) NOT NULL, unit_cost DECIMAL(12,2) NOT NULL, line_total DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_purchase_return_items_return (business_id,return_id), KEY ix_purchase_return_items_purchase_item (business_id,purchase_item_id),
  CONSTRAINT fk_purchase_return_items_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_purchase_return_items_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_purchase_return_items_return FOREIGN KEY (return_id) REFERENCES purchase_returns(id),
  CONSTRAINT fk_purchase_return_items_purchase_item FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id),
  CONSTRAINT fk_purchase_return_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT chk_purchase_return_item_quantities CHECK (quantity > 0 AND factor_to_base > 0 AND base_quantity > 0 AND line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_return_payments (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, return_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL, method ENUM('cash','mobile_money','bank_transfer','card') NOT NULL, amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_purchase_return_payments_return (business_id,return_id),
  CONSTRAINT fk_purchase_return_payments_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_purchase_return_payments_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_purchase_return_payments_return FOREIGN KEY (return_id) REFERENCES purchase_returns(id),
  CONSTRAINT fk_purchase_return_payments_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_purchase_return_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
