"""
=============================================================
  DEEP CATEGORY MAPPING & INTEGRATION PLAN
  Maps Absolute Apparel categories to existing DB product types
  Verifies style code overlaps with certainty
  Outputs a full integration plan
=============================================================
"""

import json
import os
import sys
import re
from collections import Counter, defaultdict

try:
    import psycopg2
except ImportError:
    os.system(f"{sys.executable} -m pip install psycopg2-binary")
    import psycopg2

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "brandeduk_ralawise_backup",
    "user": "postgres",
    "password": "1234",
}

ABSOLUTE_JSON = os.path.join(os.path.dirname(__file__), '..', 'absolute_products_clean.json')
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'integration_plan.txt')


def main():
    report = []
    r = report.append

    # Connect to DB
    print("[1] Connecting to database...")
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = True
    cur = conn.cursor()

    # Load Absolute JSON
    print("[2] Loading Absolute Apparel data...")
    with open(ABSOLUTE_JSON, 'r', encoding='utf-8') as f:
        abs_data = json.load(f)
    abs_products = abs_data['products']

    # ================================================================
    # PART 1: Get ALL existing DB product types with examples
    # ================================================================
    print("[3] Loading DB product types, categories, styles...")

    cur.execute("""
        SELECT pt.id, pt.name, pt.slug, COUNT(DISTINCT s.style_code) as style_count
        FROM product_types pt
        LEFT JOIN styles s ON s.product_type_id = pt.id
        GROUP BY pt.id, pt.name, pt.slug
        ORDER BY style_count DESC;
    """)
    db_product_types = cur.fetchall()  # (id, name, slug, count)

    # Get sample styles per product type
    cur.execute("""
        SELECT s.style_code, s.style_name, pt.name as product_type
        FROM styles s
        JOIN product_types pt ON s.product_type_id = pt.id
        ORDER BY pt.name, s.style_code;
    """)
    db_styles_with_types = cur.fetchall()

    # Get ALL style codes from DB
    cur.execute("SELECT style_code FROM styles;")
    all_db_style_codes = set(row[0].upper().strip() for row in cur.fetchall() if row[0])

    # Get all categories
    cur.execute("""
        SELECT c.id, c.name, c.slug, c.parent_id, c.category_type
        FROM categories c ORDER BY c.name;
    """)
    db_categories = cur.fetchall()

    # Get all brands
    cur.execute("SELECT id, name, slug FROM brands ORDER BY name;")
    db_brands = cur.fetchall()

    # Get suppliers
    cur.execute("SELECT id, name FROM suppliers;")
    db_suppliers = cur.fetchall()

    # Get all colours
    cur.execute("SELECT id, name FROM colours ORDER BY name;")
    db_colours = cur.fetchall()
    db_colour_names = {c[1].lower().strip(): c[0] for c in db_colours}

    # Get all sizes
    cur.execute("SELECT id, name FROM sizes ORDER BY name;")
    db_sizes = cur.fetchall()
    db_size_names = {s[1].lower().strip(): s[0] for s in db_sizes}

    conn.close()

    # ================================================================
    # PART 2: STYLE CODE OVERLAP - DEFINITIVE CHECK
    # ================================================================
    r("=" * 70)
    r("  PART 1: STYLE CODE OVERLAP - DEFINITIVE VERIFICATION")
    r("=" * 70)

    abs_style_codes = set(p['ProductCode'].upper().strip() for p in abs_products)

    overlap = all_db_style_codes & abs_style_codes
    r(f"DB Style Codes:         {len(all_db_style_codes)}")
    r(f"Absolute Style Codes:   {len(abs_style_codes)}")
    r(f"OVERLAPPING CODES:      {len(overlap)}")
    r("")

    if overlap:
        r("⚠️  WARNING: THE FOLLOWING CODES EXIST IN BOTH:")
        for code in sorted(overlap):
            r(f"   CONFLICT: {code}")
        r("")
        r("DECISION NEEDED:")
        r("  Option A: SKIP these products (don't import duplicates)")
        r("  Option B: UPDATE existing records with Absolute data")
        r("  Option C: Import with prefixed code (e.g. ABS-G5000)")
    else:
        r("✅ CONFIRMED: ZERO OVERLAP. All 741 Absolute codes are 100% NEW.")
        r("   Safe to import without any conflicts.")
    r("")

    # ================================================================
    # PART 3: CURRENT DB PRODUCT TYPES (Full List)
    # ================================================================
    r("=" * 70)
    r("  PART 2: ALL CURRENT DB PRODUCT TYPES")
    r("=" * 70)
    r(f"Total product types in DB: {len(db_product_types)}")
    r("")

    # Group styles by product type for examples
    styles_by_pt = defaultdict(list)
    for sc, sn, pt_name in db_styles_with_types:
        styles_by_pt[pt_name].append((sc, sn))

    for pt_id, pt_name, pt_slug, pt_count in db_product_types:
        r(f"  [{pt_id}] {pt_name} (slug: {pt_slug}) - {pt_count} styles")
        samples = styles_by_pt.get(pt_name, [])[:3]
        for sc, sn in samples:
            r(f"       Example: {sc} - {sn}")
    r("")

    # ================================================================
    # PART 4: ABSOLUTE CATEGORIES BREAKDOWN
    # ================================================================
    r("=" * 70)
    r("  PART 3: ABSOLUTE APPAREL CATEGORIES BREAKDOWN")
    r("=" * 70)

    # Parse the Absolute categories
    # Format: "T-Shirts Cotton Crew Neck S/S - 180gsm - 200gsm Mens (Unisex)\\Product Name"
    abs_cat_data = []
    for p in abs_products:
        full_cat = p.get('Category', '')
        parts = full_cat.split('\\')
        main_cat = parts[0].strip() if parts else ''
        sub_cat = parts[1].strip() if len(parts) > 1 else ''

        # Extract broad type (before the first " - " which usually has gsm info)
        broad_type = main_cat.split(' - ')[0].strip() if ' - ' in main_cat else main_cat

        # Extract gender/age from the category
        gender = 'Unisex'
        if 'Ladies' in main_cat:
            gender = 'Ladies'
        elif 'Kids' in main_cat or 'Baby' in main_cat:
            gender = 'Kids'
        elif 'Mens' in main_cat or 'Unisex' in main_cat:
            gender = 'Mens (Unisex)'

        # Extract GSM range
        gsm_match = re.findall(r'(\d+)gsm', main_cat)
        gsm_range = f"{gsm_match[0]}-{gsm_match[1]}gsm" if len(gsm_match) >= 2 else (f"{gsm_match[0]}gsm" if gsm_match else '')

        abs_cat_data.append({
            'product_code': p['ProductCode'],
            'full_category': main_cat,
            'broad_type': broad_type,
            'gender': gender,
            'gsm_range': gsm_range,
        })

    # Unique broad types
    abs_broad_types = Counter(d['broad_type'] for d in abs_cat_data)

    r(f"Total unique full categories: {len(set(d['full_category'] for d in abs_cat_data))}")
    r(f"Total unique broad types:     {len(abs_broad_types)}")
    r("")
    r("--- ALL BROAD TYPES FROM ABSOLUTE ---")
    for bt, count in abs_broad_types.most_common():
        r(f"  {bt:<55} {count} products")
    r("")

    # ================================================================
    # PART 5: SMART CATEGORY MAPPING
    # ================================================================
    r("=" * 70)
    r("  PART 4: SMART CATEGORY MAPPING (Absolute -> DB Product Types)")
    r("=" * 70)
    r("")
    r("This mapping assigns each Absolute broad type to the BEST matching")
    r("existing DB product type, or suggests creating a new one.")
    r("")

    # Build a lookup for DB product types
    db_pt_lookup = {}  # lowercase name -> (id, name, count)
    for pt_id, pt_name, pt_slug, pt_count in db_product_types:
        db_pt_lookup[pt_name.lower().strip()] = (pt_id, pt_name, pt_count)

    # Define manual/smart mapping rules
    # Key: pattern in absolute broad type (lowercase)
    # Value: DB product type name to map to
    MAPPING_RULES = {
        # T-Shirts
        't-shirts cotton crew neck s/s': 'T-Shirts',
        't-shirts cotton crew neck l/s': 'T-Shirts Long Sleeve',
        't-shirts cotton v-neck s/s': 'T-Shirts V-Neck',
        't-shirts polycotton crew neck s/s': 'T-Shirts',
        't-shirts polyester crew neck s/s': 'Performance T-Shirts',
        # Polos
        'polos cotton s/s': 'Polo Shirts',
        'polos cotton l/s': 'Long Sleeve Polo Shirts',
        'polos polycotton s/s': 'Polo Shirts',
        'polos polycotton l/s': 'Long Sleeve Polo Shirts',
        'polos polyester s/s': 'Performance Polo Shirts',
        # Sweats
        'sweats crew neck': 'Sweatshirts',
        'sweats full zip': 'Full Zip Sweatshirts',
        'sweats quarter zip': 'Quarter Zip Sweatshirts',
        # Hoodies
        'hoodies': 'Hoodies',
        'zip hoodies': 'Zipped Hoodies',
        # Fleece
        'outdoor fleece full zip': 'Fleece Jackets',
        'outdoor fleece quarter zip': 'Fleece Jackets',
        'outdoor fleece bodywarmers': 'Fleece Bodywarmers',
        # Softshell
        'softshell full zip': 'Softshell Jackets',
        'softshell bodywarmer': 'Softshell Bodywarmers',
        # Outerwear
        'outerwear insulated jackets': 'Jackets',
        'outerwear bodywarmers': 'Bodywarmers',
        'outerwear shell jackets': 'Waterproof Jackets',
        'outerwear 3in1 jackets': '3 in 1 Jackets',
        'outerwear hybrid jackets': 'Jackets',
        'outerwear hybrid bodywarmers': 'Bodywarmers',
        'outerwear rain suits': 'Waterproof Trousers',
        # Trousers/Shorts
        'workwear trousers': 'Trousers',
        'workwear shorts': 'Shorts',
        'jogpants': 'Joggers',
        'shorts': 'Shorts',
        # Shirts
        'shirts poplin s/s': 'Short Sleeve Shirts',
        'shirts poplin l/s': 'Long Sleeve Shirts',
        'shirts oxford s/s': 'Short Sleeve Shirts',
        'shirts oxford l/s': 'Long Sleeve Shirts',
        'shirts twill s/s': 'Short Sleeve Shirts',
        'shirts twill l/s': 'Long Sleeve Shirts',
        'shirts herringbone s/s': 'Short Sleeve Shirts',
        'shirts herringbone l/s': 'Long Sleeve Shirts',
        # Headwear
        'headwear': 'Caps & Hats',
        # Vests
        'vests & tanks cotton': 'Vests',
        # Workwear
        'workwear': 'Workwear',
        'workwear thermal underwear': 'Base Layers',
        # Knitwear
        'knitwear': 'Knitwear',
        # Hi-Vis
        # Accessories
        'accessories': 'Accessories',
        # Catering
        'catering & hospitality': 'Catering',
        # Baby
        'baby & toddler 180gsm': 'Baby & Toddler',
        # Consumables/Catalogues
        'consumables': None,  # Skip
        'catalogues': None,   # Skip
        'marketing': None,    # Skip
    }

    # Now do the mapping
    mapping_results = {}  # broad_type -> (db_pt_name, mapping_type, db_pt_id)
    new_types_needed = []

    for bt_lower in sorted(set(d['broad_type'].lower() for d in abs_cat_data)):
        bt_original = bt_lower
        # Find the best match
        matched = False

        # 1. Try exact mapping rules
        for pattern, db_name in MAPPING_RULES.items():
            if bt_lower.startswith(pattern) or pattern in bt_lower:
                if db_name is None:
                    mapping_results[bt_original] = (None, 'SKIP', None)
                else:
                    # Check if this DB name exists
                    db_pt = db_pt_lookup.get(db_name.lower())
                    if db_pt:
                        mapping_results[bt_original] = (db_pt[1], 'EXISTING', db_pt[0])
                    else:
                        mapping_results[bt_original] = (db_name, 'CREATE_NEW', None)
                matched = True
                break

        if not matched:
            # 2. Try fuzzy match with DB product types
            for db_name_lower, (pt_id, pt_name, pt_count) in db_pt_lookup.items():
                if (db_name_lower in bt_lower or bt_lower in db_name_lower or
                    bt_lower.split()[0] in db_name_lower):
                    mapping_results[bt_original] = (pt_name, 'FUZZY_MATCH', pt_id)
                    matched = True
                    break

        if not matched:
            # 3. Suggest as new
            suggested_name = bt_original.replace(' - ', ' ').title()
            mapping_results[bt_original] = (suggested_name, 'CREATE_NEW', None)
            new_types_needed.append(bt_original)

    # Display mapping
    r("  {:50s} {:5s} {:30s} {:10s}".format("ABSOLUTE BROAD TYPE", "COUNT", "-> DB PRODUCT TYPE", "ACTION"))
    r("  " + "-" * 100)

    for bt, count in abs_broad_types.most_common():
        bt_lower = bt.lower()
        if bt_lower in mapping_results:
            db_name, action, db_id = mapping_results[bt_lower]
            id_str = f"(id:{db_id})" if db_id else ""
            if db_name:
                r(f"  {bt:<50s} {count:<5d} -> {db_name:<30s} [{action}] {id_str}")
            else:
                r(f"  {bt:<50s} {count:<5d} -> SKIP (non-product item)")
        else:
            r(f"  {bt:<50s} {count:<5d} -> ??? UNMAPPED")
    r("")

    # Summary
    existing_count = sum(1 for v in mapping_results.values() if v[1] == 'EXISTING')
    fuzzy_count = sum(1 for v in mapping_results.values() if v[1] == 'FUZZY_MATCH')
    new_count = sum(1 for v in mapping_results.values() if v[1] == 'CREATE_NEW')
    skip_count = sum(1 for v in mapping_results.values() if v[1] == 'SKIP')

    r(f"  MAPPING SUMMARY:")
    r(f"    Mapped to EXISTING DB types:  {existing_count}")
    r(f"    Fuzzy matched:                {fuzzy_count}")
    r(f"    Need to CREATE NEW:           {new_count}")
    r(f"    SKIP (non-products):          {skip_count}")
    r("")

    # ================================================================
    # PART 6: BRAND MAPPING
    # ================================================================
    r("=" * 70)
    r("  PART 5: BRAND MAPPING")
    r("=" * 70)

    db_brand_lookup = {b[1].lower().strip(): (b[0], b[1]) for b in db_brands}
    abs_brand_counts = Counter(p.get('Manufacturer', 'Unknown') for p in abs_products)

    brand_mapping = {}
    for brand_name in abs_brand_counts.keys():
        bl = brand_name.lower().strip()
        if bl in db_brand_lookup:
            brand_mapping[brand_name] = ('EXISTING', db_brand_lookup[bl][0], db_brand_lookup[bl][1])
        else:
            brand_mapping[brand_name] = ('CREATE_NEW', None, brand_name)

    r(f"  {'ABSOLUTE BRAND':<35s} {'COUNT':<6s} {'ACTION':<12s} {'DB BRAND':<35s}")
    r("  " + "-" * 90)
    for brand, count in abs_brand_counts.most_common():
        action, db_id, db_name = brand_mapping[brand]
        id_str = f"(id:{db_id})" if db_id else ""
        r(f"  {brand:<35s} {count:<6d} {action:<12s} {db_name:<35s} {id_str}")
    r("")

    existing_brands = sum(1 for v in brand_mapping.values() if v[0] == 'EXISTING')
    new_brands = sum(1 for v in brand_mapping.values() if v[0] == 'CREATE_NEW')
    r(f"  Existing brands to reuse: {existing_brands}")
    r(f"  New brands to create:     {new_brands}")
    r("")

    # ================================================================
    # PART 7: COLOUR & SIZE DEDUP ANALYSIS
    # ================================================================
    r("=" * 70)
    r("  PART 6: COLOUR & SIZE DEDUPLICATION")
    r("=" * 70)

    abs_colours = set()
    abs_sizes = set()
    for p in abs_products:
        for s in p.get('SKUs', []):
            if s.get('Colour'):
                abs_colours.add(s['Colour'].strip())
            if s.get('Size'):
                abs_sizes.add(s['Size'].strip())

    # Colour matching
    colour_existing = set()
    colour_new = set()
    for c in abs_colours:
        if c.lower().strip() in db_colour_names:
            colour_existing.add(c)
        else:
            colour_new.add(c)

    r(f"  Absolute unique colours: {len(abs_colours)}")
    r(f"  Already in DB:           {len(colour_existing)}")
    r(f"  NEW colours to add:      {len(colour_new)}")
    r("")
    if colour_new:
        r("  New colours (first 30):")
        for c in sorted(colour_new)[:30]:
            r(f"    + {c}")
        if len(colour_new) > 30:
            r(f"    ... and {len(colour_new) - 30} more")
    r("")

    # Size matching
    size_existing = set()
    size_new = set()
    for s in abs_sizes:
        if s.lower().strip() in db_size_names:
            size_existing.add(s)
        else:
            size_new.add(s)

    r(f"  Absolute unique sizes: {len(abs_sizes)}")
    r(f"  Already in DB:         {len(size_existing)}")
    r(f"  NEW sizes to add:      {len(size_new)}")
    r("")
    if size_new:
        r("  New sizes:")
        for s in sorted(size_new):
            r(f"    + {s}")
    r("")

    # ================================================================
    # PART 8: FULL INTEGRATION PLAN
    # ================================================================
    r("=" * 70)
    r("  PART 7: FULL INTEGRATION PLAN")
    r("=" * 70)
    r("")
    r("  STEP 1: CREATE SUPPLIER")
    r("  ─────────────────────────")
    r("  INSERT INTO suppliers (name, slug) VALUES ('Absolute Apparel', 'absolute-apparel');")
    r("  This gives us a supplier_id to link all new styles to.")
    r("")

    r("  STEP 2: CREATE NEW BRANDS")
    r("  ─────────────────────────")
    r(f"  Create {new_brands} new brand records:")
    for brand, (action, db_id, db_name) in sorted(brand_mapping.items()):
        if action == 'CREATE_NEW':
            slug = re.sub(r'[^a-z0-9]+', '-', brand.lower().strip()).strip('-')
            r(f"    INSERT brands: name='{brand}', slug='{slug}'")
    r("")

    r("  STEP 3: CREATE NEW PRODUCT TYPES (if needed)")
    r("  ─────────────────────────────────────────────")
    for bt_lower, (db_name, action, db_id) in sorted(mapping_results.items()):
        if action == 'CREATE_NEW' and db_name:
            slug = re.sub(r'[^a-z0-9]+', '-', db_name.lower().strip()).strip('-')
            r(f"    INSERT product_types: name='{db_name}', slug='{slug}'")
    r("")

    r("  STEP 4: CREATE NEW COLOURS & SIZES")
    r("  ───────────────────────────────────")
    r(f"    Insert {len(colour_new)} new colours")
    r(f"    Insert {len(size_new)} new sizes")
    r("")

    r("  STEP 5: IMPORT STYLES (741 new style records)")
    r("  ──────────────────────────────────────────────")
    r("  For each Absolute product:")
    r("    - style_code = ProductCode")
    r("    - style_name = ProductName")
    r("    - brand_id = lookup from brands table")
    r("    - product_type_id = lookup from mapping above")
    r("    - gender_id = extract from category (Mens/Ladies/Kids)")
    r("    - specification = KeyFeatures joined as text")
    r("    - supplier_id = new Absolute Apparel supplier ID")
    r("    - external_style_code = ProductCode")
    r("")

    r("  STEP 6: IMPORT PRODUCTS/SKUs (28,986 records)")
    r("  ──────────────────────────────────────────────")
    r("  For each SKU in each Absolute product:")
    r("    - style_code = parent ProductCode")
    r("    - sku_code = SKU.StockCode")
    r("    - colour_name = SKU.Colour")
    r("    - colour_id = lookup from colours table")
    r("    - size_id = lookup from sizes table")
    r("    - single_price = SKU.Price")
    r("    - stock_quantity = SKU.Stock")
    r("    - primary_image_url = first image from parent")
    r("    - sku_status = 'Live' or 'Discontinued' based on SKU.Discontinued")
    r("    - external_sku = SKU.BarCode")
    r("")

    r("  STEP 7: LINK CATEGORIES")
    r("  ───────────────────────")
    r("  Insert into product_categories to link styles to categories.")
    r("")

    r("  STEP 8: APPLY PRICING RULES")
    r("  ───────────────────────────")
    r("  Run existing pricing engine to calculate sell_price for new products.")
    r("  NOTE: Absolute only has single_price (no carton/pack tiers).")
    r("  Set carton_price = pack_price = single_price = SKU.Price")
    r("")

    r("  SAFETY MEASURES:")
    r("  ────────────────")
    r("  1. Run the import script inside a TRANSACTION")
    r("  2. BACKUP the database before importing")
    r("  3. Validate counts after import")
    r("  4. Test the search view refreshes correctly")
    r("  5. Verify no existing records were modified")
    r("")
    r("=" * 70)
    r("  END OF INTEGRATION PLAN")
    r("=" * 70)

    # Save report
    full_report = "\n".join(report)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(full_report)
    print(f"\n✓ Report saved to: {OUTPUT_FILE}")
    print(full_report)


if __name__ == "__main__":
    main()
