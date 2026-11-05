-- BSSBMS v0.1 core schema (MySQL 8 / MariaDB 10.6+)
-- Import the database bssbms in phpMyAdmin, then import this file.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS businesses (
  id CHAR(36) PRIMARY KEY, name VARCHAR(160) NOT NULL, currency CHAR(3) NOT NULL DEFAULT 'RWF', address VARCHAR(255) NULL,
  phone VARCHAR(40) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS branches (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, address VARCHAR(255) NULL, active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_branch_name (business_id, name), KEY ix_branches_business (business_id),
  CONSTRAINT fk_branches_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NULL, name VARCHAR(120) NOT NULL, email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(100) NOT NULL, role ENUM('owner','manager','cashier','storekeeper','accountant') NOT NULL DEFAULT 'cashier', active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email), KEY ix_users_business_email (business_id, email), KEY ix_users_branch (branch_id),
  CONSTRAINT fk_users_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_activity (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, user_id CHAR(36) NULL, successful TINYINT(1) NOT NULL, ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_login_user_time (business_id,user_id,created_at),
  CONSTRAINT fk_login_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_login_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, full_name VARCHAR(160) NOT NULL, phone VARCHAR(40) NULL, email VARCHAR(190) NULL,
  address VARCHAR(255) NULL, notes VARCHAR(500) NULL, active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_customers_business_name (business_id,full_name), KEY ix_customers_phone (business_id,phone),
  CONSTRAINT fk_customers_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_categories (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, name VARCHAR(100) NOT NULL, archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_categories_business_name (business_id,name),
  CONSTRAINT fk_categories_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, category_id CHAR(36) NULL, name VARCHAR(160) NOT NULL, sku VARCHAR(60) NULL,
  base_unit VARCHAR(40) NOT NULL DEFAULT 'bottle', selling_price DECIMAL(12,2) NOT NULL, cost_price DECIMAL(12,2) NOT NULL,
  low_stock_threshold DECIMAL(14,3) NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_products_business_sku (business_id,sku),
  KEY ix_products_business_name (business_id,name), KEY ix_products_branch_active (branch_id,active),
  CONSTRAINT fk_products_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_products_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES product_categories(id), CONSTRAINT chk_products_prices CHECK (selling_price >= 0 AND cost_price >= 0 AND low_stock_threshold >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, product_id CHAR(36) NOT NULL, quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_inventory_product_branch (product_id,branch_id),
  KEY ix_inventory_business (business_id,branch_id), CONSTRAINT fk_inventory_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_inventory_branch FOREIGN KEY (branch_id) REFERENCES branches(id), CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT chk_inventory_nonnegative CHECK (quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, product_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  movement_type ENUM('opening','purchase','sale','sale_return','purchase_return','adjustment','damage','expiry','transfer_in','transfer_out') NOT NULL,
  quantity_delta DECIMAL(14,3) NOT NULL, unit VARCHAR(40) NOT NULL, reference_type VARCHAR(40) NULL, reference_id CHAR(36) NULL,
  notes VARCHAR(500) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_movements_product_time (business_id,product_id,created_at),
  KEY ix_movements_reference (business_id,reference_type,reference_id), CONSTRAINT fk_movements_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_movements_branch FOREIGN KEY (branch_id) REFERENCES branches(id), CONSTRAINT fk_movements_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_movements_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, cashier_id CHAR(36) NOT NULL, customer_id CHAR(36) NULL,
  reference VARCHAR(24) NOT NULL, idempotency_key VARCHAR(120) NOT NULL, status ENUM('completed','partially_returned','returned','voided') NOT NULL DEFAULT 'completed',
  subtotal DECIMAL(12,2) NOT NULL, discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0, tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0, total DECIMAL(12,2) NOT NULL,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0, balance_due DECIMAL(12,2) NOT NULL DEFAULT 0, cost_of_goods_sold DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_sales_reference (business_id,reference), UNIQUE KEY uq_sales_idempotency (business_id,idempotency_key),
  KEY ix_sales_business_date (business_id,created_at), KEY ix_sales_customer_date (business_id,customer_id,created_at),
  CONSTRAINT fk_sales_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_sales_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_sales_cashier FOREIGN KEY (cashier_id) REFERENCES users(id), CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT chk_sales_amounts CHECK (subtotal >= 0 AND total >= 0 AND amount_paid >= 0 AND balance_due >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_items (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, sale_id CHAR(36) NOT NULL, product_id CHAR(36) NOT NULL,
  product_name VARCHAR(160) NOT NULL, quantity DECIMAL(14,3) NOT NULL, unit VARCHAR(40) NOT NULL, unit_price DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL, line_total DECIMAL(12,2) NOT NULL, line_cost DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_sale_items_sale (business_id,sale_id), KEY ix_sale_items_product (business_id,product_id),
  CONSTRAINT fk_sale_items_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_sale_items_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id) REFERENCES sales(id), CONSTRAINT fk_sale_items_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_payments (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, sale_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  method ENUM('cash','mobile_money','bank_transfer','card') NOT NULL, amount DECIMAL(12,2) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_sale_payments_sale (business_id,sale_id), CONSTRAINT fk_sale_payments_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_sale_payments_branch FOREIGN KEY (branch_id) REFERENCES branches(id), CONSTRAINT fk_sale_payments_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_sale_payments_user FOREIGN KEY (user_id) REFERENCES users(id), CONSTRAINT chk_sale_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_payments (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, customer_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  method ENUM('cash','mobile_money','bank_transfer','card') NOT NULL, amount DECIMAL(12,2) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_customer_payments (business_id,customer_id,created_at), CONSTRAINT fk_customer_pay_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_customer_pay_branch FOREIGN KEY (branch_id) REFERENCES branches(id), CONSTRAINT fk_customer_pay_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_customer_pay_user FOREIGN KEY (user_id) REFERENCES users(id), CONSTRAINT chk_customer_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_payment_allocations (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, payment_id CHAR(36) NOT NULL, sale_id CHAR(36) NOT NULL, amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_payment_allocation_sale (business_id,sale_id),
  CONSTRAINT fk_allocation_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_allocation_payment FOREIGN KEY (payment_id) REFERENCES customer_payments(id),
  CONSTRAINT fk_allocation_sale FOREIGN KEY (sale_id) REFERENCES sales(id), CONSTRAINT chk_allocation_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, category VARCHAR(80) NOT NULL,
  description VARCHAR(250) NOT NULL, amount DECIMAL(12,2) NOT NULL, payment_method ENUM('cash','mobile_money','bank_transfer','card') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_expenses_business_date (business_id,created_at),
  CONSTRAINT fk_expenses_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_expenses_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_expenses_user FOREIGN KEY (user_id) REFERENCES users(id), CONSTRAINT chk_expense_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_sessions (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  opening_balance DECIMAL(12,2) NOT NULL, expected_cash DECIMAL(12,2) NULL, actual_cash DECIMAL(12,2) NULL, discrepancy_note VARCHAR(500) NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open', opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, closed_at TIMESTAMP NULL,
  active_user_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN status='open' THEN user_id ELSE NULL END) STORED,
  UNIQUE KEY uq_open_cash_per_user (business_id,active_user_id), KEY ix_cash_business_time (business_id,opened_at),
  CONSTRAINT fk_cash_sessions_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_cash_sessions_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_cash_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_movements (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL, session_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  movement_type ENUM('opening_float','sale_payment','debt_payment','expense','refund','withdrawal','deposit','adjustment') NOT NULL,
  direction ENUM('in','out') NOT NULL, amount DECIMAL(12,2) NOT NULL, reference_type VARCHAR(40) NULL, reference_id CHAR(36) NULL, notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_cash_movements_session (business_id,session_id,created_at), KEY ix_cash_movements_reference (business_id,reference_type,reference_id),
  CONSTRAINT fk_cash_movements_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_cash_movements_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_cash_movements_session FOREIGN KEY (session_id) REFERENCES cash_sessions(id), CONSTRAINT fk_cash_movements_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_cash_movement_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NULL, user_id CHAR(36) NOT NULL, action VARCHAR(60) NOT NULL,
  module VARCHAR(60) NOT NULL, record_id CHAR(36) NULL, transaction_reference VARCHAR(40) NULL, details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY ix_audit_business_time (business_id,created_at), KEY ix_audit_record (business_id,module,record_id),
  CONSTRAINT fk_audit_business FOREIGN KEY (business_id) REFERENCES businesses(id), CONSTRAINT fk_audit_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, branch_id CHAR(36) NULL, user_id CHAR(36) NULL, type VARCHAR(60) NOT NULL,
  title VARCHAR(160) NOT NULL, message VARCHAR(500) NOT NULL, read_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_notifications_user (business_id,user_id,read_at,created_at), CONSTRAINT fk_notifications_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_notifications_branch FOREIGN KEY (branch_id) REFERENCES branches(id), CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bssbms_migration_history (
  version VARCHAR(32) PRIMARY KEY,
  status ENUM('running','complete') NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO bssbms_migration_history (version, status, completed_at)
VALUES ('0001_core', 'complete', CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE status = 'complete', completed_at = CURRENT_TIMESTAMP;

SET FOREIGN_KEY_CHECKS = 1;
