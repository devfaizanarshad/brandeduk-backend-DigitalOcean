-- =====================================================
-- Price Breaks Tables Migration
-- =====================================================
-- This script creates tables for database-driven price breaks:
-- 1. price_breaks: Global discount tiers (6 tiers)
-- 2. product_price_overrides: Per-product tier overrides
-- =====================================================

-- Create the global price_breaks table
CREATE TABLE IF NOT EXISTS price_breaks (
  id SERIAL PRIMARY KEY,
  min_qty INTEGER NOT NULL,
  max_qty INTEGER NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  tier_name VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(min_qty, max_qty)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_pb_qty_range ON price_breaks(min_qty, max_qty);

-- Add comments
COMMENT ON TABLE price_breaks IS 'Global discount tiers based on quantity ranges';
COMMENT ON COLUMN price_breaks.min_qty IS 'Minimum quantity for this tier (inclusive)';
COMMENT ON COLUMN price_breaks.max_qty IS 'Maximum quantity for this tier (inclusive)';
COMMENT ON COLUMN price_breaks.discount_percent IS 'Discount percentage (e.g., 8.00 = 8% discount)';
COMMENT ON COLUMN price_breaks.tier_name IS 'Human-readable tier name (e.g., "1-9", "10-24")';

-- Insert default global tiers (matching current hardcoded values)
INSERT INTO price_breaks (min_qty, max_qty, discount_percent, tier_name)
VALUES 
  (1, 9, 0.00, '1-9'),
  (10, 24, 8.00, '10-24'),
  (25, 49, 10.00, '25-49'),
  (50, 99, 15.00, '50-99'),
  (100, 249, 25.00, '100-249'),
  (250, 99999, 30.00, '250+')
ON CONFLICT (min_qty, max_qty) DO NOTHING;

-- =====================================================
-- Product-Specific Price Overrides Table
-- =====================================================

CREATE TABLE IF NOT EXISTS product_price_overrides (
  id SERIAL PRIMARY KEY,
  style_code VARCHAR(50) NOT NULL,
  min_qty INTEGER NOT NULL,
  max_qty INTEGER NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(style_code, min_qty, max_qty)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ppo_style_code ON product_price_overrides(style_code);
CREATE INDEX IF NOT EXISTS idx_ppo_style_qty ON product_price_overrides(style_code, min_qty, max_qty);

-- Add comments
COMMENT ON TABLE product_price_overrides IS 'Per-product discount tier overrides';
COMMENT ON COLUMN product_price_overrides.style_code IS 'Product style code';
COMMENT ON COLUMN product_price_overrides.min_qty IS 'Minimum quantity for this override tier';
COMMENT ON COLUMN product_price_overrides.max_qty IS 'Maximum quantity for this override tier';
COMMENT ON COLUMN product_price_overrides.discount_percent IS 'Custom discount percentage for this product';

-- =====================================================
-- Example Usage:
-- =====================================================
--
-- 1. Get global price breaks:
--    SELECT * FROM price_breaks ORDER BY min_qty;
--
-- 2. Update global tier (e.g., change 50-99 from 15% to 18%):
--    UPDATE price_breaks SET discount_percent = 18.00 WHERE tier_name = '50-99';
--
-- 3. Set product-specific override for GD067:
--    INSERT INTO product_price_overrides (style_code, min_qty, max_qty, discount_percent)
--    VALUES ('GD067', 50, 99, 20.00)
--    ON CONFLICT (style_code, min_qty, max_qty) DO UPDATE 
--    SET discount_percent = EXCLUDED.discount_percent;
--
-- 4. Get effective price breaks for a product:
--    SELECT 
--      pb.min_qty, pb.max_qty, pb.tier_name,
--      COALESCE(ppo.discount_percent, pb.discount_percent) as discount_percent,
--      CASE WHEN ppo.id IS NOT NULL THEN 'override' ELSE 'global' END as source
--    FROM price_breaks pb
--    LEFT JOIN product_price_overrides ppo 
--      ON ppo.style_code = 'GD067' 
--      AND ppo.min_qty = pb.min_qty 
--      AND ppo.max_qty = pb.max_qty
--    ORDER BY pb.min_qty;
--
-- =====================================================
