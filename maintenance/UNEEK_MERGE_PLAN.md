# UNEEK Catalogue Merge Plan

---

## HOW TO RUN (backup DB only)

```powershell
# Ensure you target the backup database (never production)
$env:PGHOST = "localhost"
$env:PGDATABASE = "brandeduk_ralawise_backup"
$env:PGUSER = "postgres"
$env:PGPASSWORD = "1234"

node maintenance/run-uneek-merge.js
```

The script will **ABORT** if host is remote or database is `brandeduk_prod`.

---


Merge UNEEK products into `brandeduk_ralawise_backup` (local) while:
1. Staying compatible with the existing backend (filters, search, API)
2. Mapping UNEEK categories to existing product_types, categories, sectors, sports
3. Tracking supplier (Ralawise vs UNEEK) for filtering
4. Keeping only data needed for the current catalogue; discarding the rest

---

## 1. Schema Changes (before merge)

### 1.1 Add suppliers table

```sql
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO suppliers (name, slug) VALUES 
  ('Ralawise', 'ralawise'),
  ('Uneek', 'uneek');
```

### 1.2 Add supplier_id to styles

```sql
ALTER TABLE styles ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);

-- Backfill existing Ralawise styles
UPDATE styles SET supplier_id = (SELECT id FROM suppliers WHERE slug = 'ralawise') WHERE supplier_id IS NULL;
```

### 1.3 Optional: external identifiers (traceability)

```sql
ALTER TABLE styles ADD COLUMN IF NOT EXISTS external_style_code VARCHAR(100);  -- UNEEK ProductCode
ALTER TABLE products ADD COLUMN IF NOT EXISTS external_sku VARCHAR(100);       -- UNEEK EAN/ShortCode
```

---

## 2. Category / Product Type Mapping

Map UNEEK categories to existing Ralawise lookups:

| UNEEK Category   | → product_types (existing slug/name) | → categories          | → related_sports | → age_groups | Notes                |
|------------------|-------------------------------------|-----------------------|------------------|--------------|----------------------|
| Polos            | polos                               | Polos                 | -                | -            | Direct               |
| Sweatshirts      | sweatshirts                         | Sweatshirts           | -                | -            | Include SWEATSHIRT   |
| T-Shirts         | t-shirts                            | T-Shirts              | -                | -            | Direct               |
| Childrenswear    | (match kids product_type)           | Kids / Childrenswear  | -                | kids         | age_group = kids     |
| Jackets          | jackets                             | Jackets               | -                | -            | Direct               |
| Shirts           | shirts                              | Shirts                | -                | -            | Direct               |
| Trousers         | trousers / pants                    | Trousers              | -                | -            | Direct               |
| Healthcare       | workwear / healthcare               | Workwear              | -                | -            | Map to workwear      |
| Sportswear       | sportswear                          | Sportswear            | general          | -            | Add sport if needed  |
| Hi Vis           | safety-vest / hi-vis                | Safety / Hi-Vis       | -                | -            | Map to safety vest   |
| Jog Bottoms      | joggers                             | Joggers               | -                | -            | Direct               |
| Rugby Shirts     | rugby-shirts                        | Rugby                 | rugby            | -            | Add to sport         |
| Headwear         | caps                                | Caps / Headwear       | -                | -            | Map to caps          |
| Hospitality      | aprons / hospitality                | Hospitality           | -                | -            | Map to hospitality   |

**Implementation:** Query backup DB for existing product_type slugs/names and category names. Insert any missing product_types/categories, then use the mapping above.

---

## 3. Lookup Mappings (UNEEK → backup DB)

### 3.1 Gender

| UNEEK Gender | → genders.slug |
|--------------|----------------|
| Unisex       | unisex (or mens if unisex missing) |
| Mens         | mens           |
| Womens       | womens         |
| Kids         | kids           |

### 3.2 Age Group

| UNEEK Category  | → age_groups.slug |
|-----------------|-------------------|
| Childrenswear   | kids              |
| (default)       | adults or NULL    |

### 3.3 Colours

- Match UNEEK `Colour` to `colours.name` or `colours.slug`; use hex if present.
- Insert new colours when not found.
- Use `primary_colour` = standardised name (Black, Blue, Green, etc.) if available.

### 3.4 Sizes

- Match UNEEK `Size` (XS, S, M, L, XL, etc.) to `sizes.slug`/`sizes.name`.
- Insert missing sizes for UNEEK.

### 3.5 Brand

- UNEEK `Company` = "Uneek Clothing" → insert brand "Uneek Clothing" / slug "uneek-clothing" if not exists.

---

## 4. Data Transform (UNEEK JSON → backup schema)

### 4.1 Fields to use (keep)

| UNEEK Field    | → backup table.column       |
|----------------|-----------------------------|
| ProductCode    | styles.style_code           |
| ProductName    | styles.style_name           |
| ProductCode    | styles.external_style_code  |
| Composition    | styles.fabric_description   |
| Specifications | styles.specification        |
| Gender         | styles.gender_id (lookup)   |
| Category       | styles.product_type_id (mapping) |
| Category       | styles.age_group_id (if Childrenswear) |
| ShortCode      | products.sku_code           |
| ShortCode/EAN  | products.external_sku       |
| Colour         | products.colour_name        |
| Colour         | products.primary_colour (normalise) |
| Size           | products.size_id (lookup)   |
| PriceSingle    | products.single_price       |
| PricePack      | products.pack_price         |
| PriceCaton     | products.carton_price       |
| ColourImage    | products.colour_image_url   |
| Image          | products.primary_image_url  |
| sku_status     | products.sku_status = 'Live'|
| GSM            | (optional weight_range)     |
| Hex            | colours.hex_code (if new)   |

