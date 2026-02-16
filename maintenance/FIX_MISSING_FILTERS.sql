-- ============================================================================
-- FIX MISSING FILTERS IN MATERIALIZED VIEW
-- ============================================================================
-- This script updates the product_search_mv materialized view to properly
-- populate all filter columns that are currently empty or missing.
--
-- PROBLEM: 
-- - neckline_slugs and sleeve_slugs are hardcoded as empty arrays
-- - Several filter columns are missing entirely (weight, fit, sector, sport, effect, accreditations)
--
-- SOLUTION:
-- 1. Drop the existing materialized views
-- 2. Create new product_search_mv with properly populated columns
-- 3. Create new product_search_materialized from the updated view
-- 4. Recreate all indexes
-- ============================================================================

-- ============================================================================
-- OPTIONAL: Enable extensions for advanced indexing (uncomment if needed)
-- ============================================================================
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For fuzzy text search indexes
-- CREATE EXTENSION IF NOT EXISTS btree_gin; -- For GIN indexes on regular columns

-- Step 1: Drop existing materialized views (in correct order due to dependencies)
DROP MATERIALIZED VIEW IF EXISTS public.product_search_materialized CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.product_search_mv CASCADE;

-- Step 2: Create the updated product_search_mv with all filter columns properly populated
CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_search_mv
TABLESPACE pg_default
AS
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
    
    -- Array aggregations for IDs
    array_agg(DISTINCT cat.id) FILTER (WHERE cat.id IS NOT NULL) AS category_ids,
    array_agg(DISTINCT f.id) FILTER (WHERE f.id IS NOT NULL) AS fabric_ids,
    array_agg(DISTINCT sf.id) FILTER (WHERE sf.id IS NOT NULL) AS flag_ids,
    array_agg(DISTINCT acc.id) FILTER (WHERE acc.id IS NOT NULL) AS accreditation_ids,
    
    -- Style keywords (all)
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.slug IS NOT NULL) AS style_keywords,
    
    -- Fabric slugs
    array_agg(DISTINCT f.slug) FILTER (WHERE f.slug IS NOT NULL) AS fabric_slugs,
    
    -- Size slugs
    array_agg(DISTINCT sz.slug) FILTER (WHERE sz.slug IS NOT NULL) AS size_slugs,
    
    -- Style keyword slugs (all keywords)
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.slug IS NOT NULL) AS style_keyword_slugs,
    
    -- Colour slugs
    array_agg(DISTINCT lower(COALESCE(p.colour_name, p.primary_colour)::text)) 
        FILTER (WHERE p.colour_name IS NOT NULL OR p.primary_colour IS NOT NULL) AS colour_slugs,
    
    -- ============================================================================
    -- FIXED: Neckline slugs from style_keywords where keyword_type = 'neckline'
    -- ============================================================================
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'neckline' AND sk.slug IS NOT NULL) AS neckline_slugs,
    
    -- ============================================================================
    -- FIXED: Sleeve slugs from style_keywords where keyword_type = 'sleeve'
    -- ============================================================================
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'sleeve' AND sk.slug IS NOT NULL) AS sleeve_slugs,
    
    -- ============================================================================
    -- NEW: Fit slugs from style_keywords where keyword_type = 'fit'
    -- ============================================================================
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'fit' AND sk.slug IS NOT NULL) AS fit_slugs,
    
    -- ============================================================================
    -- NEW: Feature slugs from style_keywords where keyword_type = 'feature'
    -- ============================================================================
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'feature' AND sk.slug IS NOT NULL) AS feature_slugs,
    
    -- ============================================================================
    -- NEW: Accreditation slugs
    -- ============================================================================
    array_agg(DISTINCT acc.slug) FILTER (WHERE acc.slug IS NOT NULL) AS accreditation_slugs,
    
    -- ============================================================================
    -- NEW: Effect slugs from product_effects (named effects_arr to match code)
    -- ============================================================================
    array_agg(DISTINCT e.slug) FILTER (WHERE e.slug IS NOT NULL) AS effects_arr,
    
    -- ============================================================================
    -- NEW: Sector slugs from product_sectors
    -- ============================================================================
    array_agg(DISTINCT rs.slug) FILTER (WHERE rs.slug IS NOT NULL) AS sector_slugs,
    
    -- ============================================================================
    -- NEW: Sport slugs from product_sports
    -- ============================================================================
    array_agg(DISTINCT rsp.slug) FILTER (WHERE rsp.slug IS NOT NULL) AS sport_slugs,
    
    -- ============================================================================
    -- NEW: Weight slugs from product_weight_ranges → weight_ranges
    -- ============================================================================
    array_agg(DISTINCT wr.slug) FILTER (WHERE wr.slug IS NOT NULL) AS weight_slugs,
    
    -- Full-text search vector
    to_tsvector('english'::regconfig, 
        COALESCE(s.style_name, '')::text || ' ' || 
        COALESCE(b.name, '')::text || ' ' || 
        COALESCE(p.colour_name, '')::text || ' ' || 
        COALESCE(p.primary_colour, '')::text || ' ' || 
        COALESCE(sz.slug, '')::text || ' ' || 
        COALESCE(t.slug, '')::text
    ) AS search_vector

