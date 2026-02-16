-- Update Materialized View to support Brand deactivation
-- This script updates the where clause to exclude products from inactive brands

-- 1. Drop the materialized view (and its dependent psm which will be recreated)
DROP MATERIALIZED VIEW IF EXISTS public.product_search_materialized CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.product_search_mv CASCADE;

-- 2. Recreate product_search_mv with the brand status filter
CREATE MATERIALIZED VIEW public.product_search_mv AS
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
    
    -- Array aggregations (same as before)
    array_agg(DISTINCT cat.id) FILTER (WHERE cat.id IS NOT NULL) AS category_ids,
    array_agg(DISTINCT f.id) FILTER (WHERE f.id IS NOT NULL) AS fabric_ids,
    array_agg(DISTINCT sf.id) FILTER (WHERE sf.id IS NOT NULL) AS flag_ids,
    array_agg(DISTINCT acc.id) FILTER (WHERE acc.id IS NOT NULL) AS accreditation_ids,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.slug IS NOT NULL) AS style_keywords,
    array_agg(DISTINCT f.slug) FILTER (WHERE f.slug IS NOT NULL) AS fabric_slugs,
    array_agg(DISTINCT sz.slug) FILTER (WHERE sz.slug IS NOT NULL) AS size_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.slug IS NOT NULL) AS style_keyword_slugs,
    array_agg(DISTINCT lower(COALESCE(p.colour_name, p.primary_colour)::text)) 
        FILTER (WHERE p.colour_name IS NOT NULL OR p.primary_colour IS NOT NULL) AS colour_slugs,
    
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'neckline' AND sk.slug IS NOT NULL) AS neckline_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'sleeve' AND sk.slug IS NOT NULL) AS sleeve_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'fit' AND sk.slug IS NOT NULL) AS fit_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'feature' AND sk.slug IS NOT NULL) AS feature_slugs,
    array_agg(DISTINCT acc.slug) FILTER (WHERE acc.slug IS NOT NULL) AS accreditation_slugs,
    array_agg(DISTINCT e.slug) FILTER (WHERE e.slug IS NOT NULL) AS effects_arr,
    array_agg(DISTINCT rs.slug) FILTER (WHERE rs.slug IS NOT NULL) AS sector_slugs,
    array_agg(DISTINCT rsp.slug) FILTER (WHERE rsp.slug IS NOT NULL) AS sport_slugs,
    array_agg(DISTINCT wr.slug) FILTER (WHERE wr.slug IS NOT NULL) AS weight_slugs,
    
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
LEFT JOIN product_categories pc ON p.id = pc.product_id
LEFT JOIN categories cat ON pc.category_id = cat.id
LEFT JOIN product_fabrics pfab ON p.id = pfab.product_id
LEFT JOIN fabrics f ON pfab.fabric_id = f.id
LEFT JOIN product_flags pf ON p.id = pf.product_id
LEFT JOIN special_flags sf ON pf.flag_id = sf.id
LEFT JOIN product_accreditations pa ON p.id = pa.product_id
LEFT JOIN accreditations acc ON pa.accreditation_id = acc.id
LEFT JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
LEFT JOIN style_keywords sk ON skm.keyword_id = sk.id
LEFT JOIN product_effects pe ON p.id = pe.product_id
LEFT JOIN effects e ON pe.effect_id = e.id
LEFT JOIN product_sectors ps ON p.id = ps.product_id
LEFT JOIN related_sectors rs ON ps.sector_id = rs.id
LEFT JOIN product_sports psp ON p.id = psp.product_id
LEFT JOIN related_sports rsp ON psp.sport_id = rsp.id
LEFT JOIN product_weight_ranges pwr ON p.id = pwr.product_id
LEFT JOIN weight_ranges wr ON pwr.weight_range_id = wr.id

WHERE p.sku_status = 'Live' 
  AND (b.id IS NULL OR b.is_active = true) -- 🚀 EXCLUDE INACTIVE BRANDS
GROUP BY p.id, s.style_code, s.style_name, b.name, g.slug, ag.slug, sz.slug, t.slug;

-- 3. Recreate product_search_materialized
CREATE MATERIALIZED VIEW public.product_search_materialized AS
SELECT * FROM product_search_mv;

-- 4. Re-add the unique index (Required for concurrent refresh)
CREATE UNIQUE INDEX idx_psm_unique_id ON public.product_search_materialized (id);
CREATE UNIQUE INDEX idx_psmv_unique_id ON public.product_search_mv (id);
