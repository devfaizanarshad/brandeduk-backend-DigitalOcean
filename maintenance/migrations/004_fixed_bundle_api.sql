ALTER TABLE bundles
  ADD COLUMN IF NOT EXISTS featured_image_url TEXT,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS bundle_admin_audit (
  id BIGSERIAL PRIMARY KEY,
  bundle_id BIGINT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  admin_user_id INTEGER,
  action VARCHAR(50) NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bundles_public_order
  ON bundles (status, is_featured DESC, display_order, id);
CREATE INDEX IF NOT EXISTS idx_bundle_admin_audit_bundle
  ON bundle_admin_audit (bundle_id, created_at DESC);
