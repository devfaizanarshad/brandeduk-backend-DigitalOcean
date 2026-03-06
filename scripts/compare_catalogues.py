"""
=============================================================
  COMPREHENSIVE CATALOGUE COMPARISON ANALYSIS
  Compares existing DB catalogue (Uneek + Ralawise) 
  with new Absolute Apparel JSON catalogue
=============================================================
"""

import json
import os
import sys
from collections import Counter, defaultdict

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Installing psycopg2-binary...")
    os.system(f"{sys.executable} -m pip install psycopg2-binary")
    import psycopg2
    import psycopg2.extras

# ============================================================
# CONFIG
# ============================================================
DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "brandeduk_ralawise_backup",
    "user": "postgres",
    "password": "1234",
}

ABSOLUTE_JSON = os.path.join(os.path.dirname(__file__), '..', 'absolute_products_clean.json')
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'catalogue_comparison_report.txt')


# ============================================================
# 1. DATABASE SCHEMA DISCOVERY
# ============================================================
def discover_schema(cursor):
    """Get all tables and their columns from the database."""
    cursor.execute("""
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' ORDER BY table_name;
    """)
    tables = [row[0] for row in cursor.fetchall()]

    schema = {}
    for table in tables:
        cursor.execute("""
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = %s 
            ORDER BY ordinal_position;
        """, (table,))
        schema[table] = [(r[0], r[1], r[2]) for r in cursor.fetchall()]
    return schema


