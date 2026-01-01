# Enhanced Natural Language Search Implementation

## Overview
Implemented flexible, natural-language search functionality that searches across multiple product fields with intelligent relevance ranking.

## Features Implemented

### 1. Multi-Field Search
The search now queries across:
- **Product Code** (`style_code`) - exact and prefix matching
- **Product Name** (`style_name`) - partial text matching
- **Full-Text Search** (`search_vector`) - PostgreSQL full-text search with stemming
- **Colors** (`colour_slugs[]` array and `primary_colour` text)
- **Fabrics** (`fabric_slugs[]` array)
- **Necklines** (`neckline_slugs[]` array) - e.g., "crew neck", "v-neck"
- **Sleeves** (`sleeve_slugs[]` array) - e.g., "long sleeves", "short sleeves"
- **Style Keywords** (`style_keyword_slugs[]` array) - e.g., "hooded", "classic"

### 2. Intelligent Query Parsing
- **Short queries (≤2 chars)**: Exact/prefix matching on product codes only
- **Long queries (>2 chars)**: Natural language parsing with term normalization

### 3. Term Normalization
Automatically normalizes search terms for better matching:
- **Necklines**: "crew neck" → "crew-neck", "v neck" → "v-neck"
- **Sleeves**: "long sleeves" → "long-sleeve", "short sleeves" → "short-sleeve"
- **Colors/Fabrics**: Direct matching with special character handling

### 4. Relevance Scoring System
Results are ranked by relevance score (highest first):
- **Exact style code match**: 100 points
- **Prefix style code match**: 80 points
- **Full-text search relevance**: 0-60 points (scaled ts_rank)
- **Style name contains**: 40 points
- **Color match (array)**: 30 points
- **Color match (text)**: 25 points
- **Fabric match**: 25 points
- **Neckline match**: 20 points
- **Sleeve match**: 20 points
- **Style keyword match**: 15 points

### 5. Search Logic
- Uses **OR logic** - any field match qualifies the product
- All search conditions combined with OR for maximum flexibility
- Works seamlessly with existing filters (productType, price, etc.)

## API Usage

### Basic Search
```
GET /api/products?q=red tshirt
```

### Product Code Search
```
GET /api/products?q=GD067
```

### Natural Language Queries
```
GET /api/products?q=red hoodie long sleeves
GET /api/products?q=polyester crew neck
GET /api/products?q=blue organic cotton t-shirt
```

### Combined with Filters
```
GET /api/products?q=red tshirt&productType=T-Shirts&primaryColour[]=red
```

## Test Cases

### Test 1: Product Code Search
```bash
curl "https://brandeduk-backend.onrender.com/api/products?q=GD067&limit=5"
```
**Expected**: Product with code GD067 (exact match, highest priority)

### Test 2: Natural Language Search
```bash
curl "https://brandeduk-backend.onrender.com/api/products?q=red tshirt polyester&limit=10"
```
**Expected**: Red T-shirts made of polyester

### Test 3: Attribute Search
```bash
curl "https://brandeduk-backend.onrender.com/api/products?q=crew neck long sleeves&limit=10"
```
**Expected**: Products with crew neck and long sleeves

### Test 4: Combined with Category Filter
```bash
curl "https://brandeduk-backend.onrender.com/api/products?q=red hoodie&productType=Hoodies&limit=10"
```
**Expected**: Red hoodies only (not other red products)

### Test 5: Partial Matching
```bash
curl "https://brandeduk-backend.onrender.com/api/products?q=tshirt&limit=10"
```
**Expected**: All T-shirts (should match "T-Shirt", "T-Shirts", "tshirt", etc.)

### Test 6: Color Search
```bash
curl "https://brandeduk-backend.onrender.com/api/products?q=red&limit=10"
```
**Expected**: All products with red color

### Test 7: Fabric Search
```bash
curl "https://brandeduk-backend.onrender.com/api/products?q=polyester&limit=10"
```
**Expected**: Products with polyester fabric

## Performance Optimizations

1. **Uses Existing Indexes**: Leverages GIN indexes on array columns and full-text search index
2. **Efficient Query Structure**: Uses CTEs to filter first, then calculate relevance
3. **Caching**: Results are cached for 5 minutes (same as before)
4. **Parameterized Queries**: All queries use parameterized statements for security

## Database Fields Used

### From `product_search_materialized` view:
- `style_code` (indexed with prefix index)
- `style_name` (indexed with prefix index)
- `search_vector` (GIN indexed tsvector)
- `colour_slugs[]` (GIN indexed array)
- `primary_colour` (indexed)
- `fabric_slugs[]` (GIN indexed array)
- `neckline_slugs[]` (GIN indexed array)
- `sleeve_slugs[]` (GIN indexed array)
- `style_keyword_slugs[]` (GIN indexed array)

## Implementation Details

### Files Modified
- `services/productService.js` - Enhanced search logic and relevance scoring

### Key Changes
1. Replaced simple search condition with comprehensive multi-field search
2. Added relevance scoring calculation
3. Updated query CTEs to include relevance in ORDER BY
4. Maintained backward compatibility with existing filters

## Notes

- Search is case-insensitive
- Partial word matching supported (e.g., "tshirt" matches "T-Shirt")
- Multiple terms are searched independently (OR logic)
- Results are ranked by relevance, then by existing sort order
- Works with all existing filters (productType, price, color, etc.)

## Future Enhancements (Optional)

1. **Fuzzy Matching**: Add Levenshtein distance for typos
2. **Synonym Support**: Map "tshirt" → "t-shirt", "hoodie" → "hoodies"
3. **Search Analytics**: Track popular searches
4. **Autocomplete**: Suggest search terms based on popular queries
5. **Search History**: Remember user's recent searches

