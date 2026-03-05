"""
=============================================================
  ABSOLUTE APPAREL CATALOGUE IMPORT SCRIPT
  Imports 741 styles + ~28,986 SKUs into the existing DB
  All inside a single TRANSACTION for safety
=============================================================
"""

import json
import os
import sys
import re
import time
from collections import Counter, defaultdict
from datetime import datetime

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
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
SUPPLIER_NAME = "Absolute Apparel"
SUPPLIER_SLUG = "absolute-apparel"
NOW = datetime.now()

# ============================================================
# CATEGORY -> PRODUCT TYPE MAPPING (Using actual DB names)
# ============================================================
CATEGORY_TO_PT = {
    'headwear': 'Caps',
    't-shirts cotton crew neck s/s': 'T-shirts',
    't-shirts cotton crew neck l/s': 'T-shirts',
    't-shirts cotton v-neck s/s': 'T-shirts',
    't-shirts polycotton crew neck s/s': 'T-shirts',
    't-shirts polyester crew neck s/s': 'T-shirts',
    'polos cotton s/s': 'Polos',
    'polos cotton l/s': 'Polos',
    'polos polycotton s/s': 'Polos',
    'polos polycotton l/s': 'Polos',
    'polos polyester s/s': 'Polos',
    'sweats crew neck': 'Sweatshirts',
    'sweats full zip': 'Sweatshirts',
    'sweats quarter zip': 'Sweatshirts',
    'hoodies': 'Hoodies',
    'zip hoodies': 'Hoodies',
    'outdoor fleece full zip': 'Fleece',
    'outdoor fleece quarter zip': 'Fleece',
    'outdoor fleece bodywarmers': 'Fleece',
    'softshell full zip': 'Softshells',
    'softshell bodywarmer': 'Softshells',
    'outerwear insulated jackets': 'Jackets',
    'outerwear shell jackets': 'Jackets',
    'outerwear 3in1 jackets': 'Jackets',
    'outerwear hybrid jackets': 'Jackets',
    'outerwear rain suits': 'Jackets',
    'outerwear bodywarmers': 'Gilets & Body Warmers',
    'outerwear hybrid bodywarmers': 'Gilets & Body Warmers',
    'jogpants': 'Sweatpants',
    'shorts': 'Shorts',
    'workwear trousers': 'Trousers',
    'workwear shorts': 'Shorts',
    'workwear': 'Trousers',
    'workwear thermal underwear': 'Baselayers',
    'shirts poplin s/s': 'Shirts',
    'shirts poplin l/s': 'Shirts',
    'shirts oxford s/s': 'Shirts',
    'shirts oxford l/s': 'Shirts',
    'shirts twill s/s': 'Shirts',
    'shirts twill l/s': 'Shirts',
    'shirts herringbone s/s': 'Shirts',
    'shirts herringbone l/s': 'Shirts',
    'vests & tanks cotton': 'Vests (t-shirt)',
    'accessories': 'Accessories',
    'knitwear': 'Knitted Jumpers',
    'catering & hospitality': 'Aprons',
    'baby & toddler 180gsm': 'Bodysuits',
    'consumables': None,   # SKIP
    'catalogues': None,    # SKIP
    'marketing': None,     # SKIP
}

def sync_sequences(cur):
    """Synchronize sequences to prevent primary key conflicts"""
    print(f"\n[2.5/9] Synchronizing database sequences...")
    tables = ['colours', 'sizes', 'brands', 'suppliers', 'products']
    for table in tables:
        # 1. Try standard serial sequence
        cur.execute(f"SELECT pg_get_serial_sequence('{table}', 'id');")
        seq_name = cur.fetchone()[0]
        
        # 2. Fallback to extracting from column default (for non-standard names)
        if not seq_name:
            cur.execute(f"""
                SELECT column_default 
                FROM information_schema.columns 
                WHERE table_name = '{table}' AND column_name = 'id'
            """)
            default_val = cur.fetchone()
            if default_val and 'nextval' in str(default_val[0]):
                m = re.search(r"nextval\('([^']+)'", str(default_val[0]))
                if m:
                    seq_name = m.group(1)
        
        if not seq_name:
            print(f"    ⚠️ Could not find sequence for {table}, skipping.")
            continue

        cur.execute(f"SELECT MAX(id) FROM {table};")
        max_id = cur.fetchone()[0]
        if max_id:
            cur.execute(f"SELECT setval(%s, %s, true);", (seq_name, max_id))
            print(f"    ✅ Synced {seq_name} to {max_id}")