# ============================================================
# 2. LOAD DATABASE CATALOGUE
# ============================================================
def load_db_catalogue(cursor):
    """Load all product data from the existing database."""
    data = {}

    # --- SUPPLIERS ---
    try:
        cursor.execute("SELECT * FROM suppliers;")
        data['suppliers'] = cursor.fetchall()
        data['supplier_cols'] = [desc[0] for desc in cursor.description]
    except Exception as e:
        data['suppliers'] = []
        data['supplier_cols'] = []
        print(f"  Warning: suppliers table error: {e}")

    # --- BRANDS ---
    try:
        cursor.execute("SELECT * FROM brands;")
        data['brands'] = cursor.fetchall()
        data['brand_cols'] = [desc[0] for desc in cursor.description]
    except Exception as e:
        data['brands'] = []
        data['brand_cols'] = []
        print(f"  Warning: brands table error: {e}")

    # --- CATEGORIES ---
    try:
        cursor.execute("SELECT * FROM categories;")
        data['categories'] = cursor.fetchall()
        data['category_cols'] = [desc[0] for desc in cursor.description]
    except Exception as e:
        data['categories'] = []
        data['category_cols'] = []
        print(f"  Warning: categories table error: {e}")

    # --- PRODUCT_TYPES ---
    try:
        cursor.execute("SELECT * FROM product_types;")
        data['product_types'] = cursor.fetchall()
        data['product_type_cols'] = [desc[0] for desc in cursor.description]
    except Exception as e:
        data['product_types'] = []
        data['product_type_cols'] = []
        print(f"  Warning: product_types table error: {e}")

    # --- STYLES (Master Products) ---
    try:
        cursor.execute("SELECT * FROM styles LIMIT 5;")
        data['style_sample'] = cursor.fetchall()
        data['style_cols'] = [desc[0] for desc in cursor.description]
        cursor.execute("SELECT COUNT(*) FROM styles;")
        data['style_count'] = cursor.fetchone()[0]
    except Exception as e:
        data['style_sample'] = []
        data['style_cols'] = []
        data['style_count'] = 0
        print(f"  Warning: styles table error: {e}")

    # --- PRODUCTS (SKU-Level) ---
    try:
        cursor.execute("SELECT * FROM products LIMIT 5;")
        data['product_sample'] = cursor.fetchall()
        data['product_cols'] = [desc[0] for desc in cursor.description]
        cursor.execute("SELECT COUNT(*) FROM products;")
        data['product_count'] = cursor.fetchone()[0]
    except Exception as e:
        data['product_sample'] = []
        data['product_cols'] = []
        data['product_count'] = 0
        print(f"  Warning: products table error: {e}")

    # --- COLOURS ---
    try:
        cursor.execute("SELECT * FROM colours LIMIT 5;")
        data['colour_sample'] = cursor.fetchall()
        data['colour_cols'] = [desc[0] for desc in cursor.description]
        cursor.execute("SELECT COUNT(*) FROM colours;")
        data['colour_count'] = cursor.fetchone()[0]
    except Exception as e:
        data['colour_sample'] = []
        data['colour_cols'] = []
        data['colour_count'] = 0

    # --- SIZES ---
    try:
        cursor.execute("SELECT * FROM sizes LIMIT 5;")
        data['size_sample'] = cursor.fetchall()
        data['size_cols'] = [desc[0] for desc in cursor.description]
        cursor.execute("SELECT COUNT(*) FROM sizes;")
        data['size_count'] = cursor.fetchone()[0]
    except Exception as e:
        data['size_sample'] = []
        data['size_cols'] = []
        data['size_count'] = 0

    # --- Aggregate Stats ---
    # Brands with product counts
    try:
        cursor.execute("""
            SELECT b.name, COUNT(DISTINCT s.id) as style_count, COUNT(p.id) as product_count
            FROM brands b
            LEFT JOIN styles s ON s.brand_id = b.id
            LEFT JOIN products p ON p.style_id = s.id
            GROUP BY b.name
            ORDER BY style_count DESC;
        """)
        data['brand_stats'] = cursor.fetchall()
    except Exception as e:
        data['brand_stats'] = []
        print(f"  Warning: brand stats query error: {e}")

    # Categories with product counts
    try:
        cursor.execute("""
            SELECT c.name, COUNT(DISTINCT s.id) as style_count
            FROM categories c
            LEFT JOIN product_categories pc ON pc.category_id = c.id
            LEFT JOIN styles s ON s.id = pc.style_id
            GROUP BY c.name
            ORDER BY style_count DESC;
        """)
        data['category_stats'] = cursor.fetchall()
    except Exception as e:
        data['category_stats'] = []
        print(f"  Warning: category stats query error: {e}")

    # Product types with counts
    try:
        cursor.execute("""
            SELECT pt.name, COUNT(DISTINCT s.id) as style_count
            FROM product_types pt
            LEFT JOIN styles s ON s.product_type_id = pt.id
            GROUP BY pt.name
            ORDER BY style_count DESC;
        """)
        data['product_type_stats'] = cursor.fetchall()
    except Exception as e:
        data['product_type_stats'] = []
        print(f"  Warning: product type stats error: {e}")

    # Suppliers with counts
    try:
        cursor.execute("""
            SELECT su.name, COUNT(DISTINCT s.id) as style_count, COUNT(p.id) as product_count
            FROM suppliers su
            LEFT JOIN styles s ON s.supplier_id = su.id
            LEFT JOIN products p ON p.style_id = s.id
            GROUP BY su.name
            ORDER BY style_count DESC;
        """)
        data['supplier_stats'] = cursor.fetchall()
    except Exception as e:
        data['supplier_stats'] = []
        print(f"  Warning: supplier stats error: {e}")

    # All style codes for overlap detection
    try:
        cursor.execute("SELECT style_code, name FROM styles;")
        data['all_styles'] = cursor.fetchall()
    except Exception as e:
        data['all_styles'] = []

    # All product stock codes
    try:
        cursor.execute("SELECT sku FROM products LIMIT 1000;")
        data['sample_skus'] = [r[0] for r in cursor.fetchall()]
    except Exception as e:
        data['sample_skus'] = []

    # Price ranges
    try:
        cursor.execute("""
            SELECT MIN(price), MAX(price), AVG(price), MIN(rrp), MAX(rrp), AVG(rrp)
            FROM products WHERE price > 0;
        """)
        data['price_stats'] = cursor.fetchone()
    except Exception as e:
        data['price_stats'] = None

    # All brand names
    try:
        cursor.execute("SELECT name FROM brands ORDER BY name;")
        data['all_brand_names'] = [r[0] for r in cursor.fetchall()]
    except Exception as e:
        data['all_brand_names'] = []

    # All category names
    try:
        cursor.execute("SELECT name FROM categories ORDER BY name;")
        data['all_category_names'] = [r[0] for r in cursor.fetchall()]
    except Exception as e:
        data['all_category_names'] = []

    # All product type names
    try:
        cursor.execute("SELECT name FROM product_types ORDER BY name;")
        data['all_product_type_names'] = [r[0] for r in cursor.fetchall()]
    except Exception as e:
        data['all_product_type_names'] = []

    return data