FROM products p
JOIN styles s ON p.style_code = s.style_code
LEFT JOIN brands b ON s.brand_id = b.id
LEFT JOIN genders g ON s.gender_id = g.id
LEFT JOIN age_groups ag ON s.age_group_id = ag.id
LEFT JOIN sizes sz ON p.size_id = sz.id
LEFT JOIN tags t ON p.tag_id = t.id

-- Categories
LEFT JOIN product_categories pc ON p.id = pc.product_id
LEFT JOIN categories cat ON pc.category_id = cat.id

-- Fabrics
LEFT JOIN product_fabrics pfab ON p.id = pfab.product_id
LEFT JOIN fabrics f ON pfab.fabric_id = f.id

-- Special Flags
LEFT JOIN product_flags pf ON p.id = pf.product_id
LEFT JOIN special_flags sf ON pf.flag_id = sf.id

-- Accreditations
LEFT JOIN product_accreditations pa ON p.id = pa.product_id
LEFT JOIN accreditations acc ON pa.accreditation_id = acc.id

-- Style Keywords (for neckline, sleeve, fit, feature)
LEFT JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
LEFT JOIN style_keywords sk ON skm.keyword_id = sk.id

-- Effects
LEFT JOIN product_effects pe ON p.id = pe.product_id
LEFT JOIN effects e ON pe.effect_id = e.id

-- Sectors
LEFT JOIN product_sectors ps ON p.id = ps.product_id
LEFT JOIN related_sectors rs ON ps.sector_id = rs.id

-- Sports
LEFT JOIN product_sports psp ON p.id = psp.product_id
LEFT JOIN related_sports rsp ON psp.sport_id = rsp.id

-- Weight ranges (through product_weight_ranges junction table)
LEFT JOIN product_weight_ranges pwr ON p.id = pwr.product_id
LEFT JOIN weight_ranges wr ON pwr.weight_range_id = wr.id

WHERE p.sku_status = 'Live'
  AND (b.id IS NULL OR b.is_active = true)
GROUP BY p.id, s.style_code, s.style_name, b.name, g.slug, ag.slug, sz.slug, t.slug, s.is_best_seller, s.is_recommended
WITH DATA;

ALTER TABLE IF EXISTS public.product_search_mv OWNER TO brandeduk;

-- Step 3: Create product_search_materialized from the updated view
CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_search_materialized
WITH (
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_scale_factor = 0.01
)
TABLESPACE pg_default
AS
SELECT 
    id,
    style_code,
    colour_name,
    primary_colour,
    colour_shade,
    single_price,
    sell_price,
    sku_status,
    primary_image_url,
    created_at,
    style_name,
    brand,
    gender_slug,
    age_group_slug,
    size_slug,
    tag_slug,
    category_ids,
    fabric_ids,
    flag_ids,
    accreditation_ids,
    style_keywords,
    fabric_slugs,
    size_slugs,
    style_keyword_slugs,
    colour_slugs,
    neckline_slugs,
    sleeve_slugs,
    fit_slugs,
    feature_slugs,
    accreditation_slugs,
    effects_arr,
    sector_slugs,
    sport_slugs,
    weight_slugs,
    search_vector
