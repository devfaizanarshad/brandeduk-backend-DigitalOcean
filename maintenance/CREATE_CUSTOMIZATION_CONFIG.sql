CREATE TABLE IF NOT EXISTS customization_configs (
  id SERIAL PRIMARY KEY,
  product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
  scope_type VARCHAR(40) NOT NULL DEFAULT 'product_type',
  subtype_key VARCHAR(120) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_type_id, scope_type, subtype_key)
);

CREATE TABLE IF NOT EXISTS customization_config_positions (
  id SERIAL PRIMARY KEY,
  config_id INTEGER NOT NULL REFERENCES customization_configs(id) ON DELETE CASCADE,
  slug VARCHAR(120) NOT NULL,
  label VARCHAR(120) NOT NULL,
  image_url TEXT,
  product_image_type VARCHAR(80),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (config_id, slug)
);

CREATE TABLE IF NOT EXISTS customization_config_methods (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES customization_config_positions(id) ON DELETE CASCADE,
  method VARCHAR(40) NOT NULL,
  price NUMERIC(10, 2),
  price_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (position_id, method)
);

CREATE INDEX IF NOT EXISTS idx_customization_configs_product_type
  ON customization_configs(product_type_id, scope_type, subtype_key);

CREATE INDEX IF NOT EXISTS idx_customization_positions_config
  ON customization_config_positions(config_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_customization_methods_position
  ON customization_config_methods(position_id);
