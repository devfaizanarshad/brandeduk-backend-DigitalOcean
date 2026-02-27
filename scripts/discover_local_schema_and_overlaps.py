#!/usr/bin/env python3
"""
1. Discover how UNEEK data is stored locally (ecommerce DB) - schema, columns, table names
2. Find products that exist in BOTH catalogues (UNEEK vs Ralawise)
   - UNEEK ProductCode vs Ralawise style_code (exact match, no prefix)
   - UNEEK ShortCode vs Ralawise sku_code
   - UNEEK EAN vs Ralawise sku_code
No prefix assumptions - use supplier_id for identification.
"""

import json
import os
from pathlib import Path

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PG = True
except ImportError:
    HAS_PG = False

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
UNEEK_JSON = PROJECT_ROOT / "uneek_products_clean.json"

LOCAL_DB = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": int(os.getenv("PGPORT", 5432)),
    "database": os.getenv("PGDATABASE", "ecommerce"),
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD", "1234"),
    "connect_timeout": 5,
}

PROD_DB = {
    "host": os.getenv("DB_HOST", "206.189.119.150"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "database": os.getenv("DB_NAME", "brandeduk_prod"),
    "user": os.getenv("DB_USER", "brandeduk"),
    "password": os.getenv("DB_PASSWORD", "omglol123"),
    "sslmode": "require",
    "connect_timeout": 10,
}


def discover_local_schema():
    """Discover tables and columns in local ecommerce DB."""
    if not HAS_PG:
        return None, "psycopg2 not installed"

    try:
        conn = psycopg2.connect(**LOCAL_DB)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # All tables in public schema
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """)
        tables = [r["table_name"] for r in cur.fetchall()]

        # Columns for each table (especially product-related)
        table_columns = {}
        for t in tables:
            cur.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s
                ORDER BY ordinal_position;
            """, (t,))
            table_columns[t] = [(r["column_name"], r["data_type"]) for r in cur.fetchall()]

        # Row counts for product-like tables
        row_counts = {}
        for t in tables:
            if "product" in t.lower() or "uneek" in t.lower() or t in ("products", "styles"):
                try:
                    cur.execute(f'SELECT COUNT(*) as cnt FROM "{t}"')
                    row_counts[t] = cur.fetchone()["cnt"]
                except Exception as e:
                    row_counts[t] = f"error: {e}"

        cur.close()
        conn.close()

        return {
            "tables": tables,
            "columns": table_columns,
            "row_counts": row_counts,
        }, None

    except Exception as e:
        return None, str(e)


def get_local_uneek_identifiers():
    """Get all identifiers from local DB that could match UNEEK data.
    Use discovered schema - no hardcoded column names.
    """
    if not HAS_PG:
        return None, "psycopg2 not installed"

    schema, err = discover_local_schema()
    if err or not schema:
        return None, err or "Could not get schema"

    conn = psycopg2.connect(**LOCAL_DB)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    result = {"table": None, "columns_used": [], "product_codes": set(), "shortcodes": set(), "eans": set(), "row_count": 0}

    # Find table with UNEEK-like columns (ProductCode, ShortCode, EAN, tax_code, etc.)
    for t, cols in schema["columns"].items():
        col_names = [c[0].lower() for c in cols]
        # UNEEK JSON has: ProductCode, ShortCode, EAN, TaxCode
        has_product_code = "productcode" in col_names or "product_code" in col_names
        has_short_code = "shortcode" in col_names or "short_code" in col_names
        has_ean = "ean" in col_names
        has_tax = "taxcode" in col_names or "tax_code" in col_names

        if has_product_code or has_short_code or has_ean or has_tax:
            result["table"] = t
            col_map = {c[0].lower(): c[0] for c in cols}

            pc_col = col_map.get("productcode") or col_map.get("product_code")
            sc_col = col_map.get("shortcode") or col_map.get("short_code")
            ean_col = col_map.get("ean")

            if pc_col:
                result["columns_used"].append(pc_col)
            if sc_col:
                result["columns_used"].append(sc_col)
            if ean_col:
                result["columns_used"].append(ean_col)

            select_cols = [c for c in [pc_col, sc_col, ean_col] if c]
            if not select_cols:
                continue

            try:
                col_list = ", ".join(f'"{c}"' for c in select_cols)
                sql = f'SELECT {col_list} FROM "{t}"'
                cur.execute(sql)
                rows = cur.fetchall()
                result["row_count"] = len(rows)

                for r in rows:
                    if pc_col and r.get(pc_col):
                        result["product_codes"].add(str(r[pc_col]).strip())
                    if sc_col and r.get(sc_col):
                        result["shortcodes"].add(str(r[sc_col]).strip())
                    if ean_col and r.get(ean_col):
                        result["eans"].add(str(r[ean_col]).strip().lstrip("0") or str(r[ean_col]).strip())

                break
            except Exception as e:
                result["error"] = str(e)
                continue

    cur.close()
    conn.close()
    return result, None


