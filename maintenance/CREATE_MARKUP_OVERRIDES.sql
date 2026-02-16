-- =====================================================
-- Product-Specific Markup Overrides
-- =====================================================
-- This table stores custom markup percentages per style_code,
-- which will override the global tiered pricing rules.

CREATE TABLE IF NOT EXISTS product_markup_overrides (
    id SERIAL PRIMARY KEY,
    style_code VARCHAR(50) UNIQUE NOT NULL,
    markup_percent NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups during repricing
CREATE INDEX IF NOT EXISTS idx_pmo_style_code ON product_markup_overrides(style_code);

-- Add comments
COMMENT ON TABLE product_markup_overrides IS 'Per-style markup percentage overrides';
COMMENT ON COLUMN product_markup_overrides.style_code IS 'Product style code (unique override per style)';
COMMENT ON COLUMN product_markup_overrides.markup_percent IS 'Custom markup percentage (e.g., 75.00 = 75% markup)';