FROM product_search_mv
WITH DATA;

ALTER TABLE IF EXISTS public.product_search_materialized OWNER TO brandeduk;

-- Step 4: Create all necessary indexes
CREATE UNIQUE INDEX idx_psm_unique ON public.product_search_materialized USING btree (id);
CREATE UNIQUE INDEX product_search_materialized_unique_idx ON public.product_search_materialized USING btree (id);

CREATE INDEX idx_psm_active_only ON public.product_search_materialized USING btree (style_code) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_style_code ON public.product_search_materialized USING btree (style_code);
CREATE INDEX idx_psm_style_status ON public.product_search_materialized USING btree (style_code, sku_status);
CREATE INDEX idx_psm_sku_status ON public.product_search_materialized USING btree (sku_status);
CREATE INDEX idx_psm_created ON public.product_search_materialized USING btree (created_at) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sell_price ON public.product_search_materialized USING btree (sell_price);
CREATE INDEX idx_psm_price ON public.product_search_materialized USING btree (sell_price) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_price_range ON public.product_search_materialized USING btree (sell_price) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;
CREATE INDEX idx_psm_gender ON public.product_search_materialized USING btree (gender_slug) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gender_sku ON public.product_search_materialized USING btree (gender_slug, sku_status) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gender_fast ON public.product_search_materialized USING btree (gender_slug, sku_status, created_at DESC) WHERE sku_status = 'Live';

