-- Views and Materialized Views
-- Regular View
CREATE OR REPLACE VIEW "product_search_view" AS  SELECT p.id,
    p.sku_code,
    p.colour_name,
    p.primary_colour,
    p.colour_shade,
    p.single_price,
    p.carton_price,
    p.pack_price,
    p.sku_status,
    p.primary_image_url,
    p.colour_image_url,
    p.stock_quantity,
    p.created_at,
    p.updated_at,
    s.style_code,
    s.style_name,
    s.specification,
    s.fabric_description,
    pt.id AS product_type_id,
    pt.name AS product_type,
    pt.slug AS product_type_slug,
    b.id AS brand_id,
    b.name AS brand,
    b.slug AS brand_slug,
    g.id AS gender_id,
    g.name AS gender,
    g.slug AS gender_slug,
    ag.id AS age_group_id,
    ag.name AS age_group,
    ag.slug AS age_group_slug,
    sz.id AS size_id,
    sz.name AS size,
    sz.slug AS size_slug,
    sz.size_order,
    t.id AS tag_id,
    t.name AS tag,
    t.slug AS tag_slug,
    c.id AS colour_id,
    c.name AS colour,
    c.hex_code AS colour_hex,
    c.colour_family,
    string_agg(DISTINCT cat.name::text, ', '::text ORDER BY (cat.name::text)) FILTER (WHERE cat.name IS NOT NULL) AS categories,
    string_agg(DISTINCT acc.name::text, ', '::text ORDER BY (acc.name::text)) FILTER (WHERE acc.name IS NOT NULL) AS accreditations,
    string_agg(DISTINCT e.name::text, ', '::text ORDER BY (e.name::text)) FILTER (WHERE e.name IS NOT NULL) AS effects,
    string_agg(DISTINCT sf.name::text, ', '::text ORDER BY (sf.name::text)) FILTER (WHERE sf.name IS NOT NULL) AS flags,
    string_agg(DISTINCT f.name::text, ', '::text ORDER BY (f.name::text)) FILTER (WHERE f.name IS NOT NULL) AS fabrics,
    string_agg(DISTINCT sk.name::text, ', '::text ORDER BY (sk.name::text)) FILTER (WHERE sk.name IS NOT NULL) AS style_keywords,
    (((((((((((((((COALESCE(s.style_name, ''::character varying)::text || ' '::text) || COALESCE(b.name, ''::character varying)::text) || ' '::text) || COALESCE(pt.name, ''::character varying)::text) || ' '::text) || COALESCE(p.colour_name, ''::character varying)::text) || ' '::text) || COALESCE(p.primary_colour, ''::character varying)::text) || ' '::text) || COALESCE(sz.name, ''::character varying)::text) || ' '::text) || COALESCE(t.name, ''::character varying)::text) || ' '::text) || COALESCE(s.specification, ''::text)) || ' '::text) || COALESCE(s.fabric_description, ''::text) AS searchable_text,
    to_tsvector('english'::regconfig, (((((((((((COALESCE(s.style_name, ''::character varying)::text || ' '::text) || COALESCE(b.name, ''::character varying)::text) || ' '::text) || COALESCE(pt.name, ''::character varying)::text) || ' '::text) || COALESCE(p.colour_name, ''::character varying)::text) || ' '::text) || COALESCE(sz.name, ''::character varying)::text) || ' '::text) || COALESCE(t.name, ''::character varying)::text) || ' '::text) || COALESCE(s.specification, ''::text)) AS search_vector
   FROM products p
     JOIN styles s ON p.style_code::text = s.style_code::text
     LEFT JOIN product_types pt ON s.product_type_id = pt.id
     LEFT JOIN brands b ON s.brand_id = b.id
     LEFT JOIN genders g ON s.gender_id = g.id
     LEFT JOIN age_groups ag ON s.age_group_id = ag.id
     LEFT JOIN sizes sz ON p.size_id = sz.id
     LEFT JOIN tags t ON p.tag_id = t.id
     LEFT JOIN colours c ON p.colour_id = c.id
     LEFT JOIN product_categories pc ON p.id = pc.product_id
     LEFT JOIN categories cat ON pc.category_id = cat.id
     LEFT JOIN product_accreditations pa ON p.id = pa.product_id
     LEFT JOIN accreditations acc ON pa.accreditation_id = acc.id
     LEFT JOIN product_effects pe ON p.id = pe.product_id
     LEFT JOIN effects e ON pe.effect_id = e.id
     LEFT JOIN product_flags pf ON p.id = pf.product_id
     LEFT JOIN special_flags sf ON pf.flag_id = sf.id
     LEFT JOIN product_fabrics pfab ON p.id = pfab.product_id
     LEFT JOIN fabrics f ON pfab.fabric_id = f.id
     LEFT JOIN style_keywords_mapping skm ON s.style_code::text = skm.style_code::text
     LEFT JOIN style_keywords sk ON skm.keyword_id = sk.id
  WHERE p.sku_status::text = 'Live'::text
  GROUP BY p.id, s.style_code, s.style_name, s.specification, s.fabric_description, pt.id, pt.name, pt.slug, b.id, b.name, b.slug, g.id, g.name, g.slug, ag.id, ag.name, ag.slug, sz.id, sz.name, sz.slug, sz.size_order, t.id, t.name, t.slug, c.id, c.name, c.hex_code, c.colour_family;

-- ERROR: product_search_materialized - read ECONNRESET

-- ERROR: product_search_mv - connect ENETUNREACH 206.189.119.150:5432

-- Refresh Materialized Views

-- ERROR: connect ENETUNREACH 206.189.119.150:5432
-- ERROR: connect ENETUNREACH 206.189.119.150:5432