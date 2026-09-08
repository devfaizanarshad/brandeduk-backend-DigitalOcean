-- Build the same 41-column search catalogue without multiplying every
-- one-to-many mapping against every other mapping. The replacement is built
-- and validated before the existing views are swapped in one transaction.

BEGIN;
SET LOCAL statement_timeout = '30min';
SET LOCAL lock_timeout = '30s';

DROP MATERIALIZED VIEW IF EXISTS product_search_mv_next;

CREATE MATERIALIZED VIEW product_search_mv_next AS
WITH
category_map AS (
  SELECT pc.product_id,
    array_agg(DISTINCT cat.id) FILTER (WHERE cat.id IS NOT NULL) AS category_ids
  FROM product_categories pc
  JOIN categories cat ON cat.id = pc.category_id
  GROUP BY pc.product_id
),
fabric_map AS (
  SELECT pf.product_id,
    array_agg(DISTINCT f.id) FILTER (WHERE f.id IS NOT NULL) AS fabric_ids,
    array_agg(DISTINCT f.slug) FILTER (WHERE f.slug IS NOT NULL) AS fabric_slugs
  FROM product_fabrics pf
  JOIN fabrics f ON f.id = pf.fabric_id
  GROUP BY pf.product_id
),
flag_map AS (
  SELECT pf.product_id,
    array_agg(DISTINCT sf.id) FILTER (WHERE sf.id IS NOT NULL) AS flag_ids
  FROM product_flags pf
  JOIN special_flags sf ON sf.id = pf.flag_id
  GROUP BY pf.product_id
),
accreditation_map AS (
  SELECT pa.product_id,
    array_agg(DISTINCT acc.id) FILTER (WHERE acc.id IS NOT NULL) AS accreditation_ids,
    array_agg(DISTINCT acc.slug) FILTER (WHERE acc.slug IS NOT NULL) AS accreditation_slugs
  FROM product_accreditations pa
  JOIN accreditations acc ON acc.id = pa.accreditation_id
  GROUP BY pa.product_id
),
keyword_map AS (
  SELECT skm.style_code,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.slug IS NOT NULL) AS all_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'neckline' AND sk.slug IS NOT NULL) AS neckline_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'sleeve' AND sk.slug IS NOT NULL) AS sleeve_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'fit' AND sk.slug IS NOT NULL) AS fit_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'feature' AND sk.slug IS NOT NULL) AS feature_slugs
  FROM style_keywords_mapping skm
  JOIN style_keywords sk ON sk.id = skm.keyword_id
  GROUP BY skm.style_code
),
effect_map AS (
  SELECT pe.product_id,
    array_agg(DISTINCT e.slug) FILTER (WHERE e.slug IS NOT NULL) AS effects_arr
  FROM product_effects pe
  JOIN effects e ON e.id = pe.effect_id
  GROUP BY pe.product_id
),
sector_map AS (
  SELECT ps.product_id,
    array_agg(DISTINCT rs.slug) FILTER (WHERE rs.slug IS NOT NULL) AS sector_slugs
  FROM product_sectors ps
  JOIN related_sectors rs ON rs.id = ps.sector_id
  GROUP BY ps.product_id
),
sport_map AS (
  SELECT ps.product_id,
    array_agg(DISTINCT rs.slug) FILTER (WHERE rs.slug IS NOT NULL) AS sport_slugs
  FROM product_sports ps
  JOIN related_sports rs ON rs.id = ps.sport_id
  GROUP BY ps.product_id
),
weight_map AS (
  SELECT pw.product_id,
    array_agg(DISTINCT wr.slug) FILTER (WHERE wr.slug IS NOT NULL) AS weight_slugs
  FROM product_weight_ranges pw
  JOIN weight_ranges wr ON wr.id = pw.weight_range_id
  GROUP BY pw.product_id
)
SELECT
  p.id,
  p.style_code,
  p.colour_name,
  p.primary_colour,
  p.colour_shade,
  p.single_price,
  p.sell_price,
  p.sku_status,
  p.primary_image_url,
  p.created_at,
  s.style_name,
  b.name AS brand,
  g.slug AS gender_slug,
  ag.slug AS age_group_slug,
  sz.slug AS size_slug,
  t.slug AS tag_slug,
  s.is_best_seller,
  s.is_recommended,
  s.is_featured,
  s.best_seller_order,
  s.recommended_order,
  s.featured_order,
  cm.category_ids,
  fm.fabric_ids,
  flm.flag_ids,
  am.accreditation_ids,
  km.all_slugs AS style_keywords,
  fm.fabric_slugs,
  CASE WHEN sz.slug IS NULL THEN NULL::character varying[] ELSE ARRAY[sz.slug]::character varying[] END AS size_slugs,
  km.all_slugs AS style_keyword_slugs,
  CASE
    WHEN p.colour_name IS NULL AND p.primary_colour IS NULL THEN NULL::text[]
    ELSE ARRAY[lower(COALESCE(p.colour_name, p.primary_colour)::text)]::text[]
  END AS colour_slugs,
  km.neckline_slugs,
  km.sleeve_slugs,
  km.fit_slugs,
  km.feature_slugs,
  am.accreditation_slugs,
  em.effects_arr,
  sem.sector_slugs,
  spm.sport_slugs,
  wm.weight_slugs,
  to_tsvector('english',
    COALESCE(s.style_name, '') || ' ' ||
    COALESCE(b.name, '') || ' ' ||
    COALESCE(p.colour_name, '') || ' ' ||
    COALESCE(p.primary_colour, '') || ' ' ||
    COALESCE(sz.slug, '') || ' ' ||
    COALESCE(t.slug, '')
  ) AS search_vector
