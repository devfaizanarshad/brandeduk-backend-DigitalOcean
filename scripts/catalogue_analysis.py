#!/usr/bin/env python3
"""
UNEEK vs Ralawise Catalogue Analysis
- Analyzes uneek_products_clean.json structure
- Verifies local DB load
- Compares UNEEK vs Ralawise catalogues
- Integration feasibility assessment
"""

import json
import os
import re
from collections import defaultdict
from pathlib import Path

# Optional: psycopg2 for DB connections
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PG = True
except ImportError:
    HAS_PG = False

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
UNEEK_JSON = PROJECT_ROOT / "uneek_products_clean.json"

# DB configs
LOCAL_DB = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": int(os.getenv("PGPORT", 5432)),
    "database": os.getenv("PGDATABASE", "ecommerce"),
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD", "1234"),
}

PROD_DB = {
    "host": os.getenv("DB_HOST", "206.189.119.150"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "database": os.getenv("DB_NAME", "brandeduk_prod"),
    "user": os.getenv("DB_USER", "brandeduk"),
    "password": os.getenv("DB_PASSWORD", "omglol123"),
    "sslmode": "require",
}


def load_uneek_json():
    """Load and return UNEEK products from JSON."""
    with open(UNEEK_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def analyze_uneek_structure(products):
    """Analyze UNEEK JSON structure and produce stats."""
    stats = {
        "total_skus": len(products),
        "fields": list(products[0].keys()) if products else [],
        "categories": defaultdict(int),
        "brands": defaultdict(int),
        "unique_product_codes": set(),
        "unique_product_names": set(),
        "unique_eans": set(),
        "unique_shortcodes": set(),
        "sample_record": products[0] if products else None,
    }

    for p in products:
        stats["categories"][p.get("Category", "N/A")] += 1
        stats["brands"][p.get("Company", "N/A")] += 1
        stats["unique_product_codes"].add(p.get("ProductCode"))
        stats["unique_product_names"].add(p.get("ProductName"))
        stats["unique_eans"].add(str(p.get("EAN", "")))
        stats["unique_shortcodes"].add(p.get("ShortCode", ""))

    stats["unique_styles"] = len(stats["unique_product_codes"])
    stats["categories"] = dict(stats["categories"])
    stats["brands"] = dict(stats["brands"])
    return stats


def verify_local_db_load(uneek_products):
    """Check if UNEEK data was loaded into local DB. Returns (loaded_count, expected, missing_info)."""
    if not HAS_PG:
        return None, len(uneek_products), "psycopg2 not installed - pip install psycopg2-binary"

    try:
        local_with_timeout = {**LOCAL_DB, "connect_timeout": 3}
        conn = psycopg2.connect(**local_with_timeout)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Discover tables - try common names
        cur.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            AND (table_name ILIKE '%uneek%' OR table_name ILIKE '%product%')
            ORDER BY table_name;
        """)
        tables = [r["table_name"] for r in cur.fetchall()]

        uneek_eans = {str(p.get("EAN", "")) for p in uneek_products if p.get("EAN")}
        uneek_shortcodes = {p.get("ShortCode", "") for p in uneek_products if p.get("ShortCode")}

        result = {"tables_found": tables, "expected_skus": len(uneek_products)}

        # Try products table with sku_code or style_code
        cur.execute("SELECT COUNT(*) as cnt FROM products")
        products_count = cur.fetchone()["cnt"]

        cur.execute("SELECT sku_code FROM products LIMIT 5")
        sample_skus = [r["sku_code"] for r in cur.fetchall()]

        # Check for UNEEK identifiers (ShortCode format like GR11BGXS, or EAN)
        cur.execute("SELECT sku_code FROM products")
        db_skus = {r["sku_code"] for r in cur.fetchall()}

        overlap_shortcode = len(db_skus & uneek_shortcodes)
        overlap_ean = 0
        if any(s.isdigit() and len(s) == 13 for s in db_skus):
            overlap_ean = len(db_skus & uneek_eans)

        result["products_count"] = products_count
        result["sample_skus"] = sample_skus
        result["matching_shortcodes"] = overlap_shortcode
        result["matching_eans"] = overlap_ean

        # Try uneek_products if exists
        if "uneek_products" in [t.lower() for t in tables]:
            cur.execute("SELECT COUNT(*) as cnt FROM uneek_products")
            uneek_table_count = cur.fetchone()["cnt"]
            result["uneek_products_count"] = uneek_table_count
        else:
            result["uneek_products_count"] = None

        cur.close()
        conn.close()
        return result, len(uneek_products), None

    except Exception as e:
        return None, len(uneek_products), str(e)


def fetch_ralawise_catalogue():
    """Fetch Ralawise product catalogue from production DB."""
    if not HAS_PG:
        return None, "psycopg2 not installed"

    try:
        conn = psycopg2.connect(
            host=PROD_DB["host"],
            port=PROD_DB["port"],
            dbname=PROD_DB["database"],
            user=PROD_DB["user"],
            password=PROD_DB["password"],
            sslmode="require",
            connect_timeout=5,
        )
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT p.id, p.sku_code, p.style_code, p.colour_name, p.single_price,
                   s.style_name, s.style_code as s_style_code
            FROM products p
            LEFT JOIN styles s ON p.style_code = s.style_code
            WHERE p.sku_status = 'Live'
            LIMIT 50000;
        """)
        products = cur.fetchall()

        cur.execute("SELECT style_code, style_name FROM styles")
        styles = {r["style_code"]: r["style_name"] for r in cur.fetchall()}

        cur.execute("SELECT COUNT(*) as cnt FROM products WHERE sku_status = 'Live'")
        total_products = cur.fetchone()["cnt"]

        cur.execute("SELECT COUNT(DISTINCT style_code) as cnt FROM products WHERE sku_status = 'Live'")
        total_styles = cur.fetchone()["cnt"]

        cur.close()
        conn.close()

        return {
            "products": products,
            "styles": styles,
            "total_products": total_products,
            "total_styles": total_styles,
        }, None

    except Exception as e:
        return None, str(e)


def normalize_name(s):
    """Normalize product name for fuzzy matching."""
    if not s:
        return ""
    s = re.sub(r"[^a-z0-9\s]", "", str(s).lower())
    return " ".join(s.split())


def find_similarities(uneek_products, ralawise_data):
    """Find products that appear in both catalogues (by name, EAN, or style code)."""
    if not ralawise_data:
        return {}

    ralawise_products = ralawise_data["products"]
    ralawise_skus = {r["sku_code"].strip().upper() for r in ralawise_products}
    ralawise_style_codes = {r["style_code"].strip().upper() for r in ralawise_products if r["style_code"]}
    ralawise_style_names_norm = {normalize_name(r["style_name"]): r for r in ralawise_products if r["style_name"]}
    ralawise_style_names = {r["style_name"].lower().strip(): r for r in ralawise_products if r["style_name"]}

    uneek_eans = {str(p.get("EAN", "")).strip() for p in uneek_products if p.get("EAN")}
    uneek_shortcodes = {p.get("ShortCode", "").strip().upper() for p in uneek_products if p.get("ShortCode")}
    uneek_product_codes = {p.get("ProductCode", "").strip().upper() for p in uneek_products}
    uneek_product_names_norm = {normalize_name(p.get("ProductName", "")): p for p in uneek_products}

    matches = {
        "by_ean": [],
        "by_shortcode_sku": [],
        "by_style_code": [],
        "by_product_name_fuzzy": [],
    }

    # EAN match
    for ean in uneek_eans:
        if ean in ralawise_skus or ean in [r["sku_code"] for r in ralawise_products]:
            matches["by_ean"].append(ean)

    # ShortCode vs sku_code
    for sc in uneek_shortcodes:
        if sc in ralawise_skus:
            matches["by_shortcode_sku"].append(sc)

    # ProductCode (style) match
    for pc in uneek_product_codes:
        if pc in ralawise_style_codes:
            matches["by_style_code"].append(pc)

    # Fuzzy name match - exact normalized
    for norm_name, uneek_p in uneek_product_names_norm.items():
        if not norm_name or len(norm_name) < 5:
            continue
        for ral_name, ral_p in ralawise_style_names_norm.items():
            if norm_name == ral_name or (norm_name in ral_name or ral_name in norm_name):
                matches["by_product_name_fuzzy"].append({
                    "uneek": uneek_p["ProductName"],
                    "ralawise": ral_p.get("style_name", ""),
                    "uneek_code": uneek_p.get("ProductCode"),
                    "ralawise_style": ral_p.get("style_code"),
                })
                break

    return matches


def integration_assessment(uneek_stats, ralawise_data, similarities):
    """Assess how easy it would be to add UNEEK to Ralawise catalogue."""
    issues = []
    recommendations = []

    # Schema lacks supplier_id
    issues.append(
        "CRITICAL: Current schema has NO supplier_id. products, styles, and brands tables "
        "do not track supplier. After merge, you CANNOT distinguish Ralawise vs UNEEK products."
    )
    recommendations.append(
        "Add suppliers table and supplier_id to products/styles/brands BEFORE merging. "
        "Example: suppliers(id, name, slug) with RALAWISE, UNEEK."
    )

    # Data structure differences
    issues.append(
        "UNEEK uses ProductCode+ShortCode+EAN. Ralawise uses style_code+sku_code. "
        "Need mapping logic and possibly prefix (e.g. UNEEK- prefixed style_code to avoid collisions)."
    )
    recommendations.append(
        "Use supplier-specific prefixes: UNEEK style_code = 'UNE-' + ProductCode, "
        "sku_code = ShortCode or EAN. This preserves traceability."
    )

    # Category mapping
    uneek_cats = set(uneek_stats["categories"].keys())
    issues.append(
        f"UNEEK categories ({uneek_cats}) may not map 1:1 to Ralawise categories. "
        "Need category mapping table."
    )
    recommendations.append(
        "Create category_mapping(supplier, supplier_category, internal_category_id) for UNEEK->Ralawise."
    )

    # Similar products
    dup_count = (
        len(similarities.get("by_ean", []))
        + len(similarities.get("by_shortcode_sku", []))
        + len(similarities.get("by_style_code", []))
    )
    if dup_count > 0:
        issues.append(
            f"Found {dup_count} potential overlaps (same EAN/style). "
            "Decide: keep both (different suppliers) or deduplicate."
        )
        recommendations.append(
            "For same product from both suppliers: use supplier_id + external_sku. "
            "Allow multiple supplier SKUs per internal product for price comparison."
        )
    else:
        recommendations.append("No strong overlap found. UNEEK products appear distinct - safe to add as new.")

    return {"issues": issues, "recommendations": recommendations}


def main():
    import sys
    json_only = "--json-only" in sys.argv

    print("=" * 80, flush=True)
    print("UNEEK vs RALAWISE CATALOGUE ANALYSIS")
    print("=" * 80)

    # 1. Load and analyze UNEEK JSON
    print("\n[1] Loading uneek_products_clean.json...")
    uneek_products = load_uneek_json()
    uneek_stats = analyze_uneek_structure(uneek_products)

    print(f"\n--- UNEEK JSON Structure ---")
    print(f"Total SKUs: {uneek_stats['total_skus']}")
    print(f"Unique product designs (ProductCode): {uneek_stats['unique_styles']}")
    print(f"Fields: {uneek_stats['fields'][:15]}... ({len(uneek_stats['fields'])} total)")

    print(f"\n--- Products per Category ---")
    for cat, cnt in sorted(uneek_stats["categories"].items(), key=lambda x: -x[1]):
        print(f"  {cat}: {cnt}")

    print(f"\n--- Brand(s) and Product Count ---")
    for brand, cnt in uneek_stats["brands"].items():
        print(f"  {brand}: {cnt} products")

    # 2. Verify local DB load
    if json_only:
        print("\n[2] Skipping DB verification (--json-only mode)")
        db_result, expected, err = None, uneek_stats["total_skus"], "Skipped"
    else:
        print("\n" + "-" * 80)
        print("[2] Verifying local DB load (localhost / ecommerce / postgres)...")
        db_result, expected, err = verify_local_db_load(uneek_products)
    if err:
        print(f"  Could not verify: {err}")
        if "psycopg2" in err.lower():
            print("  Install: pip install psycopg2-binary")
    elif db_result:
        print(f"  Tables found: {db_result.get('tables_found', [])}")
        print(f"  Expected UNEEK SKUs: {expected}")
        print(f"  products table row count: {db_result.get('products_count', 'N/A')}")
        if db_result.get("uneek_products_count") is not None:
            print(f"  uneek_products table count: {db_result['uneek_products_count']}")
        print(f"  Matching ShortCodes in DB: {db_result.get('matching_shortcodes', 0)}")
        print(f"  Matching EANs in DB: {db_result.get('matching_eans', 0)}")
        if db_result.get("products_count", 0) == expected:
            print("  --> Load appears COMPLETE (row count matches)")
        elif db_result.get("products_count", 0) > 0:
            print(f"  --> Load PARTIAL or DB has other data. Expected {expected}, got {db_result.get('products_count')}")
        else:
            print("  --> No UNEEK data found in products table. Check table name or load script.")
    else:
        print("  No DB result returned.")

    # 3. Fetch Ralawise catalogue
    if json_only:
        print("\n[3] Skipping Ralawise fetch (--json-only mode)")
        ralawise_data, ral_err = None, "Skipped"
    else:
        print("\n" + "-" * 80)
        print("[3] Fetching Ralawise catalogue from production DB...")
        ralawise_data, ral_err = fetch_ralawise_catalogue()
    if ral_err:
        print(f"  Could not connect: {ral_err}")
        print("  (Network/firewall or credentials. Continuing with JSON-only analysis.)")
        ralawise_data = None
    else:
        print(f"  Ralawise products (Live): {ralawise_data['total_products']}")
        print(f"  Ralawise unique styles: {ralawise_data['total_styles']}")

    # 4. Find similarities
    print("\n" + "-" * 80)
    print("[4] Comparing UNEEK vs Ralawise catalogues...")
    similarities = find_similarities(uneek_products, ralawise_data)
    print(f"  Matches by EAN: {len(similarities.get('by_ean', []))}")
    print(f"  Matches by ShortCode/SKU: {len(similarities.get('by_shortcode_sku', []))}")
    print(f"  Matches by style code: {len(similarities.get('by_style_code', []))}")
    print(f"  Fuzzy name matches: {len(similarities.get('by_product_name_fuzzy', []))}")
    if similarities.get("by_product_name_fuzzy"):
        print("  Sample fuzzy matches:")
        for m in similarities["by_product_name_fuzzy"][:5]:
            print(f"    UNEEK '{m.get('uneek')}' <-> Ralawise '{m.get('ralawise')}'")

    # 5. Integration assessment
    print("\n" + "-" * 80)
    print("[5] Integration Assessment: Adding UNEEK to Ralawise catalogue")
    assessment = integration_assessment(uneek_stats, ralawise_data, similarities)
    print("\n  ISSUES:")
    for i, issue in enumerate(assessment["issues"], 1):
        print(f"    {i}. {issue}")
    print("\n  RECOMMENDATIONS:")
    for i, rec in enumerate(assessment["recommendations"], 1):
        print(f"    {i}. {rec}")

    # 6. Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"UNEEK: {uneek_stats['total_skus']} SKUs, {uneek_stats['unique_styles']} styles, 1 brand (Uneek Clothing)")
    print(f"Categories: {len(uneek_stats['categories'])}")
    if ralawise_data:
        print(f"Ralawise: {ralawise_data['total_products']} products, {ralawise_data['total_styles']} styles")
    print("\nTo identify products by supplier: add supplier_id to schema before merge.")
    print("=" * 80)


if __name__ == "__main__":
    main()
