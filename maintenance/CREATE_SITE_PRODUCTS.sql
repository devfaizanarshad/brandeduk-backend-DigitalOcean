-- Curated product sets for secondary sites such as Humanitiees.
-- Stores style-level membership and ordering while reusing the main catalog data.

CREATE TABLE IF NOT EXISTS site_products (
  id SERIAL PRIMARY KEY,
  site_slug VARCHAR(100) NOT NULL,
  style_code VARCHAR(50) NOT NULL,
  display_order INTEGER DEFAULT 999999,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(site_slug, style_code)
);

CREATE INDEX IF NOT EXISTS idx_site_products_site_active_order
  ON site_products(site_slug, active, display_order);

CREATE INDEX IF NOT EXISTS idx_site_products_style_code
  ON site_products(style_code);

CREATE INDEX IF NOT EXISTS idx_site_products_site_slug
  ON site_products(site_slug);

COMMENT ON TABLE site_products IS 'Curated style_code memberships for secondary storefronts such as Humanitiees';
COMMENT ON COLUMN site_products.site_slug IS 'Secondary site identifier, for example humanitiees';
COMMENT ON COLUMN site_products.style_code IS 'Style-level product code from styles.style_code';
COMMENT ON COLUMN site_products.display_order IS 'Lower numbers appear first in the secondary site product feed';
COMMENT ON COLUMN site_products.active IS 'Inactive rows remain visible to admin but are hidden from public site feeds';
