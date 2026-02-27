#!/usr/bin/env python3
"""
Verify UNEEK data:
1. BRA52-UneekProdData.csv (updated catalogue)
2. uneek_products_clean.json (original)
3. brandeduk_ralawise_backup (Ralawise backup with UNEEK merged)
4. ecommerce (local UNEEK DB - product_variants)
"""
import csv
import json
import os
from pathlib import Path

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PG = True
except ImportError:
    HAS_PG = False

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "BRA52-UneekProdData.csv"
JSON_PATH = ROOT / "uneek_products_clean.json"

BACKUP_DB = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": int(os.getenv("PGPORT", 5432)),
    "database": "brandeduk_ralawise_backup",
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD", "1234"),
}

ECOMMERCE_DB = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": int(os.getenv("PGPORT", 5432)),
    "database": "ecommerce",
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD", "1234"),
}


def load_csv_shortcodes():
    """Load Short Codes from CSV (column 'Short Code')."""
    shortcodes = set()
    product_codes = set()
    for enc in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
        try:
            with open(CSV_PATH, "r", encoding=enc) as f:
                r = csv.DictReader(f)
                for row in r:
                    sc = (row.get("Short Code") or "").strip()
                    pc = (row.get("Product Code") or "").strip()
                    if sc:
                        shortcodes.add(sc)
                    if pc:
                        product_codes.add(pc)
            return shortcodes, product_codes
        except UnicodeDecodeError:
            continue
    return shortcodes, product_codes


def load_json_shortcodes():
    """Load ShortCodes from JSON."""
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    shortcodes = {str(p.get("ShortCode", "")).strip() for p in data if p.get("ShortCode")}
    product_codes = {str(p.get("ProductCode", "")).strip() for p in data if p.get("ProductCode")}
    return shortcodes, product_codes


def get_backup_uneek_shortcodes():
    """Get UNEEK sku_codes from brandeduk_ralawise_backup."""
    if not HAS_PG:
        return set(), "psycopg2 not installed"
    try:
        conn = psycopg2.connect(**BACKUP_DB)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT p.sku_code
            FROM products p
            JOIN styles st ON p.style_code = st.style_code
            JOIN suppliers s ON st.supplier_id = s.id
            WHERE s.slug = 'uneek' AND p.sku_status = 'Live'
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {r["sku_code"].strip() for r in rows if r.get("sku_code")}, None
    except Exception as e:
        return set(), str(e)


def get_ecommerce_uneek_shortcodes():
    """Get short_code from ecommerce.product_variants."""
    if not HAS_PG:
        return set(), "psycopg2 not installed"
    try:
        conn = psycopg2.connect(**ECOMMERCE_DB)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute('SELECT short_code FROM product_variants')
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {str(r.get("short_code", "")).strip() for r in rows if r.get("short_code")}, None
    except Exception as e:
        return set(), str(e)


