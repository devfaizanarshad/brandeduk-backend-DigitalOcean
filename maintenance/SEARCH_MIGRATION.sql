-- ============================================================
-- SEARCH MIGRATION v3: Hybrid FTS + Trigram Search
-- ============================================================
-- Prerequisites: Run ONCE on the production database.
-- This migration adds pg_trgm support and the indexes needed
-- by the new search service. It does NOT drop or recreate
-- the materialized view — it only adds to the existing schema.
-- ============================================================

-- 1. Enable pg_trgm extension (required for similarity() and % operator)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Set a default trigram similarity threshold (for the % operator)
--    0.3 is the Postgres default. Lower = more permissive fuzzy matching.
--    Can be tuned per-session if needed: SET pg_trgm.similarity_threshold = 0.2;
-- ALTER DATABASE brandeduk SET pg_trgm.similarity_threshold = 0.3;

-- 3. Trigram GIN indexes on high-signal text columns
--    These power the `similarity()` and `%` operator used by searchService.js
CREATE INDEX IF NOT EXISTS idx_psm_name_trgm 
  ON product_search_materialized USING gin (style_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_psm_brand_trgm 
  ON product_search_materialized USING gin (brand gin_trgm_ops);

-- 4. Partial FTS GIN index (only Live products — smaller tree, faster IO)
--    The existing idx_psm_search_gin / idx_psm_lightning already cover this,
--    but this one is explicitly partial for the planner to pick the smallest index.
CREATE INDEX IF NOT EXISTS idx_psm_search_vector_partial
  ON product_search_materialized USING gin (search_vector) 
  WHERE sku_status = 'Live';

-- 5. search_synonyms table (for the synonym dictionary)
CREATE TABLE IF NOT EXISTS search_synonyms (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  canonical TEXT NOT NULL,
  synonym_type TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Seed initial synonyms (idempotent — ON CONFLICT DO NOTHING)
INSERT INTO search_synonyms (term, canonical, synonym_type) VALUES
  ('tshirt', 't-shirt', 'product_type'),
  ('tshirts', 't-shirts', 'product_type'),
  ('t shirt', 't-shirt', 'product_type'),
  ('tee', 't-shirt', 'product_type'),
  ('tees', 't-shirts', 'product_type'),
  ('polo', 'polo shirt', 'product_type'),
  ('polos', 'polo shirts', 'product_type'),
  ('hoodie', 'hooded sweatshirt', 'product_type'),
  ('hoodies', 'hooded sweatshirts', 'product_type'),
  ('hoody', 'hooded sweatshirt', 'product_type'),
  ('jumper', 'sweatshirt', 'product_type'),
  ('pullover', 'sweatshirt', 'product_type'),
  ('hat', 'cap', 'product_type'),
  ('coat', 'jacket', 'product_type'),
  ('pants', 'trousers', 'product_type'),
  ('grey', 'gray', 'colour'),
  ('navy', 'navy blue', 'colour'),
  ('maroon', 'burgundy', 'colour'),
  ('vneck', 'v-neck', 'attribute'),
  ('crewneck', 'crew-neck', 'attribute'),
  ('longsleeve', 'long-sleeve', 'attribute'),
  ('shortsleeve', 'short-sleeve', 'attribute')
ON CONFLICT (term) DO NOTHING;

-- 7. Analyze to update planner statistics
ANALYZE product_search_materialized;
