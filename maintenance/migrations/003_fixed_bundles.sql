CREATE TABLE IF NOT EXISTS bundles (
  id BIGSERIAL PRIMARY KEY,
  bundle_type VARCHAR(30) NOT NULL DEFAULT 'fixed'
    CHECK (bundle_type IN ('fixed')),
  source_key VARCHAR(100) NOT NULL,
  source_bundle_number INTEGER NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  price_ex_vat NUMERIC(12,2) NOT NULL CHECK (price_ex_vat >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  catalogue_status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (catalogue_status IN ('pending', 'complete', 'missing_products')),
  pricing_status VARCHAR(40) NOT NULL DEFAULT 'pending_customization_review'
    CHECK (pricing_status IN ('pending_customization_review', 'margin_review', 'cost_review', 'unpriced', 'approved')),
  source_document_status VARCHAR(30),
  total_item_quantity INTEGER NOT NULL CHECK (total_item_quantity > 0),
  competitor_price_ex_vat NUMERIC(12,2),
  publish_block_reason TEXT,
  source_product_text TEXT,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_key, source_bundle_number)
);

CREATE TABLE IF NOT EXISTS bundle_components (
  id BIGSERIAL PRIMARY KEY,
  bundle_id BIGINT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  line_order INTEGER NOT NULL CHECK (line_order > 0),
  requested_style_code VARCHAR(100) NOT NULL,
  catalogue_style_code VARCHAR(100),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source_unit_cost NUMERIC(12,4),
  observed_min_carton_price NUMERIC(12,4),
  observed_max_carton_price NUMERIC(12,4),
  component_status VARCHAR(30) NOT NULL
    CHECK (component_status IN ('linked', 'missing_product')),
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bundle_id, line_order)
);

CREATE INDEX IF NOT EXISTS idx_bundles_status
  ON bundles (status, catalogue_status, pricing_status);
CREATE INDEX IF NOT EXISTS idx_bundles_source
  ON bundles (source_key, source_bundle_number);
CREATE INDEX IF NOT EXISTS idx_bundle_components_bundle
  ON bundle_components (bundle_id, line_order);
CREATE INDEX IF NOT EXISTS idx_bundle_components_style
  ON bundle_components (catalogue_style_code)
  WHERE catalogue_style_code IS NOT NULL;

COMMENT ON TABLE bundles IS
  'Fixed bundle definitions. Draft bundles remain unpublished until catalogue, pricing and customization reviews are complete.';
COMMENT ON COLUMN bundles.price_ex_vat IS
  'Fixed bundle selling price excluding VAT.';
COMMENT ON COLUMN bundle_components.source_unit_cost IS
  'Cost stated by the source document; not a live SKU price or permanent override.';
COMMENT ON COLUMN bundle_components.catalogue_style_code IS
  'Canonical live BrandedUK style code resolved during import; null when the exact product is missing.';
