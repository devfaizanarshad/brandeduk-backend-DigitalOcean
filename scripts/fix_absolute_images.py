"""
One-off repair script to fix colour-specific images for Absolute Apparel products.

It uses the raw Absolute JSON files:
  - absolute_raw_data/raw_masters.json
  - absolute_raw_data/raw_skus.json
  - absolute_raw_data/raw_images.json

And updates ONLY products that belong to the 'absolute-apparel' supplier,
setting products.colour_image_url to a colour-appropriate image URL.
"""

import json
import os
import sys
from collections import defaultdict

try:
    import psycopg2
except ImportError:
    os.system(f"{sys.executable} -m pip install psycopg2-binary")
    import psycopg2  # type: ignore


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

BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "absolute_raw_data")
MASTERS_PATH = os.path.join(BASE_DIR, "raw_masters.json")
SKUS_PATH = os.path.join(BASE_DIR, "raw_skus.json")
IMAGES_PATH = os.path.join(BASE_DIR, "raw_images.json")

SUPPLIER_SLUG = "absolute-apparel"


def load_json(path):
    if not os.path.exists(path):
        raise FileNotFoundError(f"Required file not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_image_mapping():
    """
    Build a mapping:
        (style_code, colour_name_lower) -> image_url

    using:
      - raw_masters.json   (ID, StockCode)
      - raw_skus.json      (StockCode, ColourCode, ColourName)
      - raw_images.json    (masterID -> [{ ImageURL, ColourCode, isMaster, FullURL }])
    """
    print("Loading raw Absolute data...")

    masters = load_json(MASTERS_PATH)
    skus = load_json(SKUS_PATH)
    images_by_master = load_json(IMAGES_PATH)

    print(f"  Masters: {len(masters)}")
    print(f"  SKUs:    {len(skus)}")
    print(f"  Masters with images: {len(images_by_master)}")

    # Group SKUs by style_code (StockCode prefix)
    skus_by_style = defaultdict(list)
    for s in skus:
        stock_code = (s.get("StockCode") or "").strip()
        if not stock_code:
            continue
        # Master style_code is the part before the first '-'
        style_code = stock_code.split("-")[0]
        skus_by_style[style_code].append(s)

    # Build mapping (style_code, colour_name_lower) -> url
    style_colour_to_url = {}

    for m in masters:
        style_code = (m.get("StockCode") or "").strip()
        master_id = str(m.get("ID") or "").strip()
        if not style_code or not master_id:
            continue

        style_skus = skus_by_style.get(style_code, [])
        style_images = images_by_master.get(master_id) or []

        if not style_skus or not style_images:
            continue

        # Index images by ColourCode and track master images
        images_for_colour = defaultdict(list)
        master_images = []

        for img in style_images:
            url = (img.get("FullURL") or img.get("ImageURL") or "").strip()
            if not url:
                continue
            colour_code = (img.get("ColourCode") or "").strip()
            is_master = bool(img.get("isMaster"))

            if is_master:
                master_images.append(url)
            if colour_code:
                images_for_colour[colour_code].append(url)

        # Choose style-level fallback
        fallback_url = None
        if master_images:
            fallback_url = master_images[0]
        elif style_images:
            first = style_images[0]
            fallback_url = (first.get("FullURL") or first.get("ImageURL") or "").strip() or None

        if not fallback_url:
            # No usable images; skip this style
            continue

        # Map each SKU colour to an image
        for sku in style_skus:
            colour_name = (sku.get("ColourName") or "").strip()
            colour_code = (sku.get("ColourCode") or "").strip()
            if not colour_name:
                continue

            key = (style_code, colour_name.lower())

            # Prefer an image that matches the ColourCode
            url_candidates = images_for_colour.get(colour_code)
            chosen_url = None
            if url_candidates:
                chosen_url = url_candidates[0]
            else:
                # Fall back to style-level master image
                chosen_url = fallback_url

            # Last-write-wins is fine; all SKUs of same colour share same image
            style_colour_to_url[key] = chosen_url

    print(f"Built image map for {len(style_colour_to_url)} (style, colour) combinations.")
    return style_colour_to_url


def apply_image_mapping_to_db(style_colour_to_url):
    """
    Update products.colour_image_url for Absolute Apparel products
    based on the provided (style_code, colour_name_lower) -> url map.
    """
    print("\nConnecting to database...")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    try:
        # Find supplier id for Absolute Apparel
        cur.execute("SELECT id FROM suppliers WHERE slug = %s;", (SUPPLIER_SLUG,))
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"Supplier with slug '{SUPPLIER_SLUG}' not found in database")

        supplier_id = row[0]
        print(f"  Supplier '{SUPPLIER_SLUG}' id: {supplier_id}")

        # Fetch all products that belong to this supplier
        cur.execute(
            """
            SELECT p.id, p.style_code, p.colour_name
            FROM products p
            JOIN styles s ON p.style_code = s.style_code
            WHERE s.supplier_id = %s;
            """,
            (supplier_id,),
        )
        rows = cur.fetchall()
        print(f"  Found {len(rows)} products for supplier '{SUPPLIER_SLUG}'.")

        updates = 0
        missing = 0

        for prod_id, style_code, colour_name in rows:
            style_code = (style_code or "").strip()
            colour_name_clean = (colour_name or "").strip()
            if not style_code or not colour_name_clean:
                continue

            key = (style_code, colour_name_clean.lower())
            new_url = style_colour_to_url.get(key)

            if not new_url:
                missing += 1
                continue

            cur.execute(
                "UPDATE products SET colour_image_url = %s WHERE id = %s;",
                (new_url, prod_id),
            )
            updates += 1

        print(f"  Will update colour_image_url for {updates} products.")
        if missing:
            print(f"  No mapped image for {missing} products (they will be left unchanged).")

        conn.commit()
        print("\nCommit complete. Colour images updated for Absolute Apparel.")

    except Exception as e:
        conn.rollback()
        print("\nError encountered. Transaction rolled back.")
        print(f"Error: {e}")
        raise
    finally:
        cur.close()
        conn.close()


def main():
    print("=== FIX ABSOLUTE APPAREL COLOUR IMAGES ===")
    style_colour_to_url = build_image_mapping()
    apply_image_mapping_to_db(style_colour_to_url)


if __name__ == "__main__":
    main()