-- GIN indexes for array columns
CREATE INDEX idx_psm_search_vector ON public.product_search_materialized USING gin (search_vector);
CREATE INDEX idx_psm_search_gin ON public.product_search_materialized USING gin (search_vector) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_lightning ON public.product_search_materialized USING gin (search_vector) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_colour_slugs_gin ON public.product_search_materialized USING gin (colour_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_colour_size_gin ON public.product_search_materialized USING gin (colour_slugs, size_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_size_slugs_gin ON public.product_search_materialized USING gin (size_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_fabric_slugs_gin ON public.product_search_materialized USING gin (fabric_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_style_keywords_gin ON public.product_search_materialized USING gin (style_keyword_slugs) WHERE sku_status = 'Live';

-- NEW GIN indexes for the new columns
CREATE INDEX idx_psm_neckline_slugs_gin ON public.product_search_materialized USING gin (neckline_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sleeve_slugs_gin ON public.product_search_materialized USING gin (sleeve_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_fit_slugs_gin ON public.product_search_materialized USING gin (fit_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_feature_slugs_gin ON public.product_search_materialized USING gin (feature_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_accreditation_slugs_gin ON public.product_search_materialized USING gin (accreditation_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_effects_arr_gin ON public.product_search_materialized USING gin (effects_arr) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sector_slugs_gin ON public.product_search_materialized USING gin (sector_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sport_slugs_gin ON public.product_search_materialized USING gin (sport_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_weight_slugs_gin ON public.product_search_materialized USING gin (weight_slugs) WHERE sku_status = 'Live';

-- Composite indexes for common queries
CREATE INDEX idx_psm_counting ON public.product_search_materialized USING btree (sku_status, style_code) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_pagination ON public.product_search_materialized USING btree (sku_status, created_at DESC, style_code, style_name, sell_price, gender_slug) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_super_filter ON public.product_search_materialized USING btree (sku_status, created_at DESC, gender_slug, sell_price, style_code) WHERE sku_status = 'Live';

-- ============================================================================
-- PERFORMANCE INDEXES - Enterprise-Level Optimization
-- ============================================================================

-- Brand indexes (for brand filtering)
CREATE INDEX idx_psm_brand ON public.product_search_materialized USING btree (brand) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_brand_created ON public.product_search_materialized USING btree (brand, created_at DESC) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_brand_price ON public.product_search_materialized USING btree (brand, sell_price) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;

-- Age group indexes
CREATE INDEX idx_psm_age_group ON public.product_search_materialized USING btree (age_group_slug) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_age_group_gender ON public.product_search_materialized USING btree (age_group_slug, gender_slug) WHERE sku_status = 'Live';

-- Tag indexes
CREATE INDEX idx_psm_tag ON public.product_search_materialized USING btree (tag_slug) WHERE sku_status = 'Live';

-- Primary colour indexes (for color filtering)
CREATE INDEX idx_psm_primary_colour ON public.product_search_materialized USING btree (primary_colour) WHERE sku_status = 'Live' AND primary_colour IS NOT NULL;
CREATE INDEX idx_psm_colour_shade ON public.product_search_materialized USING btree (colour_shade) WHERE sku_status = 'Live' AND colour_shade IS NOT NULL;

-- Price range indexes (for price filtering)
CREATE INDEX idx_psm_price_asc ON public.product_search_materialized USING btree (sell_price ASC) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;
CREATE INDEX idx_psm_price_desc ON public.product_search_materialized USING btree (sell_price DESC) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;

-- Sorting indexes (common sort combinations)
CREATE INDEX idx_psm_sort_newest ON public.product_search_materialized USING btree (created_at DESC, style_code) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sort_oldest ON public.product_search_materialized USING btree (created_at ASC, style_code) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sort_price_low ON public.product_search_materialized USING btree (sell_price ASC, style_code) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;
CREATE INDEX idx_psm_sort_price_high ON public.product_search_materialized USING btree (sell_price DESC, style_code) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;
CREATE INDEX idx_psm_sort_name_asc ON public.product_search_materialized USING btree (style_name ASC, style_code) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_sort_name_desc ON public.product_search_materialized USING btree (style_name DESC, style_code) WHERE sku_status = 'Live';

-- Composite filter indexes (most common filter combinations)
CREATE INDEX idx_psm_gender_age ON public.product_search_materialized USING btree (gender_slug, age_group_slug, created_at DESC) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gender_price ON public.product_search_materialized USING btree (gender_slug, sell_price) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;
CREATE INDEX idx_psm_gender_brand ON public.product_search_materialized USING btree (gender_slug, brand, created_at DESC) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_colour_gender ON public.product_search_materialized USING btree (primary_colour, gender_slug, created_at DESC) WHERE sku_status = 'Live' AND primary_colour IS NOT NULL;

-- Multi-column GIN indexes for array filter combinations (super fast!)
CREATE INDEX idx_psm_gin_sleeve_neckline ON public.product_search_materialized USING gin (sleeve_slugs, neckline_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gin_fit_feature ON public.product_search_materialized USING gin (fit_slugs, feature_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gin_fabric_colour ON public.product_search_materialized USING gin (fabric_slugs, colour_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gin_size_colour ON public.product_search_materialized USING gin (size_slugs, colour_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gin_sector_sport ON public.product_search_materialized USING gin (sector_slugs, sport_slugs) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_gin_accreditation_effect ON public.product_search_materialized USING gin (accreditation_slugs, effects_arr) WHERE sku_status = 'Live';

-- Covering indexes for common SELECT patterns (PostgreSQL 11+ required for INCLUDE)
-- This index includes frequently selected columns to avoid table lookups
CREATE INDEX idx_psm_covering_list ON public.product_search_materialized USING btree (sku_status, created_at DESC, style_code) 
    INCLUDE (style_name, brand, gender_slug, sell_price, primary_colour, primary_image_url)
    WHERE sku_status = 'Live';

-- Text search optimization indexes (requires pg_trgm extension - uncomment if enabled)
-- These are for fuzzy text matching (ILIKE '%text%' queries)
-- CREATE INDEX idx_psm_style_name_trgm ON public.product_search_materialized USING gin (style_name gin_trgm_ops) WHERE sku_status = 'Live';
-- CREATE INDEX idx_psm_brand_trgm ON public.product_search_materialized USING gin (brand gin_trgm_ops) WHERE sku_status = 'Live';

-- Style code lookup (for product detail queries)
CREATE INDEX idx_psm_style_code_live ON public.product_search_materialized USING btree (style_code, sku_status) WHERE sku_status = 'Live';
CREATE INDEX idx_psm_style_code_colour ON public.product_search_materialized USING btree (style_code, primary_colour) WHERE sku_status = 'Live' AND primary_colour IS NOT NULL;

-- Category filtering (using category_ids array)
CREATE INDEX idx_psm_category_ids_gin ON public.product_search_materialized USING gin (category_ids) WHERE sku_status = 'Live';

-- Flag filtering (using flag_ids array)
CREATE INDEX idx_psm_flag_ids_gin ON public.product_search_materialized USING gin (flag_ids) WHERE sku_status = 'Live';

-- Fabric filtering (using fabric_ids array)
CREATE INDEX idx_psm_fabric_ids_gin ON public.product_search_materialized USING gin (fabric_ids) WHERE sku_status = 'Live';

-- Accreditation filtering (using accreditation_ids array)
CREATE INDEX idx_psm_accreditation_ids_gin ON public.product_search_materialized USING gin (accreditation_ids) WHERE sku_status = 'Live';

-- Ultra-fast pagination index (for offset-based pagination)
CREATE INDEX idx_psm_pagination_ultra ON public.product_search_materialized USING btree (sku_status, created_at DESC NULLS LAST, id) WHERE sku_status = 'Live';

-- Price + created_at composite (for price-sorted pagination)
CREATE INDEX idx_psm_price_created ON public.product_search_materialized USING btree (sell_price, created_at DESC) WHERE sku_status = 'Live' AND sell_price IS NOT NULL;

-- ============================================================================
-- VERIFICATION QUERIES (run these after the update to check results)
-- ============================================================================

-- Check neckline_slugs are now populated
-- SELECT style_code, neckline_slugs FROM product_search_materialized WHERE array_length(neckline_slugs, 1) > 0 LIMIT 10;

-- Check sleeve_slugs are now populated
-- SELECT style_code, sleeve_slugs FROM product_search_materialized WHERE array_length(sleeve_slugs, 1) > 0 LIMIT 10;

-- Check fit_slugs are now populated
-- SELECT style_code, fit_slugs FROM product_search_materialized WHERE array_length(fit_slugs, 1) > 0 LIMIT 10;

-- Check effects_arr are now populated
-- SELECT style_code, effects_arr FROM product_search_materialized WHERE array_length(effects_arr, 1) > 0 LIMIT 10;

-- Check sector_slugs are now populated
-- SELECT style_code, sector_slugs FROM product_search_materialized WHERE array_length(sector_slugs, 1) > 0 LIMIT 10;

-- Check accreditation_slugs are now populated
-- SELECT style_code, accreditation_slugs FROM product_search_materialized WHERE array_length(accreditation_slugs, 1) > 0 LIMIT 10;

-- Count how many products have each filter type
-- SELECT 
--     'neckline' as filter, COUNT(*) FILTER (WHERE array_length(neckline_slugs, 1) > 0) as products_with_data,
--     COUNT(*) as total_products
-- FROM product_search_materialized WHERE sku_status = 'Live'
-- UNION ALL
-- SELECT 'sleeve', COUNT(*) FILTER (WHERE array_length(sleeve_slugs, 1) > 0), COUNT(*)
-- FROM product_search_materialized WHERE sku_status = 'Live'
-- UNION ALL
-- SELECT 'fit', COUNT(*) FILTER (WHERE array_length(fit_slugs, 1) > 0), COUNT(*)
-- FROM product_search_materialized WHERE sku_status = 'Live'
-- UNION ALL
-- SELECT 'effect', COUNT(*) FILTER (WHERE array_length(effects_arr, 1) > 0), COUNT(*)
-- FROM product_search_materialized WHERE sku_status = 'Live'
-- UNION ALL
-- SELECT 'sector', COUNT(*) FILTER (WHERE array_length(sector_slugs, 1) > 0), COUNT(*)
-- FROM product_search_materialized WHERE sku_status = 'Live'
-- UNION ALL
-- SELECT 'accreditation', COUNT(*) FILTER (WHERE array_length(accreditation_slugs, 1) > 0), COUNT(*)
-- FROM product_search_materialized WHERE sku_status = 'Live';

-- ============================================================================
-- NOTE: weight_slugs is populated through the product_weight_ranges junction table
-- This links products directly to weight_ranges (many-to-many relationship)
-- ============================================================================

