-- =====================================================
-- Product Display Order Table Migration
-- =====================================================
-- This table stores custom display order for products
-- within specific brand and/or product type contexts.
-- 
-- Usage:
-- - Set display_order to control product position in search results
-- - Lower numbers appear first (1 = first, 2 = second, etc.)
-- - Products without entries will fall back to default ordering
-- =====================================================

-- Create the product_display_order table
CREATE TABLE IF NOT EXISTS product_display_order (
  id SERIAL PRIMARY KEY,
  style_code VARCHAR(50) NOT NULL,
  brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
  product_type_id INTEGER REFERENCES product_types(id) ON DELETE CASCADE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Unique constraint: one display order per product per context
  -- Context can be: brand only, product_type only, or both
  UNIQUE(style_code, brand_id, product_type_id)
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_pdo_style_code ON product_display_order(style_code);
CREATE INDEX IF NOT EXISTS idx_pdo_brand_id ON product_display_order(brand_id);
CREATE INDEX IF NOT EXISTS idx_pdo_product_type_id ON product_display_order(product_type_id);
CREATE INDEX IF NOT EXISTS idx_pdo_brand_type ON product_display_order(brand_id, product_type_id);
CREATE INDEX IF NOT EXISTS idx_pdo_display_order ON product_display_order(display_order);

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_pdo_context_order ON product_display_order(brand_id, product_type_id, display_order);

-- Add comment to table
COMMENT ON TABLE product_display_order IS 'Stores custom display order for products within brand/product type contexts';
COMMENT ON COLUMN product_display_order.style_code IS 'The product style code (references styles.style_code)';
COMMENT ON COLUMN product_display_order.brand_id IS 'Optional brand filter context. NULL means applies to all brands';
COMMENT ON COLUMN product_display_order.product_type_id IS 'Optional product type filter context. NULL means applies to all product types';
COMMENT ON COLUMN product_display_order.display_order IS 'Display order position. Lower numbers appear first. Default is 0';

-- =====================================================
-- Example Usage:
-- =====================================================
-- 
-- 1. Set product "ABC123" to appear first when filtering by brand ID 5:
--    INSERT INTO product_display_order (style_code, brand_id, display_order)
--    VALUES ('ABC123', 5, 1);
--
-- 2. Set product "XYZ456" to appear first when filtering by product type ID 3:
--    INSERT INTO product_display_order (style_code, product_type_id, display_order)
--    VALUES ('XYZ456', 3, 1);
--
-- 3. Set product "DEF789" to appear first when filtering by brand ID 5 AND product type ID 3:
--    INSERT INTO product_display_order (style_code, brand_id, product_type_id, display_order)
--    VALUES ('DEF789', 5, 3, 1);
--
-- =====================================================
