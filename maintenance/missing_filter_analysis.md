-- View: public.product_search_materialized

-- DROP MATERIALIZED VIEW IF EXISTS public.product_search_materialized;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_search_materialized
WITH (
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_scale_factor = 0.01
)
TABLESPACE pg_default
AS
 SELECT id,
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
    search_vector
   FROM product_search_mv
WITH DATA;

ALTER TABLE IF EXISTS public.product_search_materialized
    OWNER TO brandeduk;


CREATE INDEX idx_psm_active_only
    ON public.product_search_materialized USING btree
    (style_code COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_colour_size_gin
    ON public.product_search_materialized USING gin
    (colour_slugs COLLATE pg_catalog."default", size_slugs COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_colour_slugs_gin
    ON public.product_search_materialized USING gin
    (colour_slugs COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_counting
    ON public.product_search_materialized USING btree
    (sku_status COLLATE pg_catalog."default", style_code COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_created
    ON public.product_search_materialized USING btree
    (created_at)
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_fabric_slugs_gin
    ON public.product_search_materialized USING gin
    (fabric_slugs COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_gender
    ON public.product_search_materialized USING btree
    (gender_slug COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_gender_fast
    ON public.product_search_materialized USING btree
    (gender_slug COLLATE pg_catalog."default", sku_status COLLATE pg_catalog."default", created_at DESC)
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_gender_sku
    ON public.product_search_materialized USING btree
    (gender_slug COLLATE pg_catalog."default", sku_status COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_lightning
    ON public.product_search_materialized USING gin
    (search_vector)
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_neckline_slugs_gin
    ON public.product_search_materialized USING gin
    (neckline_slugs COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_pagination
    ON public.product_search_materialized USING btree
    (sku_status COLLATE pg_catalog."default", created_at DESC, style_code COLLATE pg_catalog."default", style_name COLLATE pg_catalog."default", sell_price, gender_slug COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_price
    ON public.product_search_materialized USING btree
    (sell_price)
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_price_range
    ON public.product_search_materialized USING btree
    (sell_price)
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text AND sell_price IS NOT NULL;
CREATE INDEX idx_psm_search_gin
    ON public.product_search_materialized USING gin
    (search_vector)
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_search_vector
    ON public.product_search_materialized USING gin
    (search_vector)
    TABLESPACE pg_default;
CREATE INDEX idx_psm_sell_price
    ON public.product_search_materialized USING btree
    (sell_price)
    TABLESPACE pg_default;
CREATE INDEX idx_psm_size_slugs_gin
    ON public.product_search_materialized USING gin
    (size_slugs COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_sku_status
    ON public.product_search_materialized USING btree
    (sku_status COLLATE pg_catalog."default")
    TABLESPACE pg_default;
CREATE INDEX idx_psm_sleeve_slugs_gin
    ON public.product_search_materialized USING gin
    (sleeve_slugs COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_style_code
    ON public.product_search_materialized USING btree
    (style_code COLLATE pg_catalog."default")
    TABLESPACE pg_default;
CREATE INDEX idx_psm_style_keywords_gin
    ON public.product_search_materialized USING gin
    (style_keyword_slugs COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE INDEX idx_psm_style_status
    ON public.product_search_materialized USING btree
    (style_code COLLATE pg_catalog."default", sku_status COLLATE pg_catalog."default")
    TABLESPACE pg_default;
CREATE INDEX idx_psm_super_filter
    ON public.product_search_materialized USING btree
    (sku_status COLLATE pg_catalog."default", created_at DESC, gender_slug COLLATE pg_catalog."default", sell_price, style_code COLLATE pg_catalog."default")
    TABLESPACE pg_default
    WHERE sku_status::text = 'Live'::text;
CREATE UNIQUE INDEX idx_psm_unique
    ON public.product_search_materialized USING btree
    (id)
    TABLESPACE pg_default;
CREATE UNIQUE INDEX product_search_materialized_unique_idx
    ON public.product_search_materialized USING btree
    (id)
    TABLESPACE pg_default;


"id"	"style_code"	"colour_name"	"primary_colour"	"colour_shade"	"single_price"	"sell_price"	"sku_status"	"primary_image_url"	"created_at"	"style_name"	"brand"	"gender_slug"	"age_group_slug"	"size_slug"	"tag_slug"	"category_ids"	"fabric_ids"	"flag_ids"	"accreditation_ids"	"style_keywords"	"fabric_slugs"	"size_slugs"	"style_keyword_slugs"	"colour_slugs"	"neckline_slugs"	"sleeve_slugs"	"search_vector"
1	"TS004"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000006/TS004_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded bodywarmer"	"2786"	"male"	"adult"	"s"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{s}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'bodywarm':4 'hood':3 'recycl':2 'solitud':1 'tagless':9"
2	"TS004"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000006/TS004_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded bodywarmer"	"2786"	"male"	"adult"	"m"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{m}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'bodywarm':4 'hood':3 'm':8 'recycl':2 'solitud':1 'tagless':9"
3	"TS004"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000006/TS004_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded bodywarmer"	"2786"	"male"	"adult"	"l"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{l}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'bodywarm':4 'hood':3 'l':8 'recycl':2 'solitud':1 'tagless':9"
4	"TS004"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000006/TS004_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded bodywarmer"	"2786"	"male"	"adult"	"xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{xl}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'bodywarm':4 'hood':3 'recycl':2 'solitud':1 'tagless':9 'xl':8"
5	"TS004"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000006/TS004_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded bodywarmer"	"2786"	"male"	"adult"	"2xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{2xl}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 '2xl':8 'black':6,7 'bodywarm':4 'hood':3 'recycl':2 'solitud':1 'tagless':9"
6	"TS004"	"Black"	"Black"	"Black - Black"	23.25	37.00	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000006/TS004_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded bodywarmer"	"2786"	"male"	"adult"	"3xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{3xl}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 '3xl':8 'black':6,7 'bodywarm':4 'hood':3 'recycl':2 'solitud':1 'tagless':9"
7	"TS005"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a043100000e/TS005_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded jacket"	"2786"	"male"	"adult"	"s"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{s}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'hood':3 'jacket':4 'recycl':2 'solitud':1 'tagless':9"
8	"TS005"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a043100000e/TS005_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded jacket"	"2786"	"male"	"adult"	"m"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{m}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'hood':3 'jacket':4 'm':8 'recycl':2 'solitud':1 'tagless':9"
9	"TS005"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a043100000e/TS005_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded jacket"	"2786"	"male"	"adult"	"l"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{l}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'hood':3 'jacket':4 'l':8 'recycl':2 'solitud':1 'tagless':9"
10	"TS005"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a043100000e/TS005_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded jacket"	"2786"	"male"	"adult"	"xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{xl}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'hood':3 'jacket':4 'recycl':2 'solitud':1 'tagless':9 'xl':8"
11	"TS005"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a043100000e/TS005_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded jacket"	"2786"	"male"	"adult"	"2xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{2xl}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 '2xl':8 'black':6,7 'hood':3 'jacket':4 'recycl':2 'solitud':1 'tagless':9"
12	"TS005"	"Black"	"Black"	"Black - Black"	28.45	44.40	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a043100000e/TS005_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Solitude recycled hooded jacket"	"2786"	"male"	"adult"	"3xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{hooded,hooded-1}"	"{recycled-100}"	"{3xl}"	"{hooded,hooded-1}"	"{black}"	"{}"	"{}"	"'2786':5 '3xl':8 'black':6,7 'hood':3 'jacket':4 'recycl':2 'solitud':1 'tagless':9"
13	"TS006"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"s"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{s}"	"{lightweight}"	"{black}"	"{}"	"{}"	"'2786':6 'black':7,8 'jacket':5 'lightweight':4 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
14	"TS006"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"m"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{m}"	"{lightweight}"	"{black}"	"{}"	"{}"	"'2786':6 'black':7,8 'jacket':5 'lightweight':4 'm':9 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
15	"TS006"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"l"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{l}"	"{lightweight}"	"{black}"	"{}"	"{}"	"'2786':6 'black':7,8 'jacket':5 'l':9 'lightweight':4 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
16	"TS006"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"xl"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{xl}"	"{lightweight}"	"{black}"	"{}"	"{}"	"'2786':6 'black':7,8 'jacket':5 'lightweight':4 'recycl':1 'super':3 'super-lightweight':2 'tagless':10 'xl':9"
17	"TS006"	"Black"	"Black"	"Black - Black"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"2xl"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{2xl}"	"{lightweight}"	"{black}"	"{}"	"{}"	"'2786':6 '2xl':9 'black':7,8 'jacket':5 'lightweight':4 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
18	"TS006"	"Black"	"Black"	"Black - Black"	23.25	37.00	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"3xl"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{3xl}"	"{lightweight}"	"{black}"	"{}"	"{}"	"'2786':6 '3xl':9 'black':7,8 'jacket':5 'lightweight':4 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
19	"TS006"	"Navy"	"Blue"	"Blue - Navy"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"s"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{s}"	"{lightweight}"	"{navy}"	"{}"	"{}"	"'2786':6 'blue':8 'jacket':5 'lightweight':4 'navi':7 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
20	"TS006"	"Navy"	"Blue"	"Blue - Navy"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"m"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{m}"	"{lightweight}"	"{navy}"	"{}"	"{}"	"'2786':6 'blue':8 'jacket':5 'lightweight':4 'm':9 'navi':7 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
21	"TS006"	"Navy"	"Blue"	"Blue - Navy"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"l"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{l}"	"{lightweight}"	"{navy}"	"{}"	"{}"	"'2786':6 'blue':8 'jacket':5 'l':9 'lightweight':4 'navi':7 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
22	"TS006"	"Navy"	"Blue"	"Blue - Navy"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"xl"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{xl}"	"{lightweight}"	"{navy}"	"{}"	"{}"	"'2786':6 'blue':8 'jacket':5 'lightweight':4 'navi':7 'recycl':1 'super':3 'super-lightweight':2 'tagless':10 'xl':9"
23	"TS006"	"Navy"	"Blue"	"Blue - Navy"	22.25	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"2xl"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{2xl}"	"{lightweight}"	"{navy}"	"{}"	"{}"	"'2786':6 '2xl':9 'blue':8 'jacket':5 'lightweight':4 'navi':7 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
24	"TS006"	"Navy"	"Blue"	"Blue - Navy"	23.25	37.00	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000016/TS006_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled super-lightweight jacket"	"2786"	"male"	"adult"	"3xl"	"tagless"	{24,31,160,183,269}	{13}	{1,4,5}	{13,14}	"{lightweight}"	"{recycled-100}"	"{3xl}"	"{lightweight}"	"{navy}"	"{}"	"{}"	"'2786':6 '3xl':9 'blue':8 'jacket':5 'lightweight':4 'navi':7 'recycl':1 'super':3 'super-lightweight':2 'tagless':10"
25	"TS007"	"Black"	"Black"	"Black - Black"	30.45	52.13	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000021/TS007_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled TrailPeak padded jacket"	"2786"	"male"	"adult"	"s"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{padded}"	"{recycled-100}"	"{s}"	"{padded}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'jacket':4 'pad':3 'recycl':1 'tagless':9 'trailpeak':2"
26	"TS007"	"Black"	"Black"	"Black - Black"	30.45	52.13	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000021/TS007_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled TrailPeak padded jacket"	"2786"	"male"	"adult"	"m"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{padded}"	"{recycled-100}"	"{m}"	"{padded}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'jacket':4 'm':8 'pad':3 'recycl':1 'tagless':9 'trailpeak':2"
27	"TS007"	"Black"	"Black"	"Black - Black"	30.45	52.13	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000021/TS007_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled TrailPeak padded jacket"	"2786"	"male"	"adult"	"l"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{padded}"	"{recycled-100}"	"{l}"	"{padded}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'jacket':4 'l':8 'pad':3 'recycl':1 'tagless':9 'trailpeak':2"
28	"TS007"	"Black"	"Black"	"Black - Black"	30.45	52.13	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000021/TS007_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled TrailPeak padded jacket"	"2786"	"male"	"adult"	"xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{padded}"	"{recycled-100}"	"{xl}"	"{padded}"	"{black}"	"{}"	"{}"	"'2786':5 'black':6,7 'jacket':4 'pad':3 'recycl':1 'tagless':9 'trailpeak':2 'xl':8"
29	"TS007"	"Black"	"Black"	"Black - Black"	30.45	52.13	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000021/TS007_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled TrailPeak padded jacket"	"2786"	"male"	"adult"	"2xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{padded}"	"{recycled-100}"	"{2xl}"	"{padded}"	"{black}"	"{}"	"{}"	"'2786':5 '2xl':8 'black':6,7 'jacket':4 'pad':3 'recycl':1 'tagless':9 'trailpeak':2"
30	"TS007"	"Black"	"Black"	"Black - Black"	32.10	54.14	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000021/TS007_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled TrailPeak padded jacket"	"2786"	"male"	"adult"	"3xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{padded}"	"{recycled-100}"	"{3xl}"	"{padded}"	"{black}"	"{}"	"{}"	"'2786':5 '3xl':8 'black':6,7 'jacket':4 'pad':3 'recycl':1 'tagless':9 'trailpeak':2"
31	"TS008"	"Black"	"Black"	"Black - Black"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"s"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{s}"	"{longline,padded}"	"{black}"	"{}"	"{}"	"'2786':6 'black':7,8 'bond':2 'jacket':5 'longlin':3 'pad':4 'recycl':1 'tagless':10"
32	"TS008"	"Black"	"Black"	"Black - Black"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"m"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{m}"	"{longline,padded}"	"{black}"	"{}"	"{}"	"'2786':6 'black':7,8 'bond':2 'jacket':5 'longlin':3 'm':9 'pad':4 'recycl':1 'tagless':10"
33	"TS008"	"Black"	"Black"	"Black - Black"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"l"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{l}"	"{longline,padded}"	"{black}"	"{}"	"{}"	"'2786':6 'black':7,8 'bond':2 'jacket':5 'l':9 'longlin':3 'pad':4 'recycl':1 'tagless':10"
34	"TS008"	"Black"	"Black"	"Black - Black"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{xl}"	"{longline,padded}"	"{black}"	"{}"	"{}"	"'2786':6 'black':7,8 'bond':2 'jacket':5 'longlin':3 'pad':4 'recycl':1 'tagless':10 'xl':9"
35	"TS008"	"Black"	"Black"	"Black - Black"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"2xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{2xl}"	"{longline,padded}"	"{black}"	"{}"	"{}"	"'2786':6 '2xl':9 'black':7,8 'bond':2 'jacket':5 'longlin':3 'pad':4 'recycl':1 'tagless':10"
36	"EA001"	"Bottle Green"	"Green"	"Green - Bottle"	4.95	9.31	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/550e2d3f/6748416e15b286ee281f144d/EA001_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Cascade organic tee"	"AWDis Ecologie"	"male"	"adult"	"m"	"tagless"	{52,60,112,239,269,279}	{14}	{4,5}	{26,48}	"{NULL}"	"{organic-100}"	"{m}"		"{""bottle green""}"	"{}"	"{}"	"'awdi':4 'bottl':6 'cascad':1 'ecologi':5 'green':7,8 'm':9 'organ':2 'tagless':10 'tee':3"
37	"TS008"	"Black"	"Black"	"Black - Black"	38.80	67.75	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"3xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{3xl}"	"{longline,padded}"	"{black}"	"{}"	"{}"	"'2786':6 '3xl':9 'black':7,8 'bond':2 'jacket':5 'longlin':3 'pad':4 'recycl':1 'tagless':10"
38	"TS008"	"Navy"	"Blue"	"Blue - Navy"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"s"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{s}"	"{longline,padded}"	"{navy}"	"{}"	"{}"	"'2786':6 'blue':8 'bond':2 'jacket':5 'longlin':3 'navi':7 'pad':4 'recycl':1 'tagless':10"
39	"TS008"	"Navy"	"Blue"	"Blue - Navy"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"m"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{m}"	"{longline,padded}"	"{navy}"	"{}"	"{}"	"'2786':6 'blue':8 'bond':2 'jacket':5 'longlin':3 'm':9 'navi':7 'pad':4 'recycl':1 'tagless':10"
40	"TS008"	"Navy"	"Blue"	"Blue - Navy"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"l"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{l}"	"{longline,padded}"	"{navy}"	"{}"	"{}"	"'2786':6 'blue':8 'bond':2 'jacket':5 'l':9 'longlin':3 'navi':7 'pad':4 'recycl':1 'tagless':10"
41	"TS008"	"Navy"	"Blue"	"Blue - Navy"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{xl}"	"{longline,padded}"	"{navy}"	"{}"	"{}"	"'2786':6 'blue':8 'bond':2 'jacket':5 'longlin':3 'navi':7 'pad':4 'recycl':1 'tagless':10 'xl':9"
42	"TS008"	"Navy"	"Blue"	"Blue - Navy"	37.80	65.70	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"2xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{2xl}"	"{longline,padded}"	"{navy}"	"{}"	"{}"	"'2786':6 '2xl':9 'blue':8 'bond':2 'jacket':5 'longlin':3 'navi':7 'pad':4 'recycl':1 'tagless':10"
43	"TS008"	"Navy"	"Blue"	"Blue - Navy"	38.80	67.75	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/3f4f6263/687660b7ba355a0431000029/TS008_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Recycled bonded longline padded jacket"	"2786"	"male"	"adult"	"3xl"	"tagless"	{24,31,131,160,183,269}	{13}	{1,4,5}	{13,14}	"{longline,padded}"	"{recycled-100}"	"{3xl}"	"{longline,padded}"	"{navy}"	"{}"	"{}"	"'2786':6 '3xl':9 'blue':8 'bond':2 'jacket':5 'longlin':3 'navi':7 'pad':4 'recycl':1 'tagless':10"
44	"TS009"	"Black"	"Black"	"Black - Black"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"s"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{s}"	"{hooded}"	"{black}"	"{}"	"{}"	"'2':2 '2786':6 'black':7,8 'hood':1 'jacket':5 'layer':3 'softshel':4 'tagless':10"
45	"BG724"	"Charcoal Melange"	"Grey"	"Grey - Heather"	1.79	2.92	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/21e3221e/674840f215b286ee281f0a7b/BG724_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Felt accessory bag"	"Bagbase"	"unisex"	"adult"	"s"	"tear-out"	{58,200,282}	{15}	{4}	{13,27}	"{NULL}"	"{polyester-100}"	"{s}"		"{""charcoal melange""}"	"{}"	"{}"	"'accessori':2 'bag':3 'bagbas':4 'charcoal':5 'felt':1 'grey':7 'melang':6 'tear':10 'tear-out':9"
46	"TS009"	"Black"	"Black"	"Black - Black"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"m"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{m}"	"{hooded}"	"{black}"	"{}"	"{}"	"'2':2 '2786':6 'black':7,8 'hood':1 'jacket':5 'layer':3 'm':9 'softshel':4 'tagless':10"
47	"TS009"	"Black"	"Black"	"Black - Black"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"l"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{l}"	"{hooded}"	"{black}"	"{}"	"{}"	"'2':2 '2786':6 'black':7,8 'hood':1 'jacket':5 'l':9 'layer':3 'softshel':4 'tagless':10"
48	"TS009"	"Black"	"Black"	"Black - Black"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"xl"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{xl}"	"{hooded}"	"{black}"	"{}"	"{}"	"'2':2 '2786':6 'black':7,8 'hood':1 'jacket':5 'layer':3 'softshel':4 'tagless':10 'xl':9"
49	"TS009"	"Black"	"Black"	"Black - Black"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"2xl"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{2xl}"	"{hooded}"	"{black}"	"{}"	"{}"	"'2':2 '2786':6 '2xl':9 'black':7,8 'hood':1 'jacket':5 'layer':3 'softshel':4 'tagless':10"
50	"TS009"	"Black"	"Black"	"Black - Black"	22.60	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"3xl"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{3xl}"	"{hooded}"	"{black}"	"{}"	"{}"	"'2':2 '2786':6 '3xl':9 'black':7,8 'hood':1 'jacket':5 'layer':3 'softshel':4 'tagless':10"
51	"TS009"	"Navy"	"Blue"	"Blue - Navy"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"s"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{s}"	"{hooded}"	"{navy}"	"{}"	"{}"	"'2':2 '2786':6 'blue':8 'hood':1 'jacket':5 'layer':3 'navi':7 'softshel':4 'tagless':10"
52	"TS009"	"Navy"	"Blue"	"Blue - Navy"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"m"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{m}"	"{hooded}"	"{navy}"	"{}"	"{}"	"'2':2 '2786':6 'blue':8 'hood':1 'jacket':5 'layer':3 'm':9 'navi':7 'softshel':4 'tagless':10"
53	"ZA077"	"White"	"White"	"White - White"	6.95	16.19	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/8d89ef8a/67483f3d15b286ee281ee810/ZA077_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Multi purpose copy paper"	"Essentials"		"adult"	"a4"		{142,184}	{NULL}	{4}	{NULL}	"{NULL}"		"{a4}"		"{white}"	"{}"	"{}"	"'a4':8 'copi':3 'essenti':5 'multi':1 'paper':4 'purpos':2 'white':6,7"
54	"TS009"	"Navy"	"Blue"	"Blue - Navy"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"l"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{l}"	"{hooded}"	"{navy}"	"{}"	"{}"	"'2':2 '2786':6 'blue':8 'hood':1 'jacket':5 'l':9 'layer':3 'navi':7 'softshel':4 'tagless':10"
55	"TS009"	"Navy"	"Blue"	"Blue - Navy"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"xl"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{xl}"	"{hooded}"	"{navy}"	"{}"	"{}"	"'2':2 '2786':6 'blue':8 'hood':1 'jacket':5 'layer':3 'navi':7 'softshel':4 'tagless':10 'xl':9"
56	"TS009"	"Navy"	"Blue"	"Blue - Navy"	21.30	33.30	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"2xl"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{2xl}"	"{hooded}"	"{navy}"	"{}"	"{}"	"'2':2 '2786':6 '2xl':9 'blue':8 'hood':1 'jacket':5 'layer':3 'navi':7 'softshel':4 'tagless':10"
57	"TS009"	"Navy"	"Blue"	"Blue - Navy"	22.60	35.15	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/688aebf3/67483f9015b286ee281eee85/TS009_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Hooded 2-layer softshell jacket"	"2786"	"male"	"adult"	"3xl"	"tagless"	{34,160,183,201}	{15}	{4}	{13}	"{hooded}"	"{polyester-100}"	"{3xl}"	"{hooded}"	"{navy}"	"{}"	"{}"	"'2':2 '2786':6 '3xl':9 'blue':8 'hood':1 'jacket':5 'layer':3 'navi':7 'softshel':4 'tagless':10"
58	"TS012"	"Black"	"Black"	"Black - Black"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"s"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{s}"		"{black}"	"{}"	"{}"	"'2786':3 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'softshel':1"
59	"TS012"	"Black"	"Black"	"Black - Black"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"m"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{m}"		"{black}"	"{}"	"{}"	"'2786':3 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'm':6 'softshel':1"
60	"TS012"	"Navy"	"Blue"	"Blue - Navy"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"l"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{l}"		"{navy}"	"{}"	"{}"	"'2786':3 'away':9 'blue':5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'l':6 'label':11 'navi':4 'softshel':1"
61	"TS012"	"Black"	"Black"	"Black - Black"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"l"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{l}"		"{black}"	"{}"	"{}"	"'2786':3 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'l':6 'label':11 'softshel':1"
62	"TS012"	"Black"	"Black"	"Black - Black"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"xl"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{xl}"		"{black}"	"{}"	"{}"	"'2786':3 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'softshel':1 'xl':6"
63	"TS012"	"Black"	"Black"	"Black - Black"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"2xl"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{2xl}"		"{black}"	"{}"	"{}"	"'2786':3 '2xl':6 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'softshel':1"
64	"TS012"	"Black"	"Black"	"Black - Black"	23.15	37.00	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"3xl"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{3xl}"		"{black}"	"{}"	"{}"	"'2786':3 '3xl':6 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'softshel':1"
65	"TS012"	"Navy"	"Blue"	"Blue - Navy"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"s"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{s}"		"{navy}"	"{}"	"{}"	"'2786':3 'away':9 'blue':5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'navi':4 'softshel':1"
66	"TS012"	"Navy"	"Blue"	"Blue - Navy"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"m"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{m}"		"{navy}"	"{}"	"{}"	"'2786':3 'away':9 'blue':5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'm':6 'navi':4 'softshel':1"
67	"BG540"	"Classic Red"	"Red"	"Red - Classic Red"	4.50	8.21	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/d38e364e/674840e115b286ee281f0919/BG540_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Athleisure sports shoe/accessory bag"	"Bagbase"	"unisex"	"adult"	"one-size"	"tear-out"	{60,200,282}	{16}	{4}	{13,27}	"{NULL}"	"{polyester-blend}"	"{one-size}"		"{""classic red""}"	"{}"	"{}"	"'athleisur':1 'bag':4 'bagbas':5 'classic':6 'one':10 'one-s':9 'red':7,8 'shoe/accessory':3 'size':11 'sport':2 'tear':13 'tear-out':12"
68	"TS012"	"Navy"	"Blue"	"Blue - Navy"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"xl"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{xl}"		"{navy}"	"{}"	"{}"	"'2786':3 'away':9 'blue':5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'navi':4 'softshel':1 'xl':6"
69	"TS012"	"Navy"	"Blue"	"Blue - Navy"	21.75	34.23	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"2xl"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{2xl}"		"{navy}"	"{}"	"{}"	"'2786':3 '2xl':6 'away':9 'blue':5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'navi':4 'softshel':1"
70	"TS012"	"Navy"	"Blue"	"Blue - Navy"	23.15	37.00	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/f2c91539/67483f9015b286ee281eee82/TS012_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Softshell jacket"	"2786"	"male"	"adult"	"3xl"	"cut-away-inner-label"	{34,60,76,84,160,174,183,200,201,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{3xl}"		"{navy}"	"{}"	"{}"	"'2786':3 '3xl':6 'away':9 'blue':5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'navi':4 'softshel':1"
71	"TS013"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/d62a756f/67483f9015b286ee281eee7f/TS013_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Parka jacket"	"2786"	"unisex"	"adult"	"s"	"cut-away-inner-label"	{76,84,91,160,174,183,200,211,226,239}	{15}	{2,3,4}	{13}	"{NULL}"	"{polyester-100}"	"{s}"		"{black}"	"{}"	"{}"	"'2786':3 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'parka':1"
72	"TS013"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/d62a756f/67483f9015b286ee281eee7f/TS013_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Parka jacket"	"2786"	"unisex"	"adult"	"m"	"cut-away-inner-label"	{76,84,91,160,174,183,200,211,226,239}	{15}	{2,3,4}	{13}	"{NULL}"	"{polyester-100}"	"{m}"		"{black}"	"{}"	"{}"	"'2786':3 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'm':6 'parka':1"
73	"TS013"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/d62a756f/67483f9015b286ee281eee7f/TS013_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Parka jacket"	"2786"	"unisex"	"adult"	"l"	"cut-away-inner-label"	{76,84,91,160,174,183,200,211,226,239}	{15}	{2,3,4}	{13}	"{NULL}"	"{polyester-100}"	"{l}"		"{black}"	"{}"	"{}"	"'2786':3 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'l':6 'label':11 'parka':1"
74	"AC004"	"Royal Blue"	"Blue"	"Blue - Royal"	5.10	9.31	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/348e1aba/67483f4915b286ee281ee8fd/AC004_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Academy polo"	"AWDis Academy"	"unisex"	"adult"	"m"	"sewn-tag"	{52,198,258}	{NULL}	{3,4}	{4,26,46}	"{NULL}"		"{m}"		"{""royal blue""}"	"{}"	"{}"	"'academi':1,4 'awdi':3 'blue':6,7 'm':8 'polo':2 'royal':5 'sewn':10 'sewn-tag':9 'tag':11"
75	"TS013"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/d62a756f/67483f9015b286ee281eee7f/TS013_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Parka jacket"	"2786"	"unisex"	"adult"	"xl"	"cut-away-inner-label"	{76,84,91,160,174,183,200,211,226,239}	{15}	{2,3,4}	{13}	"{NULL}"	"{polyester-100}"	"{xl}"		"{black}"	"{}"	"{}"	"'2786':3 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'parka':1 'xl':6"
76	"TS013"	"Black"	"Black"	"Black - Black"	26.90	42.55	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/d62a756f/67483f9015b286ee281eee7f/TS013_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Parka jacket"	"2786"	"unisex"	"adult"	"2xl"	"cut-away-inner-label"	{76,84,91,160,174,183,200,211,226,239}	{15}	{2,3,4}	{13}	"{NULL}"	"{polyester-100}"	"{2xl}"		"{black}"	"{}"	"{}"	"'2786':3 '2xl':6 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'parka':1"
77	"TS013"	"Black"	"Black"	"Black - Black"	28.45	44.40	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/d62a756f/67483f9015b286ee281eee7f/TS013_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Parka jacket"	"2786"	"unisex"	"adult"	"3xl"	"cut-away-inner-label"	{76,84,91,160,174,183,200,211,226,239}	{15}	{2,3,4}	{13}	"{NULL}"	"{polyester-100}"	"{3xl}"		"{black}"	"{}"	"{}"	"'2786':3 '3xl':6 'away':9 'black':4,5 'cut':8 'cut-away-inner-label':7 'inner':10 'jacket':2 'label':11 'parka':1"
78	"TS014"	"Black"	"Black"	"Black - Black"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"xs"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{xs}"	"{fleece}"	"{black}"	"{}"	"{}"	"'2786':5 'away':11 'black':6,7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'xs':8 'zip':3"
79	"TS014"	"Black"	"Black"	"Black - Black"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"s"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{s}"	"{fleece}"	"{black}"	"{}"	"{}"	"'2786':5 'away':11 'black':6,7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'zip':3"
80	"TS014"	"Black"	"Black"	"Black - Black"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"m"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{m}"	"{fleece}"	"{black}"	"{}"	"{}"	"'2786':5 'away':11 'black':6,7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'm':8 'zip':3"
81	"TS014"	"Black"	"Black"	"Black - Black"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"l"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{l}"	"{fleece}"	"{black}"	"{}"	"{}"	"'2786':5 'away':11 'black':6,7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'l':8 'label':13 'zip':3"
82	"TS014"	"Black"	"Black"	"Black - Black"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{xl}"	"{fleece}"	"{black}"	"{}"	"{}"	"'2786':5 'away':11 'black':6,7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'xl':8 'zip':3"
83	"TS014"	"Black"	"Black"	"Black - Black"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"2xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{2xl}"	"{fleece}"	"{black}"	"{}"	"{}"	"'2786':5 '2xl':8 'away':11 'black':6,7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'zip':3"
84	"TS014"	"Black"	"Black"	"Black - Black"	12.45	23.72	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"3xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{3xl}"	"{fleece}"	"{black}"	"{}"	"{}"	"'2786':5 '3xl':8 'away':11 'black':6,7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'zip':3"
85	"TS014"	"Charcoal"	"Grey"	"Grey - Charcoal"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"xs"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{xs}"	"{fleece}"	"{charcoal}"	"{}"	"{}"	"'2786':5 'away':11 'charcoal':6 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'grey':7 'inner':12 'label':13 'xs':8 'zip':3"
86	"TS014"	"Charcoal"	"Grey"	"Grey - Charcoal"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"s"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{s}"	"{fleece}"	"{charcoal}"	"{}"	"{}"	"'2786':5 'away':11 'charcoal':6 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'grey':7 'inner':12 'label':13 'zip':3"
87	"TS014"	"Charcoal"	"Grey"	"Grey - Charcoal"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"m"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{m}"	"{fleece}"	"{charcoal}"	"{}"	"{}"	"'2786':5 'away':11 'charcoal':6 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'grey':7 'inner':12 'label':13 'm':8 'zip':3"
88	"TS014"	"Charcoal"	"Grey"	"Grey - Charcoal"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"l"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{l}"	"{fleece}"	"{charcoal}"	"{}"	"{}"	"'2786':5 'away':11 'charcoal':6 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'grey':7 'inner':12 'l':8 'label':13 'zip':3"
89	"TS014"	"Charcoal"	"Grey"	"Grey - Charcoal"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{xl}"	"{fleece}"	"{charcoal}"	"{}"	"{}"	"'2786':5 'away':11 'charcoal':6 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'grey':7 'inner':12 'label':13 'xl':8 'zip':3"
90	"TS014"	"Charcoal"	"Grey"	"Grey - Charcoal"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"2xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{2xl}"	"{fleece}"	"{charcoal}"	"{}"	"{}"	"'2786':5 '2xl':8 'away':11 'charcoal':6 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'grey':7 'inner':12 'label':13 'zip':3"
91	"TS014"	"Charcoal"	"Grey"	"Grey - Charcoal"	12.45	23.72	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"3xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{3xl}"	"{fleece}"	"{charcoal}"	"{}"	"{}"	"'2786':5 '3xl':8 'away':11 'charcoal':6 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'grey':7 'inner':12 'label':13 'zip':3"
92	"TS014"	"Navy"	"Blue"	"Blue - Navy"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"xs"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{xs}"	"{fleece}"	"{navy}"	"{}"	"{}"	"'2786':5 'away':11 'blue':7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'navi':6 'xs':8 'zip':3"
93	"TS014"	"Navy"	"Blue"	"Blue - Navy"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"s"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{s}"	"{fleece}"	"{navy}"	"{}"	"{}"	"'2786':5 'away':11 'blue':7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'navi':6 'zip':3"
94	"TS014"	"Navy"	"Blue"	"Blue - Navy"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"m"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{m}"	"{fleece}"	"{navy}"	"{}"	"{}"	"'2786':5 'away':11 'blue':7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'm':8 'navi':6 'zip':3"
95	"TS014"	"Navy"	"Blue"	"Blue - Navy"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"l"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{l}"	"{fleece}"	"{navy}"	"{}"	"{}"	"'2786':5 'away':11 'blue':7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'l':8 'label':13 'navi':6 'zip':3"
96	"TS014"	"Navy"	"Blue"	"Blue - Navy"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{xl}"	"{fleece}"	"{navy}"	"{}"	"{}"	"'2786':5 'away':11 'blue':7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'navi':6 'xl':8 'zip':3"
97	"TS014"	"Navy"	"Blue"	"Blue - Navy"	11.55	23.18	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"2xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{2xl}"	"{fleece}"	"{navy}"	"{}"	"{}"	"'2786':5 '2xl':8 'away':11 'blue':7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'navi':6 'zip':3"
98	"TS014"	"Navy"	"Blue"	"Blue - Navy"	12.45	23.72	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/db4455d7/67483f9015b286ee281eee7c/TS014_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Full-zip fleece"	"2786"	"male"	"adult"	"3xl"	"cut-away-inner-label"	{34,60,76,84,127,129,143,160,174,183,200,226,239,250}	{15}	{2,3,4}	{13}	"{fleece}"	"{polyester-100}"	"{3xl}"	"{fleece}"	"{navy}"	"{}"	"{}"	"'2786':5 '3xl':8 'away':11 'blue':7 'cut':10 'cut-away-inner-label':9 'fleec':4 'full':2 'full-zip':1 'inner':12 'label':13 'navi':6 'zip':3"
99	"TS015"	"Black"	"Black"	"Black - Black"	17.15	32.92	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/15ed0571/67483f8f15b286ee281eee79/TS015_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Bodywarmer"	"2786"	"male"	"adult"	"s"	"cut-away-inner-label"	{18,50,60,84,99,107,110,160,174,183,200,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{s}"		"{black}"	"{}"	"{}"	"'2786':2 'away':8 'black':3,4 'bodywarm':1 'cut':7 'cut-away-inner-label':6 'inner':9 'label':10"
100	"TS015"	"Black"	"Black"	"Black - Black"	17.15	32.92	"Live"	"https://cdn.pimber.ly/public/asset/raw/571f95845f13380f0056d06a/15ed0571/67483f8f15b286ee281eee79/TS015_LS00_2025.jpg"	"2025-12-15 12:53:56.984"	"Bodywarmer"	"2786"	"male"	"adult"	"m"	"cut-away-inner-label"	{18,50,60,84,99,107,110,160,174,183,200,239}	{15}	{4}	{13}	"{NULL}"	"{polyester-100}"	"{m}"		"{black}"	"{}"	"{}"	"'2786':2 'away':8 'black':3,4 'bodywarm':1 'cut':7 'cut-away-inner-label':6 'inner':9 'label':10 'm':5"


-- View: public.product_search_mv

-- DROP MATERIALIZED VIEW IF EXISTS public.product_search_mv;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_search_mv
TABLESPACE pg_default
AS
 SELECT p.id,
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
    array_agg(DISTINCT cat.id) AS category_ids,
    array_agg(DISTINCT f.id) AS fabric_ids,
    array_agg(DISTINCT sf.id) AS flag_ids,
    array_agg(DISTINCT acc.id) AS accreditation_ids,
    array_agg(DISTINCT sk.slug) AS style_keywords,
    array_agg(DISTINCT f.slug) FILTER (WHERE f.slug IS NOT NULL) AS fabric_slugs,
    array_agg(DISTINCT sz.slug) FILTER (WHERE sz.slug IS NOT NULL) AS size_slugs,
    array_agg(DISTINCT sk.slug) FILTER (WHERE sk.slug IS NOT NULL) AS style_keyword_slugs,
    array_agg(DISTINCT lower(COALESCE(p.colour_name, p.primary_colour)::text)) FILTER (WHERE p.colour_name IS NOT NULL OR p.primary_colour IS NOT NULL) AS colour_slugs,
    ARRAY[]::text[] AS neckline_slugs,
    ARRAY[]::text[] AS sleeve_slugs,
    to_tsvector('english'::regconfig, (((((((((COALESCE(s.style_name, ''::character varying)::text || ' '::text) || COALESCE(b.name, ''::character varying)::text) || ' '::text) || COALESCE(p.colour_name, ''::character varying)::text) || ' '::text) || COALESCE(p.primary_colour, ''::character varying)::text) || ' '::text) || COALESCE(sz.slug, ''::character varying)::text) || ' '::text) || COALESCE(t.slug, ''::character varying)::text) AS search_vector
   FROM products p
     JOIN styles s ON p.style_code::text = s.style_code::text
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
     LEFT JOIN style_keywords_mapping skm ON s.style_code::text = skm.style_code::text
     LEFT JOIN style_keywords sk ON skm.keyword_id = sk.id
  WHERE p.sku_status::text = 'Live'::text
  GROUP BY p.id, s.style_code, s.style_name, b.name, g.slug, ag.slug, sz.slug, t.slug
WITH DATA;

ALTER TABLE IF EXISTS public.product_search_mv
    OWNER TO brandeduk;

SELECT * FROM public.style_keywords



"id"	"name"	"slug"	"keyword_type"	"created_at"
8	"slim"	"slim"		"2025-12-15 18:08:11.306"
9	"long sleeve"	"long-sleeve"		"2025-12-15 18:08:11.306"
11	"Classic"	"classic"		"2025-12-15 18:08:11.306"
12	"Short sleeve"	"short-sleeve"		"2025-12-15 18:08:11.306"
13	"fitted"	"fitted"		"2025-12-15 18:08:11.306"
14	"short sleeve"	"short-sleeve-1"		"2025-12-15 18:08:11.306"
15	"Slim"	"slim-1"		"2025-12-15 18:08:11.306"
16	"classic"	"classic-1"		"2025-12-15 18:08:11.306"
17	"V-neck"	"v-neck"		"2025-12-15 18:08:11.306"
18	"crew neck"	"crew-neck"		"2025-12-15 18:08:11.306"
19	"oversized"	"oversized"		"2025-12-15 18:08:11.306"
20	"pocket"	"pocket"		"2025-12-15 18:08:11.306"
21	"v-neck"	"v-neck-1"		"2025-12-15 18:08:11.306"
22	"zipped"	"zipped"		"2025-12-15 18:08:11.306"
23	"Regular"	"regular"		"2025-12-15 18:08:11.306"
25	"Long sleeve"	"long-sleeve-1"		"2025-12-15 18:08:11.306"
26	"hooded"	"hooded-1"		"2025-12-15 18:08:11.306"
27	"regular"	"regular-1"		"2025-12-15 18:08:11.306"
28	"Crew neck"	"crew-neck-1"		"2025-12-15 18:08:11.306"
31	"relaxed"	"relaxed"		"2025-12-15 18:08:11.306"
32	"Relaxed"	"relaxed-1"		"2025-12-15 18:08:11.306"
33	"pockets"	"pockets"		"2025-12-15 18:08:11.306"
66	"Long Sleeve"	"long-sleeve-2"	"sleeve"	"2025-12-15 19:54:44.972"
67	"Padded"	"padded"	"feature"	"2025-12-15 19:54:44.972"
10	"Hooded"	"hooded"	"feature"	"2025-12-15 18:08:11.306"
68	"Cropped"	"cropped"	"fit"	"2025-12-15 19:54:45.855"
69	"Elasticated"	"elasticated"	"feature"	"2025-12-15 19:54:45.855"
70	"Stretch"	"stretch"	"fit"	"2025-12-15 19:54:45.855"
30	"Short Sleeve"	"short-sleeve-2"	"sleeve"	"2025-12-15 18:08:11.306"
71	"Fitted"	"fitted-1"	"fit"	"2025-12-15 19:54:45.88"
72	"Microfleece"	"microfleece"	"feature"	"2025-12-15 19:54:45.88"
73	"Slim Fit"	"slim-fit"	"fit"	"2025-12-15 19:54:45.88"
74	"Non-Iron"	"non-iron"	"feature"	"2025-12-15 19:54:45.88"
75	"Classic Fit"	"classic-fit"	"fit"	"2025-12-15 19:54:45.88"
76	"Waterproof"	"waterproof"	"feature"	"2025-12-15 19:54:45.88"
77	"Fleece"	"fleece"	"feature"	"2025-12-15 19:54:45.88"
78	"Lightweight"	"lightweight"	"feature"	"2025-12-15 19:54:45.88"
79	"V-Neck"	"v-neck-2"	"neckline"	"2025-12-15 19:54:45.88"
34	"Crew Neck"	"crew-neck-2"	"neckline"	"2025-12-15 18:08:11.306"
24	"Oversized"	"oversized-1"	"fit"	"2025-12-15 18:08:11.306"
35	"Pocket"	"pocket-1"	"feature"	"2025-12-15 18:08:11.306"
29	"Zipped"	"zipped-1"	"feature"	"2025-12-15 18:08:11.306"
80	"Sleeveless"	"sleeveless"	"sleeve"	"2025-12-15 19:54:45.983"
81	"Adjustable"	"adjustable"	"feature"	"2025-12-15 19:54:45.983"
82	"Heavyweight"	"heavyweight"	"feature"	"2025-12-15 19:54:45.983"
83	"Thinsulate"	"thinsulate"	"feature"	"2025-12-15 19:54:45.983"
84	"Contrast"	"contrast"	"feature"	"2025-12-15 19:54:45.983"
85	"Water-Repellent"	"water-repellent"	"feature"	"2025-12-15 19:54:45.983"
86	"Easycare"	"easycare"	"feature"	"2025-12-15 19:54:45.983"
87	"Panelled"	"panelled"	"feature"	"2025-12-15 19:54:45.983"
88	"Ringspun"	"ringspun"	"feature"	"2025-12-15 19:54:45.983"
89	"Longline"	"longline"	"fit"	"2025-12-15 19:54:45.983"
90	"Quilted"	"quilted"	"feature"	"2025-12-15 19:54:45.983"
91	"Mesh"	"mesh"	"feature"	"2025-12-15 19:54:45.983"
92	"Crop"	"crop"	"fit"	"2025-12-15 19:54:45.983"
93	"Reflective"	"reflective"	"feature"	"2025-12-15 19:54:45.983"
94	"Triblend"	"triblend"	"feature"	"2025-12-15 19:54:45.983"
95	"Packable"	"packable"	"feature"	"2025-12-15 19:54:45.983"
96	"Flat Visor"	"flat-visor"	"feature"	"2025-12-15 19:54:45.983"
97	"Ribbed"	"ribbed"	"feature"	"2025-12-15 19:54:45.983"
98	"Reversible"	"reversible"	"feature"	"2025-12-15 19:54:45.983"
99	"Midweight"	"midweight"	"feature"	"2025-12-15 19:54:45.983"
100	"Sandwich Peak"	"sandwich-peak"	"feature"	"2025-12-15 19:54:45.983"
101	"Raglan Sleeve"	"raglan-sleeve"	"sleeve"	"2025-12-15 19:54:45.983"
102	"Mandarin"	"mandarin"	"neckline"	"2025-12-15 19:54:45.983"
103	"Tailored Fit"	"tailored-fit"	"fit"	"2025-12-15 19:54:45.983"
104	"Washed"	"washed"	"feature"	"2025-12-15 19:54:45.983"
105	"Fashion Fit"	"fashion-fit"	"fit"	"2025-12-15 19:54:45.983"
106	"High Visibility"	"high-visibility"	"feature"	"2025-12-15 19:54:45.983"
107	"Wide Neck"	"wide-neck"	"neckline"	"2025-12-15 19:54:45.983"
108	"Shaped"	"shaped"	"fit"	"2025-12-15 19:54:45.983"
109	"Roll Neck"	"roll-neck"	"neckline"	"2025-12-15 19:54:45.983"
110	"Button-Down Collar"	"button-down-collar"	"neckline"	"2025-12-15 19:54:45.983"
111	"Wide Leg"	"wide-leg"	"fit"	"2025-12-15 19:54:45.983"
112	"Drawcord"	"drawcord"	"feature"	"2025-12-15 19:54:45.983"
113	"Relaxed Fit"	"relaxed-fit"	"fit"	"2025-12-15 19:54:45.983"
114	"Breathable"	"breathable"	"feature"	"2025-12-15 19:54:45.983"
115	"Pockets"	"pockets-1"	"feature"	"2025-12-15 19:54:45.983"
116	"Comfort"	"comfort"	"fit"	"2025-12-15 19:54:45.983"
117	"Set-In Sleeve"	"set-in-sleeve"	"sleeve"	"2025-12-15 19:54:45.983"
118	"Curved Hem"	"curved-hem"	"feature"	"2025-12-15 19:54:45.983"
119	"Roll-Sleeve"	"roll-sleeve"	"sleeve"	"2025-12-15 19:54:45.983"
120	"Keyhole"	"keyhole"	"neckline"	"2025-12-15 19:54:45.983"    


SELECT * FROM public.accreditations
ORDER BY id ASC LIMIT 100



"id"	"name"	"slug"	"description"	"created_at"
1	"Vegan Tested"	"vegan-tested"		"2025-12-15 17:54:28.158"
2	"Oeko-Tex"	"oeko-tex"		"2025-12-15 17:54:28.158"
3	"Global Compact"	"global-compact"		"2025-12-15 17:54:28.158"
4	"SEDEX"	"sedex"		"2025-12-15 17:54:28.158"
5	"UN Global Compact"	"un-global-compact"		"2025-12-15 17:54:28.158"
6	"Polylana®"	"polylana"		"2025-12-15 17:54:28.158"
7	"OCS Blended (Licence)"	"ocs-blended-licence"		"2025-12-15 17:54:28.158"
8	"OCS 100 (Licence)"	"ocs-100-licence"		"2025-12-15 17:54:28.158"
9	"Oeko-Tex STeP"	"oeko-tex-step"		"2025-12-15 17:54:28.158"
10	"RCS Blended (Licence)"	"rcs-blended-licence"		"2025-12-15 17:54:28.158"
11	"Global Recycled Standard"	"global-recycled-standard"		"2025-12-15 17:54:28.158"
12	"SA8000"	"sa8000"		"2025-12-15 17:54:28.158"
13	"Amfori BSCI"	"amfori-bsci"		"2025-12-15 17:54:28.158"
14	"Recycled"	"recycled"		"2025-12-15 17:54:28.158"
15	"Oeko-Tex Garment (Licence)"	"oeko-tex-garment-licence"		"2025-12-15 17:54:28.158"
16	"Ethical Trading Initiative"	"ethical-trading-initiative"		"2025-12-15 17:54:28.158"
17	"Oeko-Tex Home Recycled (Licence)"	"oeko-tex-home-recycled-licence"		"2025-12-15 17:54:28.158"
18	"B Corp"	"b-corp"		"2025-12-15 17:54:28.158"
19	"Ethical Trading Initiative (ETI)"	"ethical-trading-initiative-eti"		"2025-12-15 17:54:28.158"
20	"Organic 1 Content Standard"	"organic-1-content-standard"		"2025-12-15 17:54:28.158"
21	"Better Cotton"	"better-cotton"		"2025-12-15 17:54:28.158"
22	"Oeko-Tex Garment Recycled (Licence)"	"oeko-tex-garment-recycled-licence"		"2025-12-15 17:54:28.158"
23	"USCTP"	"usctp"		"2025-12-15 17:54:28.158"
24	"Reach"	"reach"		"2025-12-15 17:54:28.158"
25	"Fair Labour Association"	"fair-labour-association"		"2025-12-15 17:54:28.158"
26	"Peta Approved Vegan"	"peta-approved-vegan"		"2025-12-15 17:54:28.158"
27	"REACH"	"reach-1"		"2025-12-15 17:54:28.158"
28	"RSC Accord"	"rsc-accord"		"2025-12-15 17:54:28.158"
29	"Sustainable Apparel Coalition"	"sustainable-apparel-coalition"		"2025-12-15 17:54:28.158"
30	"BCI (Better cotton initiative)"	"bci-better-cotton-initiative"		"2025-12-15 17:54:28.158"
31	"GOTS (Licence)"	"gots-licence"		"2025-12-15 17:54:28.158"
32	"Fairtrade "	"fairtrade-"		"2025-12-15 17:54:28.158"
33	"Fair Labour Association (FLA) "	"fair-labour-association-fla-"		"2025-12-15 17:54:28.158"
34	"Organic"	"organic"		"2025-12-15 17:54:28.158"
35	"Organic Content Blended Standard"	"organic-content-blended-standard"		"2025-12-15 17:54:28.158"
36	"FAMA"	"fama"		"2025-12-15 17:54:28.158"
37	"Fair Labour Association (FLA)"	"fair-labour-association-fla"		"2025-12-15 17:54:28.158"
38	"Organic 100 Content Standard"	"organic-100-content-standard"		"2025-12-15 17:54:28.158"
39	"Sedex"	"sedex-1"		"2025-12-15 17:54:28.158"
40	"Oeko-Tex Home (Licence)"	"oeko-tex-home-licence"		"2025-12-15 17:54:28.158"
41	"GRS (Licence)"	"grs-licence"		"2025-12-15 17:54:28.158"
42	"Certified Recycled"	"certified-recycled"		"2025-12-15 17:54:28.158"
43	"Fair Wear Foundation"	"fair-wear-foundation"		"2025-12-15 17:54:28.158"
44	"Certified Down"	"certified-down"		"2025-12-15 17:54:28.158"
45	"Oeko-Tex Standard 100"	"oeko-tex-standard-100"		"2025-12-15 17:54:28.158"
46	"WRAP"	"wrap"		"2025-12-15 17:54:28.158"
47	"Bluesign®"	"bluesign"		"2025-12-15 17:54:28.158"
48	"Certified Organic"	"certified-organic"		"2025-12-15 17:54:28.158"

SELECT * FROM public.effects
ORDER BY id ASC 

"id"	"name"	"slug"	"description"	"created_at"
1	"Melange"	"melange"		"2025-12-15 18:01:59.999"
2	"Heather"	"heather"		"2025-12-15 18:01:59.999"
3	"Marble"	"marble"		"2025-12-15 18:01:59.999"
4	"Tie-Dye"	"tie-dye"		"2025-12-15 18:01:59.999"
5	"TriBlend"	"triblend"		"2025-12-15 18:01:59.999"
6	"Washed"	"washed"		"2025-12-15 18:01:59.999"
7	"Acid Wash"	"acid-wash"		"2025-12-15 18:01:59.999"

SELECT * FROM public.related_sectors

"id"	"name"	"slug"	"created_at"
1	"Sport"	"sport"	"2025-12-15 19:54:50.154"
2	"Corporate"	"corporate"	"2025-12-15 19:54:50.154"
3	"Hospitality"	"hospitality"	"2025-12-15 19:54:50.154"
4	"Travel"	"travel"	"2025-12-15 19:54:50.154"
5	"Fashion"	"fashion"	"2025-12-15 19:54:50.154"
6	"Athleisure"	"athleisure"	"2025-12-15 19:54:50.154"
7	"Home"	"home"	"2025-12-15 19:54:50.154"
8	"Safety"	"safety"	"2025-12-15 19:54:50.154"
9	"School"	"school"	"2025-12-15 19:54:50.154"
10	"Outdoor"	"outdoor"	"2025-12-15 19:54:50.154"

SELECT * FROM public.related_sports

"id"	"name"	"slug"	"created_at"
1	"Golf"	"golf"	"2025-12-15 19:54:50.154"
2	"Gym"	"gym"	"2025-12-15 19:54:50.154"
3	"Swimming"	"swimming"	"2025-12-15 19:54:50.154"
4	"Rugby"	"rugby"	"2025-12-15 19:54:50.154"

SELECT * FROM public.weight_ranges
ORDER BY id ASC 

"id"	"name"	"slug"	"min_gsm"	"max_gsm"	"created_at"
1	"0 - 50gsm"	"0-50gsm"	0	50	"2025-12-15 19:56:53.086"
2	"051 - 100gsm"	"051-100gsm"	51	100	"2025-12-15 19:56:53.086"
3	"101 - 150gsm"	"101-150gsm"	101	150	"2025-12-15 19:56:53.086"
4	"151 - 200gsm"	"151-200gsm"	151	200	"2025-12-15 19:56:53.086"
5	"201 - 250gsm"	"201-250gsm"	201	250	"2025-12-15 19:56:53.086"
6	"251 - 300gsm"	"251-300gsm"	251	300	"2025-12-15 19:56:53.086"
7	"Over 300gsm"	"over-300gsm"	301		"2025-12-15 19:56:53.086"

# Comprehensive Database Analysis Report
**Generated:** 2025-12-20  
**Database:** brandeduk

---

## Executive Summary

Your database contains **99,731 products** (SKUs) organized across **31 tables** with a well-normalized structure. The database follows a **Style → Product (SKU)** hierarchy where:
- **4,329 unique styles** (product designs)
- Each style can have multiple **products/SKUs** (different colors, sizes)
- Average: ~23 products per style

---

## Database Structure Overview

### Core Tables (Main Entities)

#### 1. **styles** (4,329 rows)
**Purpose:** Product designs/templates - one style can have many SKUs

**Key Columns:**
- `style_code` (PK) - Unique identifier (e.g., "JH001", "TS004")
- `style_name` - Product name (e.g., "Solitude recycled hooded bodywarmer")
- `brand_id` → brands
- `product_type_id` → product_types
- `gender_id` → genders
- `age_group_id` → age_groups
- `fabric_description` - Text description
- `specification` - Detailed product specs

**Data Insights:**
- 4,329 unique styles
- 4,295 unique style names (some duplicates)
- 1,708 unique fabric descriptions
- 4,051 unique specifications

**Search Relevance:** HIGH - Style names are primary search targets

---

#### 2. **products** (99,731 rows) ⭐ MAIN TABLE
**Purpose:** Individual SKUs - specific variants (Style + Color + Size)

**Key Columns:**
- `id` (PK)
- `style_code` → styles
- `sku_code` - Unique SKU identifier
- `colour_name` - Specific color name (2,652 unique values)
- `primary_colour` - Main color category (14 unique: Black, Blue, Brown, Green, Grey, Navy, Orange, Pink, Purple, Red, White, Yellow, etc.)
- `colour_shade` - Color variation (66 unique)
- `colour_id` → colours
- `size_id` → sizes
- `tag_id` → tags
- `sku_status` - "Live" or "Discontinued"
- `single_price`, `pack_price`, `carton_price`
- `primary_image_url` - Main product image (4,034 unique)
- `colour_image_url` - Color-specific image (19,967 unique)
- `stock_quantity`

**Data Insights:**
- 99,731 total products
- 2,652 unique color names (many variations like "*Black", "Academy Black", "Jet Black*")
- Only 14 primary colors (this is why color filter should use basic colors!)
- 4,034 unique primary images
- 19,967 unique color images

**Search Relevance:** CRITICAL - This is the main searchable table

---

### Reference Tables (Lookup Data)

#### 3. **brands** (91 rows)
**Purpose:** Product brands/manufacturers

**Sample Values:** 2786, adidas®, Anthem, Asquith & Fox, AWDis, B&C Collection, etc.

**Search Relevance:** HIGH - Users search by brand name

---

#### 4. **product_types** (110 rows)
**Purpose:** Product categories (T-Shirts, Hoodies, Jackets, etc.)

**Sample Values:** Accessories, Aprons, Arm Guards, Bags, Beanies, Caps, Chinos, Dresses, Fleece, Gilets & Body Warmers, Hoodies, Jackets, Jeans, Leggings, Polos, Shirts, Shorts, Softshells, Sweatshirts, Sweatpants, T-Shirts, Trousers, Vests, etc.

**Search Relevance:** VERY HIGH - Primary filter category

---

#### 5. **categories** (282 rows)
**Purpose:** Marketing/collection categories (can be hierarchical)

**Sample Values:** 
- "On-Trend Activewear"
- "Edge - Travel - Essentials"
- "Summer Softshells"
- "15% Off Adidas Raladeal"
- "Accessories"
- "Activewear & Performance"
- "Alfresco Dining"
- "Aprons & Service"

**Data Insights:**
- 282 unique categories
- Can have parent categories (hierarchical)
- Some are brand-specific collections (e.g., "Edge - Travel - Essentials")
- Some are promotional (e.g., "15% Off Adidas Raladeal")

**Search Relevance:** HIGH - Users may search for collection names

---

#### 6. **colours** (2,652 rows) ⚠️
**Purpose:** All color variations

**Key Issue:** Too many specific colors (2,652) - should map to basic colors for filtering

**Sample Values:**
- "*Black", "*Navy", "*Oxford Grey"
- "Academy Black", "Academy Burgundy"
- "All Black", "Anthracite"
- "Antique Cherry Red", "Antique Sapphire"
- "Arctic White", "Ash", "Ash Grey"
- etc.

**Data Insights:**
- 2,652 unique color names
- Many variations of same color (e.g., "Black", "*Black", "All Black", "Jet Black*")
- Only 14 `primary_colour` values in products table
- **Recommendation:** Use `primary_colour` for filtering, not `colour_name`

**Search Relevance:** MEDIUM - Color search should use primary_colour

---

#### 7. **sizes** (328 rows)
**Purpose:** All size variations

**Sample Values:** 
- Age-based: "0/3 Months", "0/6 Months", "1/2 Years"
- Standard: "S", "M", "L", "XL", "XXL"
- Numeric: "10", "12", "14", "16"
- Long/Short: "10 Long", "10 Reg", "10 Short"
- Chest/Waist: Various measurements

**Data Insights:**
- 328 unique sizes
- Multiple size types (Standard, UK, EU, Age-based, Chest, Waist)

**Search Relevance:** LOW - Usually filtered, not searched

---

### Many-to-Many Relationship Tables

#### 8. **product_categories** (853,928 rows) ⚠️ LARGE
**Purpose:** Links products to categories (many-to-many)

**Data Insights:**
- 853,928 relationships
- Average ~8.5 categories per product
- **This is why category search is important!**

**Search Relevance:** HIGH - Products belong to multiple categories

---

#### 9. **product_accreditations** (313,333 rows) ⚠️ LARGE
**Purpose:** Links products to certifications (many-to-many)

**Sample Accreditations:** Vegan Tested, Oeko-Tex, Global Compact, SEDEX, Amfori BSCI, B Corp, BCI, Better Cotton, Bluesign®, Certified Down, Certified Organic, Certified Recycled, etc.

**Data Insights:**
- 313,333 relationships
- Average ~3.1 accreditations per product
- 48 unique accreditations

**Search Relevance:** MEDIUM - Users may search for certifications

---

#### 10. **product_fabrics** (56,530 rows)
**Purpose:** Links products to fabric types (many-to-many)

**Sample Fabrics:** Recycled (100%), Organic (100%), Polyester (100%), Cotton (100%), Blend, Acrylic (100%), Airlume (100%), etc.

**Data Insights:**
- 56,530 relationships
- 82 unique fabric types
- Average ~0.57 fabrics per product

**Search Relevance:** MEDIUM - Users may search for fabric types

---

#### 11. **product_flags** (220,585 rows) ⚠️ LARGE
**Purpose:** Links products to special flags (many-to-many)

**Flags:** New In, RalaDeal, Offers, In Stock, Recycled / Organic

**Data Insights:**
- 220,585 relationships
- Average ~2.2 flags per product
- 5 unique flags

**Search Relevance:** MEDIUM - Used for filtering special offers

---

#### 12. **product_effects** (6,917 rows)
**Purpose:** Links products to visual effects (many-to-many)

**Effects:** Melange, Heather, Marble, Acid Wash, Tie-Dye, etc.

**Data Insights:**
- 6,917 relationships
- 7 unique effects

**Search Relevance:** LOW - Usually filtered, not searched

---

#### 13. **product_sectors** (115,619 rows) ⚠️ LARGE
**Purpose:** Links products to industry sectors (many-to-many)

**Sectors:** Sport, Corporate, Hospitality, Athleisure, Fashion, Home, etc.

**Data Insights:**
- 115,619 relationships
- 10 unique sectors
- Average ~1.2 sectors per product

**Search Relevance:** MEDIUM - Users may search by industry

---

#### 14. **product_sports** (2,231 rows)
**Purpose:** Links products to sports (many-to-many)

**Sports:** Golf, Gym, Rugby, Swimming

**Data Insights:**
- 2,231 relationships
- 4 unique sports
- Only ~2% of products have sports

**Search Relevance:** LOW - Niche use case

---

#### 15. **style_keywords** (83 rows)
**Purpose:** Style features/attributes (V-Neck, Long Sleeve, Pocket, etc.)

**Sample Keywords:** Adjustable, Breathable, Button-Down Collar, Classic, Long Sleeve, Slim, V-Neck, etc.

**Data Insights:**
- 83 unique keywords
- 2,146 style-keyword mappings
- Average ~0.5 keywords per style
- Keyword types: feature, fit, neckline, sleeve

**Search Relevance:** MEDIUM - Users may search for features

---

### Other Reference Tables

#### 16. **genders** (3 rows)
Values: Female, Male, Unisex

#### 17. **age_groups** (3 rows)
Values: Adult, Infant, Kids

#### 18. **tags** (6 rows)
Values: Adhesives, Cut-away inner label, Sewn Tag, Tagless, Tear-away

#### 19. **effects** (7 rows)
Values: Acid Wash, Heather, Marble, Melange, Tie-Dye

#### 20. **special_flags** (5 rows)
Values: In Stock, New In, Offers, RalaDeal, Recycled / Organic

#### 21. **fabrics** (82 rows)
Fabric types with percentages

#### 22. **accreditations** (48 rows)
Certifications and standards

#### 23. **related_sectors** (10 rows)
Industry sectors

#### 24. **related_sports** (4 rows)
Sports categories

#### 25. **weight_ranges** (7 rows)
GSM weight ranges (0-50gsm, 51-100gsm, etc.)

#### 26. **button_counts** (4 rows)
Button count options (1 Button, 2 Buttons, 3+ Buttons)

#### 27. **brand_collections** (0 rows)
**Empty!** - This table exists but has no data

---

## Key Insights for Search System

### 1. **Search Priority (What Users Search For)**

**HIGHEST PRIORITY:**
1. **Style Names** (`styles.style_name`) - 4,295 unique names
2. **Product Types** (`product_types.name`) - 110 types
3. **Brands** (`brands.name`) - 91 brands
4. **Categories** (`categories.name`) - 282 categories (including collections)

**MEDIUM PRIORITY:**
5. **Style Codes** (`styles.style_code`) - 4,329 codes
6. **SKU Codes** (`products.sku_code`) - 99,731 codes
7. **Accreditations** - 48 certifications
8. **Fabrics** - 82 types
9. **Style Keywords** - 83 features

**LOW PRIORITY:**
10. Colors (use `primary_colour`, not `colour_name`)
11. Sizes (usually filtered, not searched)
12. Effects, Sports, Sectors (niche)

---

### 2. **Color Filtering Strategy**

**CRITICAL FINDING:**
- `products.colour_name` has **2,652 unique values** (too many!)
- `products.primary_colour` has only **14 unique values** (perfect for filtering!)
- Many color names are variations: "*Black", "All Black", "Jet Black*", "Academy Black"

**RECOMMENDATION:**
- Use `primary_colour` for color filtering (14 basic colors)
- Display only basic colors in filter UI (Black, Red, Green, Yellow, Grey, Navy, Pink, Orange, White, Blue, etc.)
- Map `colour_name` variations to `primary_colour` for search

---

### 3. **Category Search Strategy**

**CRITICAL FINDING:**
- Products have **average 8.5 categories each** (853,928 relationships)
- Categories include:
  - Product collections (e.g., "Edge - Travel - Essentials")
  - Promotional categories (e.g., "15% Off Adidas Raladeal")
  - General categories (e.g., "Accessories", "Activewear & Performance")

**RECOMMENDATION:**
- Search categories by name (282 unique)
- Include category names in full-text search
- Some categories are brand-specific collections - treat as searchable entities

---

### 4. **Full-Text Search Fields**

**Should Search:**
1. `styles.style_name` ⭐⭐⭐
2. `styles.style_code` ⭐⭐
3. `products.sku_code` ⭐
4. `brands.name` ⭐⭐⭐
5. `product_types.name` ⭐⭐⭐
6. `categories.name` ⭐⭐
7. `style_keywords.name` ⭐
8. `fabrics.name` ⭐
9. `accreditations.name` ⭐

**Should NOT Search:**
- Colors (use filter)
- Sizes (use filter)
- Prices (use filter)
- Status (use filter)

---

### 5. **Search Query Examples**

**What "T-Shirt" Should Match:**
- `product_types.name` = "T-Shirts" ✅
- `styles.style_name` LIKE "%T-Shirt%" ✅
- `styles.style_name` LIKE "%Tee%" ✅
- `styles.style_name` LIKE "%Tshirt%" ✅

**What "Edge Travel" Should Match:**
- `categories.name` = "Edge - Travel - Essentials" ✅
- `brands.name` = "Edge" (if exists) ✅
- `styles.style_name` LIKE "%Edge%" AND "%Travel%" ✅

**What "Black Polo" Should Match:**
- `product_types.name` = "Polos" ✅
- `products.primary_colour` = "Black" ✅
- `styles.style_name` LIKE "%Polo%" ✅

---

## Database Relationships

### Primary Relationships:
```
styles (1) ──→ (many) products
styles.brand_id ──→ brands.id
styles.product_type_id ──→ product_types.id
styles.gender_id ──→ genders.id
styles.age_group_id ──→ age_groups.id

products.colour_id ──→ colours.id
products.size_id ──→ sizes.id
products.tag_id ──→ tags.id
products.style_code ──→ styles.style_code

products (many) ──→ (many) categories (via product_categories)
products (many) ──→ (many) accreditations (via product_accreditations)
products (many) ──→ (many) fabrics (via product_fabrics)
products (many) ──→ (many) flags (via product_flags)
products (many) ──→ (many) effects (via product_effects)
products (many) ──→ (many) sectors (via product_sectors)
products (many) ──→ (many) sports (via product_sports)

styles (many) ──→ (many) style_keywords (via style_keywords_mapping)
```

---

## Recommendations for Search System

### 1. **Search Query Parsing**
- Extract product types from query (T-Shirt → product_type = "T-Shirts")
- Extract colors from query (Black → primary_colour = "Black")
- Extract brands from query
- Remaining keywords → full-text search

### 2. **Full-Text Search Strategy**
- Use `product_search_view` (materialized view) for performance
- Search across: style_name, style_code, brand, product_type, categories, keywords
- Use `plainto_tsquery` for natural language (handles hyphens, punctuation)

### 3. **Color Filtering**
- Use `primary_colour` (14 values) not `colour_name` (2,652 values)
- Display only basic colors in UI
- Map color name variations to primary colors

### 4. **Category Search**
- Include category names in search (282 categories)
- Some categories are collections (e.g., "Edge - Travel - Essentials")
- Treat brand collections as searchable entities

### 5. **Performance Optimization**
- Use materialized views for complex joins
- Index on: style_name, style_code, brand, product_type, primary_colour
- Use GIN indexes for full-text search

---

## File Locations

- **JSON Analysis:** `backend/database_analysis.json`
- **Markdown Report:** `backend/DATABASE_ANALYSIS.md`
- **This Summary:** `Analysis/DATABASE_COMPREHENSIVE_ANALYSIS.md`

---

## Next Steps

1. ✅ Database structure analyzed
2. ✅ Key tables identified
3. ✅ Search priorities established
4. 🔄 Update search system based on findings
5. 🔄 Optimize color filtering (use primary_colour)
6. 🔄 Enhance category search
7. 🔄 Improve query parsing based on actual data

---

**Generated by:** Database Analysis Script  
**Date:** 2025-12-20



