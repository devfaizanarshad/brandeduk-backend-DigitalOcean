-- Table: accreditations
CREATE TABLE IF NOT EXISTS "accreditations" (
  "id" integer NOT NULL DEFAULT nextval('accreditations_id_seq'::regclass),
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "description" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: age_groups
CREATE TABLE IF NOT EXISTS "age_groups" (
  "id" integer NOT NULL DEFAULT nextval('age_groups_id_seq'::regclass),
  "name" character varying(50) NOT NULL,
  "slug" character varying(50) NOT NULL,
  "display_order" integer DEFAULT 0,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: brand_collections
CREATE TABLE IF NOT EXISTS "brand_collections" (
  "id" integer NOT NULL DEFAULT nextval('brand_collections_id_seq'::regclass),
  "brand_id" integer,
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "display_order" integer DEFAULT 0,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: brands
CREATE TABLE IF NOT EXISTS "brands" (
  "id" integer NOT NULL DEFAULT nextval('brands_id_seq'::regclass),
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "display_order" integer DEFAULT 0,
  "description" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: button_counts
CREATE TABLE IF NOT EXISTS "button_counts" (
  "id" integer NOT NULL DEFAULT nextval('button_counts_id_seq'::regclass),
  "name" character varying(100) NOT NULL,
  "slug" character varying(100) NOT NULL,
  "button_count" integer,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: categories
CREATE TABLE IF NOT EXISTS "categories" (
  "id" integer NOT NULL DEFAULT nextval('categories_id_seq'::regclass),
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "parent_id" integer,
  "category_type" character varying(50),
  "display_order" integer DEFAULT 0,
  "description" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: category_hierarchy_cache
CREATE TABLE IF NOT EXISTS "category_hierarchy_cache" (
  "category_id" integer NOT NULL,
  "all_child_ids" _int4 NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now()
);

-- Table: colours
CREATE TABLE IF NOT EXISTS "colours" (
  "id" integer NOT NULL DEFAULT nextval('colours_id_seq'::regclass),
  "name" character varying(100) NOT NULL,
  "slug" character varying(100) NOT NULL,
  "hex_code" character varying(7),
  "colour_family" character varying(50),
  "display_order" integer DEFAULT 0,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: effects
CREATE TABLE IF NOT EXISTS "effects" (
  "id" integer NOT NULL DEFAULT nextval('effects_id_seq'::regclass),
  "name" character varying(100) NOT NULL,
  "slug" character varying(100) NOT NULL,
  "description" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: fabrics
CREATE TABLE IF NOT EXISTS "fabrics" (
  "id" integer NOT NULL DEFAULT nextval('fabrics_id_seq'::regclass),
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "fabric_type" character varying(100),
  "percentage" character varying(50),
  "description" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: genders
CREATE TABLE IF NOT EXISTS "genders" (
  "id" integer NOT NULL DEFAULT nextval('genders_id_seq'::regclass),
  "name" character varying(50) NOT NULL,
  "slug" character varying(50) NOT NULL,
  "display_order" integer DEFAULT 0,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_accreditations
CREATE TABLE IF NOT EXISTS "product_accreditations" (
  "product_id" integer NOT NULL,
  "accreditation_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_buttons
CREATE TABLE IF NOT EXISTS "product_buttons" (
  "product_id" integer NOT NULL,
  "button_count_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_categories
CREATE TABLE IF NOT EXISTS "product_categories" (
  "product_id" integer NOT NULL,
  "category_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_effects
CREATE TABLE IF NOT EXISTS "product_effects" (
  "product_id" integer NOT NULL,
  "effect_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_fabrics
CREATE TABLE IF NOT EXISTS "product_fabrics" (
  "product_id" integer NOT NULL,
  "fabric_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_flags
CREATE TABLE IF NOT EXISTS "product_flags" (
  "product_id" integer NOT NULL,
  "flag_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_sectors
CREATE TABLE IF NOT EXISTS "product_sectors" (
  "product_id" integer NOT NULL,
  "sector_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_sports
CREATE TABLE IF NOT EXISTS "product_sports" (
  "product_id" integer NOT NULL,
  "sport_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_types
CREATE TABLE IF NOT EXISTS "product_types" (
  "id" integer NOT NULL DEFAULT nextval('product_types_id_seq'::regclass),
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "display_order" integer DEFAULT 0,
  "description" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: product_weight_ranges
CREATE TABLE IF NOT EXISTS "product_weight_ranges" (
  "product_id" integer NOT NULL,
  "weight_range_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: products
CREATE TABLE IF NOT EXISTS "products" (
  "id" integer NOT NULL DEFAULT nextval('products_id_seq'::regclass),
  "style_code" character varying(50),
  "sku_code" character varying(100) NOT NULL,
  "colour_name" character varying(200),
  "primary_colour" character varying(100),
  "colour_shade" character varying(100),
  "colour_id" integer,
  "size_id" integer,
  "tag_id" integer,
  "sku_status" character varying(50) DEFAULT 'Live'::character varying,
  "carton_price" numeric(10,2),
  "pack_price" numeric(10,2),
  "single_price" numeric(10,2),
  "primary_image_url" text,
  "colour_image_url" text,
  "stock_quantity" integer DEFAULT 0,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: related_sectors
CREATE TABLE IF NOT EXISTS "related_sectors" (
  "id" integer NOT NULL DEFAULT nextval('related_sectors_id_seq'::regclass),
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: related_sports
CREATE TABLE IF NOT EXISTS "related_sports" (
  "id" integer NOT NULL DEFAULT nextval('related_sports_id_seq'::regclass),
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: sizes
CREATE TABLE IF NOT EXISTS "sizes" (
  "id" integer NOT NULL DEFAULT nextval('sizes_id_seq'::regclass),
  "name" character varying(50) NOT NULL,
  "slug" character varying(50) NOT NULL,
  "size_order" integer,
  "size_type" character varying(50),
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: special_flags
CREATE TABLE IF NOT EXISTS "special_flags" (
  "id" integer NOT NULL DEFAULT nextval('special_flags_id_seq'::regclass),
  "name" character varying(100) NOT NULL,
  "slug" character varying(100) NOT NULL,
  "flag_type" character varying(50),
  "display_order" integer DEFAULT 0,
  "description" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: staging_products
CREATE TABLE IF NOT EXISTS "staging_products" (
  "Style Code" text,
  "Style Name" text,
  "Brand" text,
  "Product Type" text,
  "Gender" text,
  "Age Group" text,
  "Fabric" text,
  "Specification" text,
  "Sku Code" text,
  "Colour Name" text,
  "Primary Colour" text,
  "Colour Shade" text,
  "Size Name" text,
  "Tag" text,
  "Sku Status" text,
  "Carton Price" text,
  "Pack Price" text,
  "Single Price" text,
  "Primary Product Image URL" text,
  "Colour Image" text,
  "Categorisation" text,
  "Accreditations" text
);

-- Table: style_keywords
CREATE TABLE IF NOT EXISTS "style_keywords" (
  "id" integer NOT NULL DEFAULT nextval('style_keywords_id_seq'::regclass),
  "name" character varying(200) NOT NULL,
  "slug" character varying(200) NOT NULL,
  "keyword_type" character varying(50),
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: style_keywords_mapping
CREATE TABLE IF NOT EXISTS "style_keywords_mapping" (
  "style_code" character varying(50) NOT NULL,
  "keyword_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: styles
CREATE TABLE IF NOT EXISTS "styles" (
  "style_code" character varying(50) NOT NULL,
  "style_name" character varying(500),
  "brand_id" integer,
  "product_type_id" integer,
  "gender_id" integer,
  "age_group_id" integer,
  "fabric_description" text,
  "specification" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: tags
CREATE TABLE IF NOT EXISTS "tags" (
  "id" integer NOT NULL DEFAULT nextval('tags_id_seq'::regclass),
  "name" character varying(100) NOT NULL,
  "slug" character varying(100) NOT NULL,
  "display_order" integer DEFAULT 0,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: weight_ranges
CREATE TABLE IF NOT EXISTS "weight_ranges" (
  "id" integer NOT NULL DEFAULT nextval('weight_ranges_id_seq'::regclass),
  "name" character varying(100) NOT NULL,
  "slug" character varying(100) NOT NULL,
  "min_gsm" integer,
  "max_gsm" integer,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);



-- DB_HOST=206.189.119.150
-- DB_NAME=brandeduk_prod
-- # DB_PASSWORD=omglol123
-- # DB_POOL_MAX=50
-- # DB_POOL_MIN=5
-- # DB_PORT=5432
-- # DB_SSL=true
-- # DB_USER=brandeduk
