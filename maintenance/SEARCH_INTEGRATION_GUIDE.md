# Search Integration Guide (Production V3)

## Status: ✅ INTEGRATION COMPLETE

The new intelligent search service has been fully integrated into `productService.js`.

---

## Architecture Overview

```
User Query: "red cotton slim fit polo"
       ↓
  searchQueryParser.js  ← Classifies tokens using extensive DB lookups
       ↓
  { 
    productType: "polo", 
    fits: ["slim fit"], 
    fabrics: ["cotton"], 
    colours: ["red"],
    ... 
  }
       ↓
  searchService.js  ← Builds SQL using robust EXISTS subqueries against base tables
       ↓
  buildProductListQuery()
```

## Files Modified

| File | Change |
|------|--------|
| `services/productService.js` | Replaced 270-line legacy search block with 10-line service call |
| `services/search/searchService.js` | Added robust attribute filters (fit, sleeve, fabric, etc) via subqueries |
| `services/search/searchQueryParser.js` | Added lookup loading for all extended attributes |
| `services/search/index.js` | Added `getSearchSuggestions` export |
| `SEARCH_MIGRATION.sql` | Rewritten as additive-only (safe for live DB) |

## Integration Points

### 1. Robust Attribute Filtering
The search service now supports "all possible keywords" by filtering against base tables (`style_keywords`, `product_fabrics`, `related_sectors`, `products`) using `EXISTS` subqueries. This ensures filters work even if the materialized view schema is missing specific array columns.

Supported Attributes:
- **Fits**: (e.g. "Slim Fit", "Regular")
- **Sleeves**: (e.g. "Long Sleeve")
- **Necklines**: (e.g. "V-Neck")
- **Fabrics**: (e.g. "Cotton", "Polyester")
- **Sectors**: (e.g. "Hospitality")
- **Colours**: (e.g. "Red", "Navy")
- **Features**: (e.g. "Breathable")

### 2. `buildProductListQuery` (lines ~690-708)
```javascript
if (searchText) {
  hasSearch = true;
  const trimmedSearch = searchText.trim();
  if (trimmedSearch) {
    const searchResult = await search.buildSearchConditions(trimmedSearch, viewAlias, paramIndex);
    conditions.push(...searchResult.conditions);
    params.push(...searchResult.params);
    paramIndex = searchResult.nextParamIndex;
    searchRelevanceSelect = searchResult.relevanceSelect;
    searchRelevanceOrder = searchResult.relevanceOrder;
  }
}
```

### 2. `buildFilterAggregations` (lines ~197-223)
The `buildBaseConditions()` function is now `async` and calls the same `search.buildSearchConditions()` when a search is active but pre-filtered style codes aren't available. This prevents "ghost counts" (facet counts that don't match search results).

### 3. Auto-Suggest (Typeahead)

A new endpoint `GET /api/products/suggest?q=...` uses `getSearchSuggestions` to return structured data for the frontend typeahead.

**Note:** It queries base tables (`products`, `styles`) directly to ensure stability even if the materialized view is updating or missing columns.

## Deployment Checklist

### Step 1: Run Migration SQL
```bash
psql -U brandeduk -d brandeduk -f SEARCH_MIGRATION.sql
```
This will:
- Enable `pg_trgm` extension
- Create trigram GIN indexes on `style_name` and `brand`
- Create `search_synonyms` table with initial data
- **Does NOT** drop or recreate the materialized view

### Step 2: Verify Indexes
```sql
-- Check pg_trgm is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_trgm';

-- Check trigram indexes exist
SELECT indexname FROM pg_indexes 
WHERE tablename = 'product_search_materialized' 
  AND indexname LIKE '%trgm%';

-- Check search_synonyms table
SELECT COUNT(*) FROM search_synonyms;
```

### Step 3: Deploy Code
Deploy the updated `services/` directory. The search service auto-loads on first query.

### Step 4: Warm-up (Optional)
On server start, call to pre-populate caches:
```javascript
const search = require('./services/search');
await search.ensureSynonymsLoaded();
```

## Update Log
- **2024-02-13**: Added Auto-Suggest endpoint logic and robustness improvements.
