"""
  FIXED MAPPING - Uses actual DB product type names
"""
import json, os, sys, re
from collections import Counter, defaultdict

try:
    import psycopg2
except ImportError:
    os.system(f"{sys.executable} -m pip install psycopg2-binary")
    import psycopg2

DB_CONFIG = {"host":"localhost","port":5432,"dbname":"brandeduk_ralawise_backup","user":"postgres","password":"1234"}
ABSOLUTE_JSON = os.path.join(os.path.dirname(__file__), '..', 'absolute_products_clean.json')
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'fixed_mapping.txt')

def main():
    report = []
    r = report.append

    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = True
    cur = conn.cursor()

    # Load all DB product types
    cur.execute("""
        SELECT pt.id, pt.name, pt.slug, COUNT(DISTINCT s.style_code) as cnt
        FROM product_types pt
        LEFT JOIN styles s ON s.product_type_id = pt.id
        GROUP BY pt.id, pt.name, pt.slug ORDER BY cnt DESC;
    """)
    db_product_types = cur.fetchall()

    # Build lookup: lowercase name -> (id, name, count)
    db_pt_by_name = {}
    for pt_id, pt_name, pt_slug, cnt in db_product_types:
        db_pt_by_name[pt_name.lower()] = (pt_id, pt_name, cnt)

    conn.close()

    # Load Absolute JSON
    with open(ABSOLUTE_JSON, 'r', encoding='utf-8') as f:
        abs_data = json.load(f)
    abs_products = abs_data['products']

    # Extract broad types from Absolute categories
    abs_broad_types = Counter()
    for p in abs_products:
        cat = p.get('Category', '')
        main_cat = cat.split('\\')[0].strip()
        broad = main_cat.split(' - ')[0].strip() if ' - ' in main_cat else main_cat
        abs_broad_types[broad] += 1

    r("=" * 90)
    r("  EXISTING DB PRODUCT TYPES (for reference)")
    r("=" * 90)
    for pt_id, pt_name, pt_slug, cnt in db_product_types:
        r(f"  [{pt_id:>3}] {pt_name:<45} slug: {pt_slug:<35} {cnt} styles")
    r("")

    # ================================================================
    # CORRECTED MAPPING - Using ACTUAL DB names
    # ================================================================
    # Map absolute broad type -> actual DB product type name (exact as in DB)
    CORRECTED_MAP = {
        # Headwear -> existing Caps (id:21), Beanies (id:8), Hats (id:46)
        'headwear': 'Caps',  # Main headwear goes to Caps (348 styles already)

        # T-Shirts -> T-shirts (id:93)
        't-shirts cotton crew neck s/s': 'T-shirts',
        't-shirts cotton crew neck l/s': 'T-shirts',  # Long sleeve still T-shirts
        't-shirts cotton v-neck s/s': 'T-shirts',
        't-shirts polycotton crew neck s/s': 'T-shirts',
        't-shirts polyester crew neck s/s': 'T-shirts',

        # Polos -> Polos (id:66) - ALREADY EXISTS!
        'polos cotton s/s': 'Polos',
        'polos cotton l/s': 'Polos',
        'polos polycotton s/s': 'Polos',
        'polos polycotton l/s': 'Polos',
        'polos polyester s/s': 'Polos',

        # Sweats -> Sweatshirts (id:92)
        'sweats crew neck': 'Sweatshirts',
        'sweats full zip': 'Sweatshirts',
        'sweats quarter zip': 'Sweatshirts',

        # Hoodies -> Hoodies (id:49)
        'hoodies': 'Hoodies',
        'zip hoodies': 'Hoodies',

        # Fleece -> Fleece (id:38) - ALREADY EXISTS!
        'outdoor fleece full zip': 'Fleece',
        'outdoor fleece quarter zip': 'Fleece',
        'outdoor fleece bodywarmers': 'Fleece',

        # Softshell -> Softshells (id:87) - ALREADY EXISTS!
        'softshell full zip': 'Softshells',
        'softshell bodywarmer': 'Softshells',

        # Jackets -> Jackets (id:51)
        'outerwear insulated jackets': 'Jackets',
        'outerwear shell jackets': 'Jackets',
        'outerwear 3in1 jackets': 'Jackets',
        'outerwear hybrid jackets': 'Jackets',
        'outerwear rain suits': 'Jackets',

        # Bodywarmers -> Gilets & Body Warmers (id:41)
        'outerwear bodywarmers': 'Gilets & Body Warmers',
        'outerwear hybrid bodywarmers': 'Gilets & Body Warmers',

        # Jogpants -> Sweatpants (id:91)
        'jogpants': 'Sweatpants',

        # Shorts -> Shorts (id:79)
        'shorts': 'Shorts',

        # Trousers -> Trousers (id:101)
        'workwear trousers': 'Trousers',

        # Workwear Shorts -> Shorts (id:79)
        'workwear shorts': 'Shorts',

        # Shirts -> Shirts (id:77) - ALREADY EXISTS!
        'shirts poplin s/s': 'Shirts',
        'shirts poplin l/s': 'Shirts',
        'shirts oxford s/s': 'Shirts',
        'shirts oxford l/s': 'Shirts',
        'shirts twill s/s': 'Shirts',
        'shirts twill l/s': 'Shirts',
        'shirts herringbone s/s': 'Shirts',
        'shirts herringbone l/s': 'Shirts',

        # Vests -> Vests (t-shirt) (id:105) 
        'vests & tanks cotton': 'Vests (t-shirt)',

        # Accessories -> Accessories (id:1)
        'accessories': 'Accessories',

        # Knitwear -> Knitted Jumpers (id:55)
        'knitwear': 'Knitted Jumpers',

        # Workwear -> Trousers or stay with base layers etc.
        'workwear': 'Trousers',  # Most workwear items are trousers/coveralls
        'workwear thermal underwear': 'Baselayers',

        # Catering -> Aprons (id:2) - closest match
        'catering & hospitality': 'Aprons',

        # Baby -> Bodysuits (id:15) - closest match
        'baby & toddler 180gsm': 'Bodysuits',

        # Skip non-products
        'consumables': None,
        'catalogues': None,
        'marketing': None,
    }

    r("=" * 90)
    r("  CORRECTED CATEGORY MAPPING (Absolute -> Existing DB Product Types)")
    r("=" * 90)
    r("")
    r(f"  {'ABSOLUTE BROAD TYPE':<50} {'COUNT':<6} {'DB PRODUCT TYPE':<30} {'DB ID':<8} {'STATUS'}")
    r("  " + "-" * 110)

    mapped_existing = 0
    mapped_new = 0
    skipped = 0
    unmapped = 0

    for bt, count in abs_broad_types.most_common():
        bt_lower = bt.lower()
        matched = False

        for pattern, db_name in CORRECTED_MAP.items():
            if bt_lower.startswith(pattern) or pattern in bt_lower or bt_lower == pattern:
                if db_name is None:
                    r(f"  {bt:<50} {count:<6} {'SKIP':<30} {'---':<8} Non-product")
                    skipped += count
                    matched = True
                    break
                # Check if this name exists in DB
                db_pt = db_pt_by_name.get(db_name.lower())
                if db_pt:
                    r(f"  {bt:<50} {count:<6} {db_pt[1]:<30} id:{db_pt[0]:<5} ✅ EXISTING ({db_pt[2]} styles)")
                    mapped_existing += count
                else:
                    r(f"  {bt:<50} {count:<6} {db_name:<30} {'???':<8} ⚠️ NAME NOT FOUND IN DB!")
                    mapped_new += count
                matched = True
                break

        if not matched:
            r(f"  {bt:<50} {count:<6} {'???':<30} {'---':<8} ❌ UNMAPPED")
            unmapped += count

    r("")
    r("  SUMMARY:")
    r(f"    Products mapped to EXISTING types: {mapped_existing}")
    r(f"    Products SKIPPED (non-product):    {skipped}")
    r(f"    Products with name NOT FOUND:      {mapped_new}")
    r(f"    Products UNMAPPED:                 {unmapped}")
    r(f"    NEW PRODUCT TYPES TO CREATE:       0 (if all names match)")
    r("")

    # Verify all mapped names actually exist
    r("=" * 90)
    r("  VERIFICATION: Do all mapped DB names actually exist?")
    r("=" * 90)
    used_names = set()
    for pattern, db_name in CORRECTED_MAP.items():
        if db_name:
            used_names.add(db_name)

    for name in sorted(used_names):
        db_pt = db_pt_by_name.get(name.lower())
        if db_pt:
            r(f"  ✅ '{name}' -> Found as id:{db_pt[0]} ({db_pt[2]} existing styles)")
        else:
            r(f"  ❌ '{name}' -> NOT FOUND IN DB! Need to check exact name.")
            # Try fuzzy match
            for db_lower, (pid, pname, pcnt) in db_pt_by_name.items():
                if name.lower() in db_lower or db_lower in name.lower():
                    r(f"     💡 Possible match: '{pname}' (id:{pid})")

    r("")

    full_report = "\n".join(report)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(full_report)
    print(f"✓ Report saved to: {OUTPUT_FILE}")
    print(full_report)

if __name__ == "__main__":
    main()
