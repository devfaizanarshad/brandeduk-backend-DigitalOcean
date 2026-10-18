CREATE TABLE IF NOT EXISTS commerce_journeys (
  session_id VARCHAR(80) PRIMARY KEY,
  visitor_id VARCHAR(80) NOT NULL,
  user_id INTEGER,
  status VARCHAR(30) NOT NULL DEFAULT 'browsing',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  basket_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
  entry_path TEXT,
  last_path TEXT,
  last_event_type VARCHAR(40),
  device_type VARCHAR(20),
  checkout_started_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  order_number VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commerce_journey_events (
  id BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(80) NOT NULL REFERENCES commerce_journeys(session_id) ON DELETE CASCADE,
  visitor_id VARCHAR(80) NOT NULL,
  user_id INTEGER,
  event_type VARCHAR(40) NOT NULL,
  path TEXT,
  product_code VARCHAR(80),
  product_name TEXT,
  search_query TEXT,
  basket_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commerce_journeys_abandoned
  ON commerce_journeys(status, last_activity_at)
  WHERE item_count > 0;
CREATE INDEX IF NOT EXISTS idx_commerce_journeys_visitor ON commerce_journeys(visitor_id);
CREATE INDEX IF NOT EXISTS idx_commerce_events_type_created ON commerce_journey_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_events_product
  ON commerce_journey_events(product_code)
  WHERE product_code IS NOT NULL;