# Gender extraction from category string
def extract_gender(category_str):
    cat_lower = category_str.lower()
    if 'ladies' in cat_lower or 'women' in cat_lower:
        return 'Ladies'
    elif 'kids' in cat_lower or 'junior' in cat_lower or 'child' in cat_lower or 'baby' in cat_lower or 'toddler' in cat_lower:
        return 'Kids'
    else:
        return 'Unisex'

def get_broad_type(category_str):
    """Extract the broad type from an Absolute category"""
    main_cat = category_str.split('\\')[0].strip()
    broad = main_cat.split(' - ')[0].strip() if ' - ' in main_cat else main_cat
    return broad

def resolve_product_type(category_str):
    """Return the DB product type name for a given Absolute category"""
    broad = get_broad_type(category_str).lower()
    for pattern, db_name in CATEGORY_TO_PT.items():
        if broad == pattern or broad.startswith(pattern):
            return db_name
    return None  # Unmapped


def main():
    start_time = time.time()

    # Load Absolute data
    print("=" * 60)
    print("  ABSOLUTE APPAREL IMPORT")
    print("=" * 60)
    print(f"\n[1/9] Loading Absolute Apparel data from JSON...")
    with open(ABSOLUTE_JSON, 'r', encoding='utf-8') as f:
        abs_data = json.load(f)
    abs_products = abs_data['products']
    print(f"  Loaded {len(abs_products)} products")

    # Filter out non-product items (consumables, catalogues, marketing)
    importable = []
    skipped = []
    for p in abs_products:
        pt = resolve_product_type(p.get('Category', ''))
        if pt is None:
            skipped.append(p)
        else:
            importable.append(p)

    print(f"  Importable products: {len(importable)}")
    print(f"  Skipped (non-product): {len(skipped)}")

    # Connect to DB
    print(f"\n[2/9] Connecting to database...")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    print(f"  ✅ Connected to {DB_CONFIG['dbname']}")
    
    # Sync sequences before starting
    sync_sequences(cur)

    # Get pre-import counts
    cur.execute("SELECT COUNT(*) FROM styles;")
    pre_styles = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM products;")
    pre_products = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM suppliers;")
    pre_suppliers = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM brands;")
    pre_brands = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM colours;")
    pre_colours = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM sizes;")
    pre_sizes = cur.fetchone()[0]

    print(f"  Pre-import: {pre_styles} styles, {pre_products} products, {pre_suppliers} suppliers, {pre_brands} brands")

    try:
        # ============================================================
        # STEP 3: Create Supplier
        # ============================================================
        print(f"\n[3/9] Creating supplier '{SUPPLIER_NAME}'...")

        # Check if it already exists
        cur.execute("SELECT id FROM suppliers WHERE slug = %s;", (SUPPLIER_SLUG,))
        existing_supplier = cur.fetchone()
        if existing_supplier:
            supplier_id = existing_supplier[0]
            print(f"  Supplier already exists with id: {supplier_id}")
        else:
            cur.execute(
                "INSERT INTO suppliers (name, slug, created_at) VALUES (%s, %s, %s) RETURNING id;",
                (SUPPLIER_NAME, SUPPLIER_SLUG, NOW)
            )
            supplier_id = cur.fetchone()[0]
            print(f"  ✅ Created supplier '{SUPPLIER_NAME}' with id: {supplier_id}")

        # ============================================================
        # STEP 4: Create/Map Brands
        # ============================================================
        print(f"\n[4/9] Syncing brands...")

        # Get all existing brands
        cur.execute("SELECT id, name FROM brands;")
        existing_brands = {row[1].lower().strip(): row[0] for row in cur.fetchall()}

        # Collect all unique brands from Absolute
        abs_brand_names = set(p.get('Manufacturer', 'Unknown') for p in importable)

        brand_id_map = {}  # brand_name -> brand_id
        new_brand_count = 0

        for brand_name in sorted(abs_brand_names):
            brand_lower = brand_name.lower().strip()
            if brand_lower in existing_brands:
                brand_id_map[brand_name] = existing_brands[brand_lower]
                print(f"  ✅ Reusing brand '{brand_name}' -> id:{existing_brands[brand_lower]}")
            else:
                slug = re.sub(r'[^a-z0-9]+', '-', brand_name.lower().strip()).strip('-')
                cur.execute(
                    "INSERT INTO brands (name, slug, is_active, created_at) VALUES (%s, %s, true, %s) RETURNING id;",
                    (brand_name, slug, NOW)
                )
                new_id = cur.fetchone()[0]
                brand_id_map[brand_name] = new_id
                existing_brands[brand_lower] = new_id
                new_brand_count += 1
                print(f"  🆕 Created brand '{brand_name}' -> id:{new_id}")

        print(f"  Total: {len(brand_id_map)} brands ({new_brand_count} new)")

        # ============================================================
        # STEP 5: Load Product Type IDs
        # ============================================================
        print(f"\n[5/9] Loading product type mappings...")

        cur.execute("SELECT id, name FROM product_types;")
        pt_name_to_id = {row[1].lower().strip(): row[0] for row in cur.fetchall()}

        # Verify our mappings
        used_pt_names = set(CATEGORY_TO_PT.values()) - {None}
        for pt_name in used_pt_names:
            if pt_name.lower() not in pt_name_to_id:
                print(f"  ❌ ERROR: Product type '{pt_name}' not found in DB!")
                raise Exception(f"Product type '{pt_name}' not found!")
            else:
                print(f"  ✅ '{pt_name}' -> id:{pt_name_to_id[pt_name.lower()]}")

        # ============================================================
        # STEP 6: Sync Colours & Sizes
        # ============================================================
        print(f"\n[6/9] Syncing colours and sizes...")

        # Get existing
        cur.execute("SELECT id, name FROM colours;")
        colour_name_to_id = {row[1].lower().strip(): row[0] for row in cur.fetchall()}

        cur.execute("SELECT id, name FROM sizes;")
        size_name_to_id = {row[1].lower().strip(): row[0] for row in cur.fetchall()}

        # Collect all unique colours and sizes from Absolute SKUs
        all_colours = set()
        all_sizes = set()
        for p in importable:
            for sku in p.get('SKUs', []):
                if sku.get('Colour'):
                    all_colours.add(sku['Colour'].strip())
                if sku.get('Size'):
                    all_sizes.add(sku['Size'].strip())

        # Insert new colours
        new_colour_count = 0
        for colour in sorted(all_colours):
            if colour.lower().strip() not in colour_name_to_id:
                slug = re.sub(r'[^a-z0-9]+', '-', colour.lower().strip()).strip('-')
                if not slug:
                    slug = f"colour-{new_colour_count}"
                cur.execute(
                    "INSERT INTO colours (name, slug, created_at) VALUES (%s, %s, %s) RETURNING id;",
                    (colour, slug, NOW)
                )
                new_id = cur.fetchone()[0]
                colour_name_to_id[colour.lower().strip()] = new_id
                new_colour_count += 1

        print(f"  Colours: {new_colour_count} new added ({len(all_colours)} total unique)")

        # Insert new sizes
        new_size_count = 0
        # Define size ordering
        SIZE_ORDER = {
            '2xs':1,'2xxs':1,'yxxs':2,'y3xs':3,'y2xs':4,'3xs':5,'xxs':6,'yxs':7,'xs':8,
            'ys':9,'s':10,'ym':11,'m':12,'yl':13,'l':14,'yxl':15,'xl':16,
            '2xl':17,'xxl':17,'3xl':18,'4xl':19,'5xl':20,'6xl':21,'7xl':22,'8xl':23,
            'os':50,'one size':50
        }

        for size in sorted(all_sizes):
            if size.lower().strip() not in size_name_to_id:
                slug = re.sub(r'[^a-z0-9]+', '-', size.lower().strip()).strip('-')
                if not slug:
                    slug = f"size-{new_size_count}"
                size_order = SIZE_ORDER.get(size.lower().strip(), 999)
                cur.execute(
                    "INSERT INTO sizes (name, slug, size_order, created_at) VALUES (%s, %s, %s, %s) RETURNING id;",
                    (size, slug, size_order, NOW)
                )
                new_id = cur.fetchone()[0]
                size_name_to_id[size.lower().strip()] = new_id
                new_size_count += 1

        print(f"  Sizes: {new_size_count} new added ({len(all_sizes)} total unique)")

        # ============================================================
        # STEP 7: Load Gender IDs
        # ============================================================
        print(f"\n[7/9] Loading gender mappings...")
        cur.execute("SELECT id, name FROM genders;")
        gender_rows = cur.fetchall()
        gender_map = {}
        for gid, gname in gender_rows:
            gender_map[gname.lower()] = gid
            print(f"  Gender: '{gname}' -> id:{gid}")

        # Fallback gender mapping
        def get_gender_id(gender_str):
            gl = gender_str.lower()
            if gl in gender_map:
                return gender_map[gl]
            elif 'ladies' in gl or 'women' in gl or 'female' in gl:
                return gender_map.get('ladies', gender_map.get('women', None))
            elif 'kids' in gl or 'junior' in gl or 'child' in gl:
                return gender_map.get('kids', gender_map.get('children', None))
            else:
                return gender_map.get('unisex', gender_map.get('mens', None))

        # ============================================================
        # STEP 8: Import Styles + Products (SKUs)
        # ============================================================
        print(f"\n[8/9] Importing styles and products...")

        styles_inserted = 0
        products_inserted = 0
        styles_skipped = 0
        errors = []

        for idx, product in enumerate(importable):
            style_code = product['ProductCode'].strip()
            style_name = product.get('ProductName', '').strip()
            manufacturer = product.get('Manufacturer', 'Unknown').strip()
            category = product.get('Category', '').strip()
            key_features = product.get('KeyFeatures', [])
            images = product.get('Images', [])
            skus = product.get('SKUs', [])

            # Resolve product type
            pt_name = resolve_product_type(category)
            if not pt_name:
                styles_skipped += 1
                continue

            pt_id = pt_name_to_id.get(pt_name.lower())
            if not pt_id:
                errors.append(f"Product type '{pt_name}' not found for {style_code}")
                continue

            # Resolve brand
            brand_id = brand_id_map.get(manufacturer)

            # Resolve gender
            gender_str = extract_gender(category)
            gender_id = get_gender_id(gender_str)

            # Build specification from key features
            if isinstance(key_features, list):
                specification = ','.join(str(f).strip() for f in key_features if f)
            else:
                specification = str(key_features) if key_features else ''

            # Get primary image
            primary_image_url = None
            if images and len(images) > 0:
                primary_image_url = images[0] if isinstance(images[0], str) else None

            # Check if style already exists
            cur.execute("SELECT style_code FROM styles WHERE style_code = %s;", (style_code,))
            if cur.fetchone():
                styles_skipped += 1
                continue

            # INSERT STYLE
            cur.execute("""
                INSERT INTO styles (
                    style_code, style_name, brand_id, product_type_id, 
                    gender_id, specification, supplier_id, external_style_code,
                    is_best_seller, is_recommended, best_seller_order, recommended_order,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    false, false, 999999, 999999, %s, %s
                );
            """, (
                style_code, style_name, brand_id, pt_id,
                gender_id, specification, supplier_id, style_code,
                NOW, NOW
            ))
            styles_inserted += 1

            # INSERT PRODUCTS (SKUs)
            for sku in skus:
                sku_stock_code = str(sku.get('StockCode', '')).strip()
                if not sku_stock_code:
                    continue

                colour_name = str(sku.get('Colour', '')).strip()
                size_name = str(sku.get('Size', '')).strip()
                price = sku.get('Price', 0)
                rrp = sku.get('RRP', 0)
                stock = sku.get('Stock', 0)
                barcode = str(sku.get('BarCode', '')).strip()
                discontinued = sku.get('Discontinued', False)

                # Resolve colour_id
                colour_id = colour_name_to_id.get(colour_name.lower().strip()) if colour_name else None

                # Resolve size_id
                size_id = size_name_to_id.get(size_name.lower().strip()) if size_name else None

                # Get colour-specific image if available
                colour_image_url = None
                if images:
                    # Try to find a colour-specific image
                    for img in images:
                        if isinstance(img, str) and colour_name.lower().replace(' ', '-') in img.lower():
                            colour_image_url = img
                            break
                    if not colour_image_url and len(images) > 0:
                        colour_image_url = images[0] if isinstance(images[0], str) else None

                sku_status = 'Discontinued' if discontinued else 'Live'

                try:
                    price_val = float(price) if price else 0
                except (ValueError, TypeError):
                    price_val = 0

                cur.execute("""
                    INSERT INTO products (
                        style_code, sku_code, colour_name, colour_id, size_id,
                        sku_status, single_price, carton_price, pack_price,
                        primary_image_url, colour_image_url,
                        stock_quantity, external_sku,
                        created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s,
                        %s, %s,
                        %s, %s
                    );
                """, (
                    style_code, sku_stock_code, colour_name, colour_id, size_id,
                    sku_status, price_val, price_val, price_val,
                    primary_image_url, colour_image_url,
                    stock, barcode if barcode else None,
                    NOW, NOW
                ))
                products_inserted += 1

            # Progress every 50 styles
            if (idx + 1) % 50 == 0:
                print(f"    Progress: {idx + 1}/{len(importable)} styles processed...")

        print(f"\n  ✅ Styles inserted: {styles_inserted}")
        print(f"  ✅ Products (SKUs) inserted: {products_inserted}")
        print(f"  ⏩ Styles skipped: {styles_skipped}")
        if errors:
            print(f"  ⚠️ Errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    - {e}")

        # ============================================================
        # STEP 9: Verification & Commit
        # ============================================================
        print(f"\n[9/9] Verification...")

        # Post-import counts
        cur.execute("SELECT COUNT(*) FROM styles;")
        post_styles = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM products;")
        post_products = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM suppliers;")
        post_suppliers = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM brands;")
        post_brands = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM colours;")
        post_colours = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM sizes;")
        post_sizes = cur.fetchone()[0]

        # Verify supplier linkage
        cur.execute("SELECT id FROM suppliers WHERE slug = %s;", (SUPPLIER_SLUG,))
        supplier_id = cur.fetchone()[0]
        
        cur.execute("SELECT COUNT(*) FROM styles WHERE supplier_id = %s;", (supplier_id,))
        abs_styles_count = cur.fetchone()[0]

        cur.execute("""
            SELECT COUNT(*) FROM products p
            JOIN styles s ON p.style_code = s.style_code
            WHERE s.supplier_id = %s;
        """, (supplier_id,))
        abs_products_count = cur.fetchone()[0]

        # Sample verification
        cur.execute("""
            SELECT s.style_code, s.style_name, b.name as brand, pt.name as product_type, sup.name as supplier
            FROM styles s
            LEFT JOIN brands b ON s.brand_id = b.id
            LEFT JOIN product_types pt ON s.product_type_id = pt.id
            LEFT JOIN suppliers sup ON s.supplier_id = sup.id
            WHERE s.supplier_id = %s
            ORDER BY s.style_code
            LIMIT 5;
        """, (supplier_id,))
        sample_styles = cur.fetchall()

        # COMMIT
        conn.commit()
        print(f"\n  ✅✅✅ TRANSACTION COMMITTED SUCCESSFULLY ✅✅✅")

        # Print Report
        elapsed = time.time() - start_time
        print("\n" + "=" * 60)
        print("  IMPORT COMPLETE - VERIFICATION REPORT")
        print("=" * 60)

        print(f"\n  📊 COUNT COMPARISON:")
        print(f"  {'Metric':<25} {'Before':<12} {'After':<12} {'Diff':<10}")
        print(f"  {'-'*60}")
        print(f"  {'Suppliers':<25} {pre_suppliers:<12} {post_suppliers:<12} +{post_suppliers - pre_suppliers}")
        print(f"  {'Brands':<25} {pre_brands:<12} {post_brands:<12} +{post_brands - pre_brands}")
        print(f"  {'Colours':<25} {pre_colours:<12} {post_colours:<12} +{post_colours - pre_colours}")
        print(f"  {'Sizes':<25} {pre_sizes:<12} {post_sizes:<12} +{post_sizes - pre_sizes}")
        print(f"  {'Styles':<25} {pre_styles:<12} {post_styles:<12} +{post_styles - pre_styles}")
        print(f"  {'Products (SKUs)':<25} {pre_products:<12} {post_products:<12} +{post_products - pre_products}")

        print(f"\n  🏷️ SUPPLIER FILTER TEST:")
        print(f"  Styles linked to '{SUPPLIER_NAME}': {abs_styles_count}")
        print(f"  Products linked to '{SUPPLIER_NAME}': {abs_products_count}")

        # ... (rest of report)
        print("\n" + "=" * 60)
        print("  ALL DONE!")
        print("=" * 60)

    except Exception as e:
        conn.rollback()
        print(f"\n  ❌❌❌ ERROR - TRANSACTION ROLLED BACK ❌❌❌")
        print(f"  Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