def main():
    print("=" * 80)
    print("UNEEK DATA VERIFICATION")
    print("=" * 80)

    # 1. Load CSV
    if not CSV_PATH.exists():
        print("\n[ERROR] BRA52-UneekProdData.csv not found")
        return
    csv_sc, csv_pc = load_csv_shortcodes()
    print(f"\n[1] BRA52-UneekProdData.csv (updated catalogue)")
    print(f"    ShortCodes (SKUs): {len(csv_sc)}")
    print(f"    ProductCodes (styles): {len(csv_pc)}")

    # 2. Load JSON
    if not JSON_PATH.exists():
        print("\n[ERROR] uneek_products_clean.json not found")
        return
    json_sc, json_pc = load_json_shortcodes()
    print(f"\n[2] uneek_products_clean.json (original)")
    print(f"    ShortCodes (SKUs): {len(json_sc)}")
    print(f"    ProductCodes (styles): {len(json_pc)}")

    # 3. CSV vs JSON
    print(f"\n[3] CSV vs JSON comparison")
    in_csv_not_json = csv_sc - json_sc
    in_json_not_csv = json_sc - csv_sc
    in_both = csv_sc & json_sc
    print(f"    In both: {len(in_both)}")
    print(f"    In CSV only (new in updated): {len(in_csv_not_json)}")
    print(f"    In JSON only (removed in updated): {len(in_json_not_csv)}")
    if in_csv_not_json and len(in_csv_not_json) <= 20:
        print(f"    Sample CSV-only: {list(in_csv_not_json)[:10]}")
    elif in_csv_not_json:
        print(f"    Sample CSV-only: {list(in_csv_not_json)[:10]}...")
    if in_json_not_csv and len(in_json_not_csv) <= 20:
        print(f"    Sample JSON-only: {list(in_json_not_csv)[:10]}")
    elif in_json_not_csv:
        print(f"    Sample JSON-only: {list(in_json_not_csv)[:10]}...")

    # 4. Backup DB (brandeduk_ralawise_backup)
    backup_sc, err = get_backup_uneek_shortcodes()
    print(f"\n[4] brandeduk_ralawise_backup (Ralawise backup + UNEEK merged)")
    if err:
        print(f"    Error: {err}")
    else:
        print(f"    UNEEK sku_codes in DB: {len(backup_sc)}")
        csv_in_backup = csv_sc & backup_sc
        csv_missing_backup = csv_sc - backup_sc
        json_in_backup = json_sc & backup_sc
        json_missing_backup = json_sc - backup_sc
        print(f"    CSV ShortCodes in backup DB: {len(csv_in_backup)} / {len(csv_sc)}")
        print(f"    CSV ShortCodes MISSING from backup: {len(csv_missing_backup)}")
        if csv_missing_backup and len(csv_missing_backup) <= 15:
            print(f"      Missing: {list(csv_missing_backup)[:15]}")
        elif csv_missing_backup:
            print(f"      Sample missing: {list(csv_missing_backup)[:15]}...")
        print(f"    JSON ShortCodes in backup DB: {len(json_in_backup)} / {len(json_sc)}")
        print(f"    JSON ShortCodes MISSING from backup: {len(json_missing_backup)}")

    # 5. Ecommerce DB (local UNEEK)
    eco_sc, err = get_ecommerce_uneek_shortcodes()
    print(f"\n[5] ecommerce (local UNEEK - product_variants)")
    if err:
        print(f"    Error: {err}")
    else:
        print(f"    short_code count: {len(eco_sc)}")
        csv_in_eco = csv_sc & eco_sc
        csv_missing_eco = csv_sc - eco_sc
        json_in_eco = json_sc & eco_sc
        json_missing_eco = json_sc - eco_sc
        print(f"    CSV ShortCodes in ecommerce: {len(csv_in_eco)} / {len(csv_sc)}")
        print(f"    CSV ShortCodes MISSING from ecommerce: {len(csv_missing_eco)}")
        print(f"    JSON ShortCodes in ecommerce: {len(json_in_eco)} / {len(json_sc)}")
        print(f"    JSON ShortCodes MISSING from ecommerce: {len(json_missing_eco)}")

    # 6. Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    if err is None and backup_sc:
        if len(csv_missing_backup) == 0:
            print("  [OK] All CSV (updated) ShortCodes are in brandeduk_ralawise_backup")
        else:
            print(f"  [GAP] {len(csv_missing_backup)} CSV ShortCodes are NOT in brandeduk_ralawise_backup")
        if len(json_missing_backup) == 0:
            print("  [OK] All JSON ShortCodes are in brandeduk_ralawise_backup")
        else:
            print(f"  [INFO] {len(json_missing_backup)} JSON ShortCodes not in backup (may be expected if CSV is updated)")
    if eco_sc and not get_ecommerce_uneek_shortcodes()[1]:
        if len(csv_missing_eco) == 0:
            print("  [OK] All CSV ShortCodes are in ecommerce")
        else:
            print(f"  [GAP] {len(csv_missing_eco)} CSV ShortCodes are NOT in ecommerce")
    print("=" * 80)


if __name__ == "__main__":
    main()
