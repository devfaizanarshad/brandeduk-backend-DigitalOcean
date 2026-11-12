ALTER TABLE bundles
  ADD COLUMN IF NOT EXISTS external_reference VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bundles_external_reference
  ON bundles (external_reference)
  WHERE external_reference IS NOT NULL;
