-- 0007_product_images.sql
-- Product imagery: every catalogue item can carry its own photo (a Fanta
-- shows Fanta, water shows water) so the POS picker, cart, and product
-- table present products visually. The frontend ships a curated set of
-- beverage photographs under frontend/public/images/products and this
-- column stores the chosen filename, for example beer.jpg. A NULL value
-- falls back to a category default on the client, then to the bottle glyph.

ALTER TABLE products
  ADD COLUMN image_path VARCHAR(120) NULL AFTER sku;