FROM products p
JOIN styles s ON s.style_code = p.style_code
LEFT JOIN brands b ON b.id = s.brand_id
LEFT JOIN genders g ON g.id = s.gender_id
LEFT JOIN age_groups ag ON ag.id = s.age_group_id
LEFT JOIN sizes sz ON sz.id = p.size_id
LEFT JOIN tags t ON t.id = p.tag_id
LEFT JOIN category_map cm ON cm.product_id = p.id
LEFT JOIN fabric_map fm ON fm.product_id = p.id
LEFT JOIN flag_map flm ON flm.product_id = p.id
LEFT JOIN accreditation_map am ON am.product_id = p.id
LEFT JOIN keyword_map km ON km.style_code = s.style_code
LEFT JOIN effect_map em ON em.product_id = p.id
LEFT JOIN sector_map sem ON sem.product_id = p.id
LEFT JOIN sport_map spm ON spm.product_id = p.id
LEFT JOIN weight_map wm ON wm.product_id = p.id
WHERE p.sku_status = 'Live';

CREATE UNIQUE INDEX idx_product_search_mv_next_unique_id
  ON product_search_mv_next (id);

SELECT
  count(*) FILTER (WHERE current_view.style_code IS DISTINCT FROM next_view.style_code) AS style_code,
  count(*) FILTER (WHERE current_view.colour_name IS DISTINCT FROM next_view.colour_name) AS colour_name,
  count(*) FILTER (WHERE current_view.primary_colour IS DISTINCT FROM next_view.primary_colour) AS primary_colour,
  count(*) FILTER (WHERE current_view.colour_shade IS DISTINCT FROM next_view.colour_shade) AS colour_shade,
  count(*) FILTER (WHERE current_view.single_price IS DISTINCT FROM next_view.single_price) AS single_price,
  count(*) FILTER (WHERE current_view.sell_price IS DISTINCT FROM next_view.sell_price) AS sell_price,
  count(*) FILTER (WHERE current_view.sku_status IS DISTINCT FROM next_view.sku_status) AS sku_status,
  count(*) FILTER (WHERE current_view.primary_image_url IS DISTINCT FROM next_view.primary_image_url) AS primary_image_url,
  count(*) FILTER (WHERE current_view.created_at IS DISTINCT FROM next_view.created_at) AS created_at,
  count(*) FILTER (WHERE current_view.style_name IS DISTINCT FROM next_view.style_name) AS style_name,
  count(*) FILTER (WHERE current_view.brand IS DISTINCT FROM next_view.brand) AS brand,
  count(*) FILTER (WHERE current_view.gender_slug IS DISTINCT FROM next_view.gender_slug) AS gender_slug,
  count(*) FILTER (WHERE current_view.age_group_slug IS DISTINCT FROM next_view.age_group_slug) AS age_group_slug,
  count(*) FILTER (WHERE current_view.size_slug IS DISTINCT FROM next_view.size_slug) AS size_slug,
  count(*) FILTER (WHERE current_view.tag_slug IS DISTINCT FROM next_view.tag_slug) AS tag_slug,
  count(*) FILTER (WHERE current_view.is_best_seller IS DISTINCT FROM next_view.is_best_seller) AS is_best_seller,
  count(*) FILTER (WHERE current_view.is_recommended IS DISTINCT FROM next_view.is_recommended) AS is_recommended,
  count(*) FILTER (WHERE current_view.is_featured IS DISTINCT FROM next_view.is_featured) AS is_featured,
  count(*) FILTER (WHERE current_view.best_seller_order IS DISTINCT FROM next_view.best_seller_order) AS best_seller_order,
  count(*) FILTER (WHERE current_view.recommended_order IS DISTINCT FROM next_view.recommended_order) AS recommended_order,
  count(*) FILTER (WHERE current_view.featured_order IS DISTINCT FROM next_view.featured_order) AS featured_order,
  count(*) FILTER (WHERE current_view.category_ids IS DISTINCT FROM next_view.category_ids) AS category_ids,
  count(*) FILTER (WHERE current_view.fabric_ids IS DISTINCT FROM next_view.fabric_ids) AS fabric_ids,
  count(*) FILTER (WHERE current_view.flag_ids IS DISTINCT FROM next_view.flag_ids) AS flag_ids,
  count(*) FILTER (WHERE current_view.accreditation_ids IS DISTINCT FROM next_view.accreditation_ids) AS accreditation_ids,
  count(*) FILTER (WHERE current_view.style_keywords IS DISTINCT FROM next_view.style_keywords) AS style_keywords,
  count(*) FILTER (WHERE current_view.fabric_slugs IS DISTINCT FROM next_view.fabric_slugs) AS fabric_slugs,
  count(*) FILTER (WHERE current_view.size_slugs IS DISTINCT FROM next_view.size_slugs) AS size_slugs,
  count(*) FILTER (WHERE current_view.style_keyword_slugs IS DISTINCT FROM next_view.style_keyword_slugs) AS style_keyword_slugs,
  count(*) FILTER (WHERE current_view.colour_slugs IS DISTINCT FROM next_view.colour_slugs) AS colour_slugs,
  count(*) FILTER (WHERE current_view.neckline_slugs IS DISTINCT FROM next_view.neckline_slugs) AS neckline_slugs,
  count(*) FILTER (WHERE current_view.sleeve_slugs IS DISTINCT FROM next_view.sleeve_slugs) AS sleeve_slugs,
  count(*) FILTER (WHERE current_view.fit_slugs IS DISTINCT FROM next_view.fit_slugs) AS fit_slugs,
  count(*) FILTER (WHERE current_view.feature_slugs IS DISTINCT FROM next_view.feature_slugs) AS feature_slugs,
  count(*) FILTER (WHERE current_view.accreditation_slugs IS DISTINCT FROM next_view.accreditation_slugs) AS accreditation_slugs,
  count(*) FILTER (WHERE current_view.effects_arr IS DISTINCT FROM next_view.effects_arr) AS effects_arr,
  count(*) FILTER (WHERE current_view.sector_slugs IS DISTINCT FROM next_view.sector_slugs) AS sector_slugs,
  count(*) FILTER (WHERE current_view.sport_slugs IS DISTINCT FROM next_view.sport_slugs) AS sport_slugs,
  count(*) FILTER (WHERE current_view.weight_slugs IS DISTINCT FROM next_view.weight_slugs) AS weight_slugs,
  count(*) FILTER (WHERE current_view.search_vector IS DISTINCT FROM next_view.search_vector) AS search_vector
