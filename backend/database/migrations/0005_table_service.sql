CREATE TABLE IF NOT EXISTS bar_areas (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bar_area_name (business_id,name), KEY ix_bar_areas_sort (business_id,sort_order),
  CONSTRAINT fk_bar_areas_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bar_tables (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, area_id CHAR(36) NOT NULL,
  code VARCHAR(20) NOT NULL, name VARCHAR(80) NULL, capacity INT NOT NULL DEFAULT 0,
  status ENUM('available','occupied','reserved','out_of_service') NOT NULL DEFAULT 'available',
  active TINYINT(1) NOT NULL DEFAULT 1, floor_position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bar_table_code (business_id,code), KEY ix_bar_tables_area (business_id,area_id,status),
  CONSTRAINT fk_bar_tables_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_bar_tables_area FOREIGN KEY (area_id) REFERENCES bar_areas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS table_sessions (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, table_id CHAR(36) NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  open_table_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN status = 'open' THEN table_id ELSE NULL END) STORED,
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, opened_by CHAR(36) NOT NULL,
  waiter_id CHAR(36) NULL, closed_at TIMESTAMP NULL, closed_by CHAR(36) NULL, sale_id CHAR(36) NULL,
  UNIQUE KEY uq_one_open_session_per_table (business_id,open_table_id),
  KEY ix_table_sessions_status (business_id,status,opened_at), KEY ix_table_sessions_sale (business_id,sale_id),
  CONSTRAINT fk_table_sessions_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_table_sessions_table FOREIGN KEY (table_id) REFERENCES bar_tables(id),
  CONSTRAINT fk_table_sessions_opened_by FOREIGN KEY (opened_by) REFERENCES users(id),
  CONSTRAINT fk_table_sessions_waiter FOREIGN KEY (waiter_id) REFERENCES users(id),
  CONSTRAINT fk_table_sessions_closed_by FOREIGN KEY (closed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, table_session_id CHAR(36) NOT NULL,
  channel ENUM('TABLE','WALK_IN') NOT NULL DEFAULT 'TABLE',
  reference VARCHAR(24) NOT NULL, idempotency_key VARCHAR(120) NOT NULL,
  state ENUM('draft','served','voided') NOT NULL DEFAULT 'draft', round_no INT NOT NULL DEFAULT 1,
  created_by CHAR(36) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  served_at TIMESTAMP NULL, served_by CHAR(36) NULL, voided_at TIMESTAMP NULL, voided_by CHAR(36) NULL, void_reason VARCHAR(500) NULL,
  UNIQUE KEY uq_order_reference (business_id,reference), UNIQUE KEY uq_order_idempotency (business_id,idempotency_key),
  KEY ix_orders_session (business_id,table_session_id,state,created_at),
  CONSTRAINT fk_orders_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_orders_session FOREIGN KEY (table_session_id) REFERENCES table_sessions(id),
  CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_orders_served_by FOREIGN KEY (served_by) REFERENCES users(id),
  CONSTRAINT fk_orders_voided_by FOREIGN KEY (voided_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, order_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL, product_unit_id CHAR(36) NOT NULL,
  product_name VARCHAR(160) NOT NULL, unit_name VARCHAR(40) NOT NULL, factor_to_base DECIMAL(14,3) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL, base_quantity DECIMAL(14,3) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL, unit_cost DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL, line_cost DECIMAL(12,2) NOT NULL,
  state ENUM('draft','served','voided') NOT NULL DEFAULT 'draft', served_at TIMESTAMP NULL, served_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_order_items_order (business_id,order_id,state), KEY ix_order_items_product (business_id,product_id),
  CONSTRAINT fk_order_items_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_order_items_unit FOREIGN KEY (product_unit_id) REFERENCES product_units(id),
  CONSTRAINT fk_order_items_served_by FOREIGN KEY (served_by) REFERENCES users(id),
  CONSTRAINT chk_order_item_quantities CHECK (quantity > 0 AND factor_to_base > 0 AND base_quantity > 0 AND line_total >= 0 AND line_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS table_session_payments (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, table_session_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL, method ENUM('cash','mobile_money','bank_transfer','card') NOT NULL,
  amount DECIMAL(12,2) NOT NULL, idempotency_key VARCHAR(120) NOT NULL, cash_session_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_table_payment_idempotency (business_id,idempotency_key),
  KEY ix_table_payments_session (business_id,table_session_id,created_at),
  CONSTRAINT fk_table_payments_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_table_payments_session FOREIGN KEY (table_session_id) REFERENCES table_sessions(id),
  CONSTRAINT fk_table_payments_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_table_payments_cash_session FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id),
  CONSTRAINT chk_table_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS held_sales (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, held_by CHAR(36) NOT NULL,
  label VARCHAR(120) NOT NULL, channel ENUM('WALK_IN') NOT NULL DEFAULT 'WALK_IN',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_held_sales_business (business_id,created_at),
  CONSTRAINT fk_held_sales_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_held_sales_user FOREIGN KEY (held_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS held_sale_items (
  id CHAR(36) PRIMARY KEY, business_id CHAR(36) NOT NULL, held_sale_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL, product_unit_id CHAR(36) NOT NULL,
  product_name VARCHAR(160) NOT NULL, unit_name VARCHAR(40) NOT NULL, unit_price DECIMAL(12,2) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_held_items_sale (business_id,held_sale_id),
  CONSTRAINT fk_held_items_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_held_items_held_sale FOREIGN KEY (held_sale_id) REFERENCES held_sales(id),
  CONSTRAINT fk_held_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_held_items_unit FOREIGN KEY (product_unit_id) REFERENCES product_units(id),
  CONSTRAINT chk_held_item_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sales
  ADD COLUMN table_session_id CHAR(36) NULL AFTER customer_id,
  ADD COLUMN sales_channel ENUM('WALK_IN','TABLE') NOT NULL DEFAULT 'WALK_IN' AFTER table_session_id;

ALTER TABLE sales
  ADD CONSTRAINT fk_sales_table_session FOREIGN KEY (table_session_id) REFERENCES table_sessions(id);

CREATE INDEX ix_sales_table_session ON sales (business_id,table_session_id);

ALTER TABLE stock_movements
  MODIFY COLUMN movement_type ENUM('opening','purchase','sale','sale_return','purchase_return','adjustment','damage','expiry','transfer_in','transfer_out','serving','serving_void') NOT NULL;

ALTER TABLE cash_movements
  MODIFY COLUMN movement_type ENUM('opening_float','sale_payment','debt_payment','expense','refund','withdrawal','deposit','adjustment','table_payment') NOT NULL;