# ============================================================
# 3. LOAD ABSOLUTE APPAREL JSON
# ============================================================
def load_absolute_json(filepath):
    """Load and parse the Absolute Apparel JSON file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data


# ============================================================
# 4. COMPARISON & ANALYSIS
# ============================================================
def compare_catalogues(db_data, abs_data, schema):
    """Perform deep comparison between database and Absolute Apparel data."""
    report = []
    r = report.append  # Shortcut

    abs_products = abs_data.get('products', [])

    r("=" * 70)
    r("   COMPREHENSIVE CATALOGUE COMPARISON REPORT")
    r("   Existing DB (Uneek + Ralawise) vs New Absolute Apparel")
    r("=" * 70)
    r("")

    # -------------------------------------------------------
    # SECTION 1: DATABASE SCHEMA OVERVIEW
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 1: CURRENT DATABASE SCHEMA OVERVIEW")
    r("=" * 70)
    r(f"Total Tables: {len(schema)}")
    r("")
    for table, cols in sorted(schema.items()):
        r(f"  Table: {table} ({len(cols)} columns)")
        for col_name, col_type, nullable in cols:
            r(f"    - {col_name:<35} {col_type:<30} {'NULL' if nullable == 'YES' else 'NOT NULL'}")
        r("")

    # -------------------------------------------------------
    # SECTION 2: CURRENT DB STATS
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 2: CURRENT DATABASE STATISTICS")
    r("=" * 70)
    r(f"Total Styles (Master Products): {db_data.get('style_count', 'N/A')}")
    r(f"Total Products (SKUs):          {db_data.get('product_count', 'N/A')}")
    r(f"Total Brands:                   {len(db_data.get('all_brand_names', []))}")
    r(f"Total Categories:               {len(db_data.get('all_category_names', []))}")
    r(f"Total Product Types:            {len(db_data.get('all_product_type_names', []))}")
    r(f"Total Colours:                  {db_data.get('colour_count', 'N/A')}")
    r(f"Total Sizes:                    {db_data.get('size_count', 'N/A')}")
    r("")

    if db_data.get('price_stats'):
        ps = db_data['price_stats']
        r(f"Price Range:  GBP {ps[0]:.2f} - GBP {ps[1]:.2f} (Avg: GBP {ps[2]:.2f})")
        r(f"RRP Range:    GBP {ps[3]:.2f} - GBP {ps[4]:.2f} (Avg: GBP {ps[5]:.2f})")
    r("")

    # Suppliers
    r("--- SUPPLIERS ---")
    for s in db_data.get('supplier_stats', []):
        r(f"  {s[0]:<25} Styles: {s[1]:<6}  SKUs: {s[2]}")
    r("")

    # Brands
    r("--- BRANDS IN DB (with product counts) ---")
    for b in db_data.get('brand_stats', []):
        r(f"  {b[0]:<35} Styles: {b[1]:<6}  SKUs: {b[2]}")
    r("")

    # Product Types
    r("--- PRODUCT TYPES IN DB ---")
    for pt in db_data.get('product_type_stats', []):
        r(f"  {pt[0]:<45} Styles: {pt[1]}")
    r("")

    # Categories
    r("--- CATEGORIES IN DB (Top 30) ---")
    for c in db_data.get('category_stats', [])[:30]:
        r(f"  {c[0]:<50} Styles: {c[1]}")
    if len(db_data.get('category_stats', [])) > 30:
        r(f"  ... and {len(db_data['category_stats']) - 30} more categories")
    r("")

    # -------------------------------------------------------
    # SECTION 3: ABSOLUTE APPAREL STATS
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 3: NEW ABSOLUTE APPAREL CATALOGUE STATISTICS")
    r("=" * 70)
    r(f"Total Products (Styles):    {len(abs_products)}")
    total_skus = sum(len(p.get('SKUs', [])) for p in abs_products)
    total_imgs = sum(len(p.get('Images', [])) for p in abs_products)
    r(f"Total SKUs:                 {total_skus}")
    r(f"Total Images:               {total_imgs}")
    r("")

    # Absolute Brands
    abs_brands = Counter(p.get('Manufacturer', 'Unknown') for p in abs_products)
    r("--- ABSOLUTE APPAREL BRANDS ---")
    for brand, count in abs_brands.most_common():
        r(f"  {brand:<35} {count} styles")
    r("")

    # Absolute Categories (top-level)
    abs_cats = Counter(p.get('Category', '').split('\\')[0].strip() for p in abs_products)
    r("--- ABSOLUTE APPAREL CATEGORIES (Top 20) ---")
    for cat, count in abs_cats.most_common(20):
        r(f"  {cat:<55} {count} styles")
    if len(abs_cats) > 20:
        r(f"  ... and {len(abs_cats) - 20} more categories")
    r("")

    # Absolute Price Stats
    abs_prices = [s['Price'] for p in abs_products for s in p.get('SKUs', []) if s.get('Price', 0) > 0]
    abs_rrps = [s['RRP'] for p in abs_products for s in p.get('SKUs', []) if s.get('RRP', 0) > 0]
    if abs_prices:
        r(f"Price Range:  GBP {min(abs_prices):.2f} - GBP {max(abs_prices):.2f} (Avg: GBP {sum(abs_prices)/len(abs_prices):.2f})")
    if abs_rrps:
        r(f"RRP Range:    GBP {min(abs_rrps):.2f} - GBP {max(abs_rrps):.2f} (Avg: GBP {sum(abs_rrps)/len(abs_rrps):.2f})")
    r("")

    # -------------------------------------------------------
    # SECTION 4: BRAND OVERLAP ANALYSIS
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 4: BRAND OVERLAP ANALYSIS")
    r("=" * 70)
    db_brand_set = set(name.lower().strip() for name in db_data.get('all_brand_names', []))
    abs_brand_set = set(name.lower().strip() for name in abs_brands.keys())

    common_brands = db_brand_set & abs_brand_set
    only_in_db = db_brand_set - abs_brand_set
    only_in_abs = abs_brand_set - db_brand_set

    r(f"Brands ONLY in DB:                 {len(only_in_db)}")
    r(f"Brands ONLY in Absolute Apparel:   {len(only_in_abs)}")
    r(f"Brands in BOTH (Common):           {len(common_brands)}")
    r("")

    if common_brands:
        r("  [COMMON BRANDS]")
        for b in sorted(common_brands):
            r(f"    ✓ {b}")
    r("")
    if only_in_db:
        r("  [ONLY IN DB - Not in Absolute Apparel]")
        for b in sorted(only_in_db):
            r(f"    - {b}")
    r("")
    if only_in_abs:
        r("  [ONLY IN ABSOLUTE APPAREL - New brands to add]")
        for b in sorted(only_in_abs):
            r(f"    + {b}")
    r("")

    # -------------------------------------------------------
    # SECTION 5: CATEGORY / PRODUCT TYPE OVERLAP
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 5: CATEGORY / PRODUCT TYPE OVERLAP")
    r("=" * 70)
    db_cat_set = set(name.lower().strip() for name in db_data.get('all_category_names', []))
    db_pt_set = set(name.lower().strip() for name in db_data.get('all_product_type_names', []))

    # Extract broad product types from Absolute categories
    abs_product_types = set()
    for cat in abs_cats.keys():
        # Attempt to extract a broad type like "T-Shirts", "Hoodies", etc.
        parts = cat.split(' - ')[0].strip() if ' - ' in cat else cat.strip()
        abs_product_types.add(parts.lower())

    r(f"DB Categories:            {len(db_cat_set)}")
    r(f"DB Product Types:         {len(db_pt_set)}")
    r(f"Absolute Category Count:  {len(abs_cats)}")
    r(f"Absolute Broad Types:     {len(abs_product_types)}")
    r("")

    # Find overlaps with DB categories
    cat_overlap = set()
    cat_only_abs = set()
    for acat in abs_cats.keys():
        acat_lower = acat.lower().strip()
        found = False
        for dbcat in db_cat_set:
            # Check if they share significant keywords
            if dbcat in acat_lower or acat_lower in dbcat:
                cat_overlap.add(acat)
                found = True
                break
        if not found:
            cat_only_abs.add(acat)

    # Check product type overlaps
    pt_overlap = set()
    pt_only_abs = set()
    for apt in abs_product_types:
        found = False
        for dpt in db_pt_set:
            if dpt in apt or apt in dpt:
                pt_overlap.add(apt)
                found = True
                break
        if not found:
            pt_only_abs.add(apt)

    r(f"Category overlaps (fuzzy match): {len(cat_overlap)}")
    r(f"New categories from Absolute:    {len(cat_only_abs)}")
    r(f"Product type overlaps:           {len(pt_overlap)}")
    r(f"New product types from Absolute: {len(pt_only_abs)}")
    r("")

    if pt_overlap:
        r("  [PRODUCT TYPE OVERLAPS]")
        for pt in sorted(pt_overlap):
            r(f"    ✓ {pt}")
    r("")

    if pt_only_abs:
        r("  [NEW PRODUCT TYPES FROM ABSOLUTE]")
        for pt in sorted(pt_only_abs):
            r(f"    + {pt}")
    r("")

    # -------------------------------------------------------
    # SECTION 6: PRODUCT CODE / STYLE OVERLAP
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 6: PRODUCT CODE / STYLE CODE OVERLAP")
    r("=" * 70)
    db_style_codes = set(s[0].upper().strip() for s in db_data.get('all_styles', []) if s[0])
    abs_style_codes = set(p['ProductCode'].upper().strip() for p in abs_products if p.get('ProductCode'))

    common_codes = db_style_codes & abs_style_codes
    only_in_db_codes = db_style_codes - abs_style_codes
    only_in_abs_codes = abs_style_codes - db_style_codes

    r(f"Style codes in DB:                  {len(db_style_codes)}")
    r(f"Style codes in Absolute Apparel:    {len(abs_style_codes)}")
    r(f"COMMON Style Codes (Overlap):       {len(common_codes)}")
    r(f"ONLY in DB:                         {len(only_in_db_codes)}")
    r(f"ONLY in Absolute (New to add):      {len(only_in_abs_codes)}")
    r("")

    if common_codes:
        r("  [COMMON PRODUCT CODES - Already exist in DB]")
        for code in sorted(list(common_codes)[:50]):
            r(f"    ✓ {code}")
        if len(common_codes) > 50:
            r(f"    ... and {len(common_codes) - 50} more")
    r("")

    if only_in_abs_codes:
        r(f"  [NEW PRODUCT CODES FROM ABSOLUTE - {len(only_in_abs_codes)} to add]")
        for code in sorted(list(only_in_abs_codes)[:50]):
            r(f"    + {code}")
        if len(only_in_abs_codes) > 50:
            r(f"    ... and {len(only_in_abs_codes) - 50} more")
    r("")

    # -------------------------------------------------------
    # SECTION 7: DATA STRUCTURE COMPARISON
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 7: DATA STRUCTURE COMPARISON")
    r("=" * 70)
    r("")
    r("--- DB STYLE COLUMNS ---")
    for col in db_data.get('style_cols', []):
        r(f"  {col}")
    r("")

    r("--- DB PRODUCT (SKU) COLUMNS ---")
    for col in db_data.get('product_cols', []):
        r(f"  {col}")
    r("")

    r("--- ABSOLUTE APPAREL PRODUCT FIELDS ---")
    if abs_products:
        for key in abs_products[0].keys():
            r(f"  {key}")
    r("")

    r("--- ABSOLUTE APPAREL SKU FIELDS ---")
    if abs_products and abs_products[0].get('SKUs'):
        for key in abs_products[0]['SKUs'][0].keys():
            r(f"  {key}")
    r("")

    # Field mapping suggestion
    r("--- SUGGESTED FIELD MAPPING (Absolute -> DB) ---")
    r("  Absolute Field          =>  DB Table.Column")
    r("  -------------------------------------------------")
    r("  ProductCode             =>  styles.style_code")
    r("  ProductName             =>  styles.name")
    r("  Manufacturer            =>  brands.name (via styles.brand_id)")
    r("  Category                =>  categories.name (via product_categories)")
    r("  KeyFeatures             =>  styles.description or custom field")
    r("  Images                  =>  styles.images (array) or separate table")
    r("  SKU.StockCode           =>  products.sku")
    r("  SKU.Colour              =>  colours.name (via products.colour_id)")
    r("  SKU.Size                =>  sizes.name (via products.size_id)")
    r("  SKU.Price               =>  products.price")
    r("  SKU.RRP                 =>  products.rrp")
    r("  SKU.Stock               =>  products.stock")
    r("  SKU.BarCode             =>  products.barcode")
    r("  SKU.Discontinued        =>  products.discontinued")
    r("")

    # -------------------------------------------------------
    # SECTION 8: COLOUR & SIZE ANALYSIS
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 8: COLOUR & SIZE ANALYSIS")
    r("=" * 70)

    # Absolute colours
    abs_colours = Counter()
    abs_sizes = Counter()
    for p in abs_products:
        for s in p.get('SKUs', []):
            if s.get('Colour'):
                abs_colours[s['Colour']] += 1
            if s.get('Size'):
                abs_sizes[s['Size']] += 1

    r(f"Unique Colours in Absolute: {len(abs_colours)}")
    r(f"Unique Sizes in Absolute:   {len(abs_sizes)}")
    r(f"Unique Colours in DB:       {db_data.get('colour_count', 'N/A')}")
    r(f"Unique Sizes in DB:         {db_data.get('size_count', 'N/A')}")
    r("")

    r("--- TOP 20 COLOURS IN ABSOLUTE ---")
    for colour, count in abs_colours.most_common(20):
        r(f"  {colour:<30} {count} SKUs")
    r("")

    r("--- TOP 20 SIZES IN ABSOLUTE ---")
    for size, count in abs_sizes.most_common(20):
        r(f"  {size:<20} {count} SKUs")
    r("")

    # -------------------------------------------------------
    # SECTION 9: SAMPLE DATA COMPARISON
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 9: SAMPLE DATA (Side by Side)")
    r("=" * 70)
    r("")
    r("--- SAMPLE DB STYLE ---")
    if db_data.get('style_sample') and db_data.get('style_cols'):
        for i, row in enumerate(db_data['style_sample'][:2]):
            r(f"  Style {i+1}:")
            for col, val in zip(db_data['style_cols'], row):
                r(f"    {col:<30} = {val}")
            r("")

    r("--- SAMPLE DB PRODUCT (SKU) ---")
    if db_data.get('product_sample') and db_data.get('product_cols'):
        for i, row in enumerate(db_data['product_sample'][:2]):
            r(f"  Product {i+1}:")
            for col, val in zip(db_data['product_cols'], row):
                r(f"    {col:<30} = {val}")
            r("")

    r("--- SAMPLE ABSOLUTE APPAREL PRODUCT ---")
    if abs_products:
        sample = abs_products[0]
        r(f"  ProductCode: {sample.get('ProductCode')}")
        r(f"  ProductName: {sample.get('ProductName')}")
        r(f"  Manufacturer: {sample.get('Manufacturer')}")
        r(f"  Category: {sample.get('Category')}")
        r(f"  KeyFeatures: {sample.get('KeyFeatures', [])[:3]}...")
        r(f"  Images: {len(sample.get('Images', []))} images")
        r(f"  SKUs: {len(sample.get('SKUs', []))} variants")
        if sample.get('SKUs'):
            r(f"  Sample SKU: {json.dumps(sample['SKUs'][0], indent=4)}")
    r("")

    # -------------------------------------------------------
    # SECTION 10: INTEGRATION SUMMARY & RECOMMENDATIONS
    # -------------------------------------------------------
    r("=" * 70)
    r("  SECTION 10: INTEGRATION SUMMARY & RECOMMENDATIONS")
    r("=" * 70)
    r("")
    r(f"New Styles to Add:           {len(only_in_abs_codes)}")
    r(f"Overlapping Styles (Update): {len(common_codes)}")
    r(f"New Brands to Create:        {len(only_in_abs)}")
    r(f"Existing Brands to Reuse:    {len(common_brands)}")
    r(f"New Colours to Add:          ~{len(abs_colours)} (needs dedup with DB)")
    r(f"New Sizes to Add:            ~{len(abs_sizes)} (needs dedup with DB)")
    r("")

    r("--- INTEGRATION STEPS ---")
    r("1. Create new Supplier record: 'Absolute Apparel'")
    r(f"2. Create {len(only_in_abs)} new Brand records")
    r(f"3. Map {len(common_brands)} existing brands")
    r("4. Map or create Category records from Absolute's category tree")
    r("5. Map or create Product Type records")
    r("6. Import Colour records (deduplicate with existing)")
    r("7. Import Size records (deduplicate with existing)")
    r(f"8. Import {len(only_in_abs_codes)} new Style records")
    r(f"9. Import ~{total_skus} Product (SKU) records")
    r(f"10. Store {total_imgs} image URLs")
    r("")

    r("--- POTENTIAL ISSUES ---")
    if common_codes:
        r(f"⚠ {len(common_codes)} style codes already exist in the DB.")
        r("  Decision needed: UPDATE existing records or SKIP duplicates?")
    r("")
    r("--- DATA QUALITY NOTES ---")
    empty_imgs = sum(1 for p in abs_products if not p.get('Images'))
    empty_skus = sum(1 for p in abs_products if not p.get('SKUs'))
    r(f"Products with no images: {empty_imgs}")
    r(f"Products with no SKUs:   {empty_skus}")
    r("")
    r("=" * 70)
    r("  END OF REPORT")
    r("=" * 70)

    return "\n".join(report)


# ============================================================
# MAIN
# ============================================================
def main():
    print("=" * 60)
    print("  CATALOGUE COMPARISON ANALYSIS")
    print("=" * 60)

    # 1. Connect to DB
    print("\n[1/4] Connecting to PostgreSQL database...")
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        cursor = conn.cursor()
        print("  ✓ Connected successfully!")
    except Exception as e:
        print(f"  ✗ Failed to connect: {e}")
        sys.exit(1)

    # 2. Discover schema
    print("\n[2/4] Discovering database schema...")
    schema = discover_schema(cursor)
    print(f"  ✓ Found {len(schema)} tables")

    # 3. Load data
    print("\n[3/4] Loading catalogue data...")
    print("  Loading DB catalogue...")
    db_data = load_db_catalogue(cursor)
    print(f"  ✓ DB: {db_data.get('style_count', 0)} styles, {db_data.get('product_count', 0)} SKUs")

    print(f"  Loading Absolute Apparel JSON from {ABSOLUTE_JSON}...")
    abs_data = load_absolute_json(ABSOLUTE_JSON)
    print(f"  ✓ Absolute: {len(abs_data.get('products', []))} products")

    # 4. Compare
    print("\n[4/4] Running comparison analysis...")
    report = compare_catalogues(db_data, abs_data, schema)

    # Save report
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(report)
    print(f"\n✓ Full report saved to: {OUTPUT_FILE}")

    # Print report to console too
    print("\n" + report)

    # Cleanup
    cursor.close()
    conn.close()
    print("\n✓ Done!")


if __name__ == "__main__":
    main()