FROM product_search_mv current_view
FULL JOIN product_search_mv_next next_view USING (id);

DO $$
DECLARE
  expected_rows bigint;
  next_rows bigint;
  schema_differences integer;
  content_differences bigint;
BEGIN
  SELECT count(*) INTO expected_rows FROM products WHERE sku_status = 'Live';
  SELECT count(*) INTO next_rows FROM product_search_mv_next;
  IF next_rows <> expected_rows THEN
    RAISE EXCEPTION 'Optimized search view has % rows; expected %', next_rows, expected_rows;
  END IF;

  SELECT count(*) INTO schema_differences
  FROM (
    SELECT attnum, attname, atttypid, atttypmod
    FROM pg_attribute WHERE attrelid = 'product_search_mv'::regclass AND attnum > 0 AND NOT attisdropped
    EXCEPT
    SELECT attnum, attname, atttypid, atttypmod
    FROM pg_attribute WHERE attrelid = 'product_search_mv_next'::regclass AND attnum > 0 AND NOT attisdropped
  ) differences;
  IF schema_differences <> 0 THEN
    RAISE EXCEPTION 'Optimized search view schema differs from the existing view';
  END IF;

  SELECT count(*) INTO content_differences
  FROM product_search_mv current_view
  FULL JOIN product_search_mv_next next_view USING (id)
  WHERE current_view.category_ids IS DISTINCT FROM next_view.category_ids
     OR current_view.fabric_ids IS DISTINCT FROM next_view.fabric_ids
     OR current_view.flag_ids IS DISTINCT FROM next_view.flag_ids
     OR current_view.accreditation_ids IS DISTINCT FROM next_view.accreditation_ids
     OR current_view.style_keywords IS DISTINCT FROM next_view.style_keywords
     OR current_view.fabric_slugs IS DISTINCT FROM next_view.fabric_slugs
     OR current_view.size_slugs IS DISTINCT FROM next_view.size_slugs
     OR current_view.style_keyword_slugs IS DISTINCT FROM next_view.style_keyword_slugs
     OR current_view.colour_slugs IS DISTINCT FROM next_view.colour_slugs
     OR current_view.neckline_slugs IS DISTINCT FROM next_view.neckline_slugs
     OR current_view.sleeve_slugs IS DISTINCT FROM next_view.sleeve_slugs
     OR current_view.fit_slugs IS DISTINCT FROM next_view.fit_slugs
     OR current_view.feature_slugs IS DISTINCT FROM next_view.feature_slugs
     OR current_view.accreditation_slugs IS DISTINCT FROM next_view.accreditation_slugs
     OR current_view.effects_arr IS DISTINCT FROM next_view.effects_arr
     OR current_view.sector_slugs IS DISTINCT FROM next_view.sector_slugs
     OR current_view.sport_slugs IS DISTINCT FROM next_view.sport_slugs
     OR current_view.weight_slugs IS DISTINCT FROM next_view.weight_slugs
     OR current_view.search_vector IS DISTINCT FROM next_view.search_vector;
  IF content_differences <> 0 THEN
    RAISE EXCEPTION 'Optimized search view changes derived filter data on % existing rows', content_differences;
  END IF;
