-- =============================================================================
-- 001_add_suppliers.sql
-- Run ONLY on brandeduk_ralawise_backup (local backup). NEVER on production.
-- =============================================================================

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO suppliers (name, slug) VALUES 
  ('Ralawise', 'ralawise'),
  ('Uneek', 'uneek')
ON CONFLICT (slug) DO NOTHING;

-- Link styles to supplier
ALTER TABLE styles ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);

-- Backfill existing Ralawise styles
UPDATE styles SET supplier_id = (SELECT id FROM suppliers WHERE slug = 'ralawise') WHERE supplier_id IS NULL;

-- Traceability (optional)
ALTER TABLE styles ADD COLUMN IF NOT EXISTS external_style_code VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS external_sku VARCHAR(100);
