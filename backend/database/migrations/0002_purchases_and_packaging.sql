CREATE TABLE IF NOT EXISTS product_units (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, product_id CHAR(36) NOT NULL, unit_name VARCHAR(40) NOT NULL,
  factor_to_base DECIMAL(14,3) NOT NULL, selling_price DECIMAL(12,2) NOT NULL, purchase_price DECIMAL(12,2) NOT NULL,
  is_base TINYINT(1) NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_unit_name (product_id,unit_name), KEY ix_product_units_business (business_id,product_id),
  CONSTRAINT fk_product_units_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_product_units_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT chk_product_unit_conversion CHECK (factor_to_base > 0 AND selling_price >= 0 AND purchase_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO product_units (id, business_id, product_id, unit_name, factor_to_base, selling_price, purchase_price, is_base)
SELECT UUID(), p.business_id, p.id, p.base_unit, 1, p.selling_price, p.cost_price, 1
FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id AND pu.is_base = 1);

CREATE TABLE IF NOT EXISTS suppliers (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, name VARCHAR(160) NOT NULL, phone VARCHAR(40) NULL, email VARCHAR(190) NULL,
  address VARCHAR(255) NULL, notes VARCHAR(500) NULL, active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_suppliers_business_name (business_id,name), KEY ix_suppliers_phone (business_id,phone),
  CONSTRAINT fk_suppliers_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchases (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, supplier_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  reference VARCHAR(24) NOT NULL, status ENUM('received','voided') NOT NULL DEFAULT 'received', subtotal DECIMAL(12,2) NOT NULL,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0, tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0, total DECIMAL(12,2) NOT NULL,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0, balance_due DECIMAL(12,2) NOT NULL DEFAULT 0, received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_purchase_reference (business_id,reference),
  KEY ix_purchases_business_date (business_id,created_at), KEY ix_purchases_supplier (business_id,supplier_id,created_at),
  CONSTRAINT fk_purchases_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_purchases_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id), CONSTRAINT fk_purchases_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_purchase_amounts CHECK (subtotal >= 0 AND total >= 0 AND amount_paid >= 0 AND balance_due >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_items (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, purchase_id CHAR(36) NOT NULL, product_id CHAR(36) NOT NULL,
  product_name VARCHAR(160) NOT NULL, quantity DECIMAL(14,3) NOT NULL, unit VARCHAR(40) NOT NULL, factor_to_base DECIMAL(14,3) NOT NULL,
  base_quantity DECIMAL(14,3) NOT NULL, unit_cost DECIMAL(12,2) NOT NULL, line_total DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_purchase_items_purchase (business_id,purchase_id), KEY ix_purchase_items_product (business_id,product_id),
  CONSTRAINT fk_purchase_items_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_purchase_items_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_purchase_items_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id), CONSTRAINT fk_purchase_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT chk_purchase_item_quantities CHECK (quantity > 0 AND factor_to_base > 0 AND base_quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_payments (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, purchase_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  method ENUM('cash','mobile_money','bank_transfer','card') NOT NULL, amount DECIMAL(12,2) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_purchase_payments_purchase (business_id,purchase_id), CONSTRAINT fk_purchase_payments_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_purchase_payments_branch FOREIGN KEY (branch_id) REFERENCES branches(id), CONSTRAINT fk_purchase_payments_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_purchase_payments_user FOREIGN KEY (user_id) REFERENCES users(id), CONSTRAINT chk_purchase_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_payments (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, supplier_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  method ENUM('cash','mobile_money','bank_transfer','card') NOT NULL, amount DECIMAL(12,2) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_supplier_payments (business_id,supplier_id,created_at), CONSTRAINT fk_supplier_pay_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_supplier_pay_branch FOREIGN KEY (branch_id) REFERENCES branches(id), CONSTRAINT fk_supplier_pay_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_supplier_pay_user FOREIGN KEY (user_id) REFERENCES users(id), CONSTRAINT chk_supplier_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, payment_id CHAR(36) NOT NULL, purchase_id CHAR(36) NOT NULL, amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_supplier_allocation_purchase (business_id,purchase_id),
  CONSTRAINT fk_supplier_alloc_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_supplier_alloc_payment FOREIGN KEY (payment_id) REFERENCES supplier_payments(id),
  CONSTRAINT fk_supplier_alloc_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id), CONSTRAINT chk_supplier_allocation_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
