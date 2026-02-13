# 🔍 BrandedUK Production Search Architecture (v3 - FINAL)

## 1. Canonical Search Entity
**Canonical Entity: `style_code`**
- **Ranking Phase**: Occurs at the Style level (Materialized View).
- **Expansion Phase**: Fetches representative SKUs (color/price variations) matching the style.
- **Aggregation Phase**: Facet counts (Brands, Types, Colors) are counts of unique Styles.

## 2. Refined Ranking Formula (Multi-Field Similarity)
We avoid noisy similarity checks on large text blobs. Instead, we use targeted logic:

**`Final Score = FTS_Rank + Text_Similarity + Identity_Boost + Logic_Boost`**

| Code Component | SQL Implementation | Weight |
| :--- | :--- | :--- |
| **FTS_Rank** | `ts_rank_cd(search_vector, query, 32) * 100` | 100 |
| **Text_Similarity** | `GREATEST(similarity(style_name, q), similarity(brand, q), similarity(product_type, q)) * 40` | 40 |
| **Identity_Boost** | `CASE WHEN style_code ILIKE query_token THEN 200 ELSE 0 END` | 200 |
| **Logic_Boost** | `CASE WHEN brand = parsed_brand THEN 60 WHEN product_type = parsed_type THEN 50 ELSE 0 END` | 60 |

## 3. Pagination Stability (Determinism)
To prevent "jumping" items or duplicated results between pages, every search query must have a deterministic tie-breaker in the ordering clause:
**`ORDER BY relevance_score DESC, style_code ASC`**

## 4. Token Ambiguity Resolution
When a token like "Polo" matches multiple entities (Brand: Polo vs Type: Polo Shirt):
- **Rule 1 (Identity)**: If the token is an **exact match** for a Brand Name but only a **partial match** for a Product Type, it is classified as a **Brand**.
- **Rule 2 (Context)**: If the token is followed by a known attribute (e.g. "Polo Red"), it maintains its Type priority.
- **Rule 3 (Hierarchy)**: Default Priority: `Style Code` > `Brand` > `Product Type` > `Structured Attribute`.

## 5. Facet Count Synchronization
To prevent "Ghost Counts" (where facets show counts that lead to zero results), the `/api/products` and `/api/filters` endpoints **MUST** share the same `search_base` CTE.

**Scenario: "Golf Polo"**
- Token "Golf" → Classified as `sport_slugs` filter.
- Token "Polo" → Classified as `product_type` filter.
- **SQL Result**: `WHERE sport_slugs && ARRAY['golf'] AND product_type = 'polo'`.
- Sidebar Counts: Recalculated based on this intersection.

## 6. Index Strategy (Tightened)
- **Partial GIN**: `GIN(search_vector) WHERE sku_status = 'Live'`.
- **Composite Btree**: `(product_type, brand)` — optimizes the most frequent category-level browsing.
- **High-Signal Trigram**: `GIN(style_name gin_trgm_ops), GIN(brand gin_trgm_ops)`.
