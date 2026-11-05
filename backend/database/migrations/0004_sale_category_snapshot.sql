ALTER TABLE sale_items
  ADD COLUMN category_id CHAR(36) NULL AFTER product_id,
  ADD COLUMN category_name VARCHAR(100) NULL AFTER product_name;

UPDATE sale_items si
JOIN products p ON p.id=si.product_id AND p.business_id=si.business_id
LEFT JOIN product_categories pc ON pc.id=p.category_id AND pc.business_id=p.business_id
SET si.category_id=p.category_id,si.category_name=pc.name;

ALTER TABLE sale_items
  ADD CONSTRAINT fk_sale_items_category FOREIGN KEY (category_id) REFERENCES product_categories(id);