### 4.2 Fields to discard (not needed for catalogue)

- TariffNo, WashDegrees, QtySingle, PackQty, CartonQty, Price1K, Quantity, MyPrice
- SmallImage, SMColourImage (use primary/colour images only)
- VideoLink, Packaging, CountryOfOrigin, GrossWeight, NetWeight, TaxCode
- FullDescription, ColourCode, Pantone (keep Hex for colours)
- Specs that duplicate specification (optional: keep in specification)

---

## 5. Junction Tables (required for filters)

### 5.1 product_categories

- Map UNEEK Category → internal category_id via mapping table.
- Insert into `product_categories (product_id, category_id)` for each UNEEK product.

### 5.2 product_types

- styles.product_type_id is set from UNEEK Category mapping.
- No separate junction; product_type is on styles.

### 5.3 product_sports (for Rugby, Sportswear)

- Rugby Shirts → related_sports "rugby" (create if missing).
- Sportswear → "general" or similar (create if missing).
- Insert `product_sports (product_id, sport_id)` for UNEEK products in these categories.

### 5.4 product_sectors

- Healthcare, Hospitality → map to related_sectors if we have Hospitality, Workwear, etc.
- Insert `product_sectors` when mapping exists.

### 5.5 product_fabrics

- Parse UNEEK Composition (e.g. "50% Recycled Polyester 30% Cotton") and match to `fabrics`.
- Insert `product_fabrics` for matched fabrics. Skip if no match to avoid noise.

### 5.6 Optional (can be NULL for UNEEK)

- product_flags, product_accreditations, product_effects
- style_keywords_mapping (sleeve, neckline, fit, feature)
- product_weight_ranges
- product_buttons

These are not required for UNEEK to appear in listings; filters will show N/A or empty.

---

## 6. Migration Script Flow

1. **Pre-checks**
   - Connect to `brandeduk_ralawise_backup`
   - Ensure suppliers table and styles.supplier_id exist
   - Backfill Ralawise supplier_id

2. **Load lookups**
   - Fetch product_types, categories, genders, age_groups, colours, sizes, related_sports, related_sectors, fabrics
   - Build mapping: UNEEK Category → product_type_id, category_id, sport_id, sector_id, age_group_id

3. **Insert UNEEK brand**
   - "Uneek Clothing" → brands (if not exists)
   - Get brand_id

4. **Insert missing lookups**
   - Any product_type, category, size, colour, sport, sector needed for UNEEK

5. **Process UNEEK JSON**
   - Group by ProductCode (style)
   - For each style: insert styles (style_code=ProductCode, style_name=ProductName, brand_id=Uneek, product_type_id, gender_id, age_group_id, supplier_id=uneek, fabric_description, specification)
   - For each SKU: insert products (style_code, sku_code=ShortCode, colour_name, primary_colour, size_id, colour_id, single_price, pack_price, carton_price, primary_image_url, colour_image_url, sku_status='Live', external_sku=EAN)
   - Insert product_categories, product_sports, product_sectors, product_fabrics where mapping exists

6. **Pricing**
   - Use single_price, pack_price, carton_price as-is. Backend applies markup (sell_price). Ensure products has sell_price column or that it’s computed; if not, copy single_price to sell_price for UNEEK.

7. **Refresh views**
   - Refresh product_search_mv and product_search_materialized
   - Rebuild indexes if needed

8. **Verify**
   - Count UNEEK styles/products
   - Test filters: productType, gender, ageGroup, brand, supplier
   - Test search

---

## 7. Backend Changes (supplier filter)

### 7.1 Add supplier filter to API

- Query param: `supplier=ralawise|uneek`
- In `buildProductListQuery` and `buildFilterAggregations`:
  - Join `styles` on `supplier_id`
  - Add `WHERE styles.supplier_id = (SELECT id FROM suppliers WHERE slug = $n)` when supplier filter present

### 7.2 Include supplier in responses

- Add `supplier` (name or slug) to product/style response
- Add supplier to filter aggregations so UI can filter by supplier

### 7.3 product_search_mv

- Include `s.supplier_id` and/or `sup.slug AS supplier_slug` in the MV
- Add supplier to filter conditions when supplier filter is active

---

## 8. Execution Order

| Step | Action |
|------|--------|
| 1 | Run schema migration (suppliers, supplier_id) on `brandeduk_ralawise_backup` |
| 2 | Query backup for existing product_types, categories, genders, age_groups, sizes, colours |
| 3 | Build UNEEK→backup mapping (product_type, category, sport, sector, age_group) |
| 4 | Run UNEEK merge script (styles, products, junctions) |
| 5 | Update product_search_mv to include supplier (if not already) |
| 6 | Refresh materialized views |
| 7 | Add supplier filter to routes/products.js and productService |
| 8 | Test filters and search |

---

## 9. Files to Create/Modify

| File | Purpose |
|------|---------|
| `maintenance/migrations/001_add_suppliers.sql` | Schema changes |
| `maintenance/merge-uneek.js` | Main merge script (reads JSON, inserts into backup) |
| `maintenance/uneek-category-mapping.json` | UNEEK Category → product_type, category, sport, age_group |
| `routes/products.js` | Add supplier query param |
| `services/productService.js` | Add supplier to buildProductListQuery, buildFilterAggregations |
| `views.sql` or MV definition | Add supplier_id/supplier_slug to product_search_mv |

---

## 10. Rollback

- Keep backup of `brandeduk_ralawise_backup` before merge
- To remove UNEEK: `DELETE FROM products WHERE style_code IN (SELECT style_code FROM styles WHERE supplier_id = uneek_id); DELETE FROM styles WHERE supplier_id = uneek_id;`
- Revert schema changes if needed (remove supplier_id, suppliers table)