END $$;

DROP MATERIALIZED VIEW product_search_materialized;
DROP MATERIALIZED VIEW product_search_mv;
ALTER MATERIALIZED VIEW product_search_mv_next RENAME TO product_search_mv;
ALTER INDEX idx_product_search_mv_next_unique_id RENAME TO idx_product_search_mv_unique_id;

CREATE MATERIALIZED VIEW product_search_materialized AS
SELECT * FROM product_search_mv;

CREATE INDEX idx_psm_accreditation_slugs_gin ON product_search_materialized USING gin (accreditation_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_brand ON product_search_materialized (brand) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_category_ids_gin ON product_search_materialized USING gin (category_ids) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_colour_slugs_gin ON product_search_materialized USING gin (colour_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_created ON product_search_materialized (created_at) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_effects_arr_gin ON product_search_materialized USING gin (effects_arr) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_fabric_slugs_gin ON product_search_materialized USING gin (fabric_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_feature_slugs_gin ON product_search_materialized USING gin (feature_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_fit_slugs_gin ON product_search_materialized USING gin (fit_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_flag_ids_gin ON product_search_materialized USING gin (flag_ids) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gender ON product_search_materialized (gender_slug) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gender_created ON product_search_materialized (gender_slug, created_at DESC) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_is_best ON product_search_materialized (is_best_seller) WHERE sku_status = 'Live' AND is_best_seller = true;
CREATE INDEX idx_psm_is_featured ON product_search_materialized (is_featured) WHERE sku_status = 'Live' AND is_featured = true;
CREATE INDEX idx_psm_is_recommended ON product_search_materialized (is_recommended) WHERE sku_status = 'Live' AND is_recommended = true;
CREATE INDEX idx_psm_neckline_slugs_gin ON product_search_materialized USING gin (neckline_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_primary_colour ON product_search_materialized (primary_colour) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_search_gin ON product_search_materialized USING gin (search_vector) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sector_slugs_gin ON product_search_materialized USING gin (sector_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sell_price ON product_search_materialized (sell_price) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_size_slugs_gin ON product_search_materialized USING gin (size_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sku_status ON product_search_materialized (sku_status);
CREATE INDEX idx_psm_sleeve_slugs_gin ON product_search_materialized USING gin (sleeve_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sort_newest ON product_search_materialized (created_at DESC, style_code) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sort_price_high ON product_search_materialized (sell_price DESC, style_code) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;
CREATE INDEX idx_psm_sort_price_low ON product_search_materialized (sell_price, style_code) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;
CREATE INDEX idx_psm_sport_slugs_gin ON product_search_materialized USING gin (sport_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_style_code ON product_search_materialized (style_code);
CREATE INDEX idx_psm_style_keywords_gin ON product_search_materialized USING gin (style_keyword_slugs) WHERE sku_status = 'Live';
CREATE UNIQUE INDEX idx_psm_unique ON product_search_materialized (id);
CREATE INDEX idx_psm_weight_slugs_gin ON product_search_materialized USING gin (weight_slugs) WHERE sku_status = 'Live';

ANALYZE product_search_mv;
ANALYZE product_search_materialized;
COMMIT;
