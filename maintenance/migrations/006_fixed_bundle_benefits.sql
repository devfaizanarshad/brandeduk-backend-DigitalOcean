ALTER TABLE bundles
  ADD COLUMN IF NOT EXISTS included_decoration_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS included_logo_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logo_position VARCHAR(160),
  ADD COLUMN IF NOT EXISTS free_delivery BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_gift JSONB,
  ADD COLUMN IF NOT EXISTS source_include_text TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bundles_included_decoration_methods_array') THEN
    ALTER TABLE bundles ADD CONSTRAINT bundles_included_decoration_methods_array
      CHECK (jsonb_typeof(included_decoration_methods) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bundles_included_logo_count_nonnegative') THEN
    ALTER TABLE bundles ADD CONSTRAINT bundles_included_logo_count_nonnegative
      CHECK (included_logo_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bundles_free_gift_object') THEN
    ALTER TABLE bundles ADD CONSTRAINT bundles_free_gift_object
      CHECK (free_gift IS NULL OR jsonb_typeof(free_gift) = 'object');
  END IF;
END $$;