def fetch_ralawise_identifiers():
    """Get style_codes and sku_codes from production Ralawise."""
    if not HAS_PG:
        return None, "psycopg2 not installed"

    try:
        conn = psycopg2.connect(**PROD_DB)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT DISTINCT style_code FROM products WHERE sku_status = 'Live' AND style_code IS NOT NULL;
        """)
        style_codes = {str(r["style_code"]).strip() for r in cur.fetchall()}

        cur.execute("""
            SELECT sku_code FROM products WHERE sku_status = 'Live';
        """)
        sku_codes = {str(r["sku_code"]).strip() for r in cur.fetchall()}

        cur.close()
        conn.close()

        return {"style_codes": style_codes, "sku_codes": sku_codes}, None

    except Exception as e:
        return None, str(e)


def load_uneek_identifiers():
    """Load UNEEK identifiers from JSON."""
    with open(UNEEK_JSON, "r", encoding="utf-8") as f:
        products = json.load(f)

    product_codes = set()
    shortcodes = set()
    eans = set()

    for p in products:
        if p.get("ProductCode"):
            product_codes.add(str(p["ProductCode"]).strip())
        if p.get("ShortCode"):
            shortcodes.add(str(p["ShortCode"]).strip())
        if p.get("EAN"):
            eans.add(str(p["EAN"]).strip())

    return {"product_codes": product_codes, "shortcodes": shortcodes, "eans": eans}


def find_overlaps(uneek_ids, ralawise_ids):
    """Find exact matches between UNEEK and Ralawise identifiers."""
    overlaps = {
        "product_code_in_ralawise_style_codes": sorted(uneek_ids["product_codes"] & ralawise_ids["style_codes"]),
        "shortcode_in_ralawise_sku_codes": sorted(uneek_ids["shortcodes"] & ralawise_ids["sku_codes"]),
        "ean_in_ralawise_sku_codes": sorted(uneek_ids["eans"] & ralawise_ids["sku_codes"]),
    }
    # Also check reverse: does any Ralawise style_code exist in UNEEK ProductCode?
    overlaps["ralawise_style_code_in_uneek_product_codes"] = sorted(
        ralawise_ids["style_codes"] & uneek_ids["product_codes"]
    )
    return overlaps


def main():
    print("=" * 80)
    print("1. LOCAL SCHEMA DISCOVERY (ecommerce DB)")
    print("=" * 80)

    schema, err = discover_local_schema()
    if err:
        print(f"Error: {err}")
        return

    print("\nTables:", schema["tables"])
    print("\nRow counts (product-related):", schema["row_counts"])
    print("\nColumns per table (product/uneek related):")
    for t in schema["tables"]:
        if "product" in t.lower() or "uneek" in t.lower() or t in ("products", "styles"):
            print(f"\n  [{t}]")
            for col, dtype in schema["columns"][t]:
                print(f"    - {col} ({dtype})")

    print("\n" + "-" * 80)
    print("2. LOCAL UNEEK DATA (how it's stored)")
    print("-" * 80)

    local_uneek, err = get_local_uneek_identifiers()
    if err:
        print(f"Error: {err}")
    elif local_uneek and local_uneek.get("table"):
        print(f"Table: {local_uneek['table']}")
        print(f"Columns used: {local_uneek['columns_used']}")
        print(f"Row count: {local_uneek['row_count']}")
        print(f"Unique ProductCodes: {len(local_uneek['product_codes'])}")
        print(f"Unique ShortCodes: {len(local_uneek['shortcodes'])}")
        print(f"Unique EANs: {len(local_uneek['eans'])}")
        if local_uneek.get("product_codes"):
            print(f"Sample ProductCodes: {list(local_uneek['product_codes'])[:10]}")
        if local_uneek.get("shortcodes"):
            print(f"Sample ShortCodes: {list(local_uneek['shortcodes'])[:10]}")
    else:
        print("No UNEEK-like table found. Tables/columns may use different naming.")

    print("\n" + "-" * 80)
    print("3. OVERLAP: Products in BOTH catalogues (exact match, no prefix)")
    print("-" * 80)

    uneek_ids = load_uneek_identifiers()
    ralawise_ids, ral_err = fetch_ralawise_identifiers()

    if ral_err:
        print(f"Could not fetch Ralawise: {ral_err}")
        return

    overlaps = find_overlaps(uneek_ids, ralawise_ids)

    print("\nUNEEK ProductCode in Ralawise style_codes:", len(overlaps["product_code_in_ralawise_style_codes"]))
    if overlaps["product_code_in_ralawise_style_codes"]:
        print("  Matches:", overlaps["product_code_in_ralawise_style_codes"])

    print("\nUNEEK ShortCode in Ralawise sku_codes:", len(overlaps["shortcode_in_ralawise_sku_codes"]))
    if overlaps["shortcode_in_ralawise_sku_codes"]:
        print("  Matches:", overlaps["shortcode_in_ralawise_sku_codes"][:20], "..." if len(overlaps["shortcode_in_ralawise_sku_codes"]) > 20 else "")

    print("\nUNEEK EAN in Ralawise sku_codes:", len(overlaps["ean_in_ralawise_sku_codes"]))
    if overlaps["ean_in_ralawise_sku_codes"]:
        print("  Matches:", overlaps["ean_in_ralawise_sku_codes"][:20], "..." if len(overlaps["ean_in_ralawise_sku_codes"]) > 20 else "")

    print("\nRalawise style_code in UNEEK ProductCodes:", len(overlaps["ralawise_style_code_in_uneek_product_codes"]))
    if overlaps["ralawise_style_code_in_uneek_product_codes"]:
        print("  Matches:", overlaps["ralawise_style_code_in_uneek_product_codes"])

    total_overlap = sum(len(v) for v in overlaps.values() if isinstance(v, list))
    print("\n" + "=" * 80)
    if total_overlap == 0:
        print("RESULT: No exact identifier overlap. ProductCode/style_code can stay as-is; use supplier_id.")
    else:
        print(f"RESULT: {total_overlap} overlaps found. Review above before merge.")
    print("=" * 80)


if __name__ == "__main__":
    main()
