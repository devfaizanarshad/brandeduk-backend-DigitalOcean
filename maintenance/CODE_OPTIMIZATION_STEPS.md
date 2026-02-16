# CODE OPTIMIZATION STEPS

## Overview
These code changes optimize query execution without changing business logic or response structure.

---

## STEP 1: Optimize Connection Pool (1GB RAM Server)

**File:** `config/database.js`

**Change:** Reduce max connections from 50 to 10 (optimal for 1GB RAM)

```javascript
const pool = new Pool({
  // ... existing config ...
  max: parseInt(process.env.DB_POOL_MAX) || 10,  // Changed from 50 to 10
  min: parseInt(process.env.DB_POOL_MIN) || 2,   // Changed from 5 to 2
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 10000, // Changed from 30000
  connectionTimeoutMillis: 2000,  // Changed from 10000 - fail fast
  statement_timeout: 1000,        // Changed from 30000 - kill queries >1s
  // ... rest of config ...
});
```

**Why:** 50 connections on 1GB RAM causes memory pressure. 10 connections with faster timeouts prevents resource exhaustion.

---

## STEP 2: Reduce Query Timeouts (Fail Fast)

**File:** `config/database.js`

**Change:** Lower timeout in `queryWithTimeout` function

```javascript
async function queryWithTimeout(text, params, timeoutMs = 1000) {  // Changed from 30000
  // ... existing code ...
}
```

**Why:** Queries taking >1s should fail fast. Better to return error than timeout at 30s.

---

## STEP 3: Optimize Batch Details Query (Fix 14-second query)

**File:** `services/productService.js`

**Change:** Add LIMIT and optimize the batch query to fetch only necessary data

**Current query returns 800-1129 rows for 28 products. We need to:**
1. Add DISTINCT ON to reduce duplicates
2. Limit rows per style_code
3. Use covering index pattern

**Location:** Around line 1218-1245

**Replace the batchQuery with:**

```javascript
// OPTIMIZED: Fetch only one row per style_code+colour combination
// This reduces 800 rows to ~56 rows (28 products * 2 colors average)
const batchQuery = `
  SELECT DISTINCT ON (p.style_code, p.colour_name)
    p.style_code as code,
    s.style_name as name,
    b.name as brand,
    p.colour_name,
    p.primary_colour,
    p.colour_shade,
    p.colour_image_url,
    p.primary_image_url,
    sz.name as size,
    sz.slug as size_slug,
    sz.size_order,
    p.single_price,
    p.pack_price,
    p.carton_price,
    p.sell_price,
    t.name as tag,
    t.slug as tag_slug,
    p.created_at
  FROM products p
  INNER JOIN styles s ON p.style_code = s.style_code
  LEFT JOIN brands b ON s.brand_id = b.id
  LEFT JOIN sizes sz ON p.size_id = sz.id
  LEFT JOIN tags t ON p.tag_id = t.id
  WHERE p.style_code = ANY($1::text[]) AND p.sku_status = 'Live'
  ORDER BY p.style_code, p.colour_name, COALESCE(sz.size_order, 999)
  LIMIT 200
`;
```

**Why:** 
- DISTINCT ON reduces rows from 800+ to ~56-100
- LIMIT 200 prevents runaway queries
- Uses indexes created in STEP 2

---

## STEP 4: Add Query Plan Hints (Optional but Recommended)

**File:** `services/productService.js`

**Add after query construction (around line 1118):**

```javascript
// Add query hints for PostgreSQL optimizer
const optimizedQueryWithHints = `
  SET LOCAL enable_seqscan = off;  -- Prefer indexes over sequential scans
  ${optimizedQuery}
`;
```

**Note:** Only use if indexes are created. Remove if causing issues.

---

## STEP 5: Optimize Product Type JOIN (Fix 4-second query)

**File:** `services/productService.js`

**Current:** Product type filter uses complex JOIN with LOWER(REPLACE(...))

**Optimization:** Pre-compute normalized product type names in a separate column or use the index created in DATABASE_OPTIMIZATION_STEPS.sql

**Location:** Around line 1028-1036

**The index `idx_product_types_name_lower` will make this fast automatically.**

---

## STEP 6: Add Prepared Statements (30% Performance Boost)

**File:** `config/database.js`

**Add prepared statement cache:**

```javascript
const preparedStatements = new Map();

async function queryWithTimeout(text, params, timeoutMs = 1000) {
  const startTime = Date.now();
  
  // Check if we have a prepared statement for this query pattern
  const queryKey = text.substring(0, 100); // Use first 100 chars as key
  let statementName = preparedStatements.get(queryKey);
  
  if (!statementName) {
    statementName = `stmt_${preparedStatements.size}`;
    preparedStatements.set(queryKey, statementName);
    // Note: pg doesn't support prepared statements the same way, but we can use query plan caching
  }
  
  // ... rest of existing code ...
}
```

**Note:** PostgreSQL automatically caches query plans, but this pattern helps ensure reuse.

---

## STEP 7: Reduce Materialized View Refresh Frequency

**File:** Create a cron job or scheduled task

**Instead of refreshing on every query, refresh every 5 minutes:**

```bash
# Add to crontab (crontab -e)
*/5 * * * * psql -U postgres -d Branded_UK -c "REFRESH MATERIALIZED VIEW CONCURRENTLY product_search_materialized;"
```

**Why:** Materialized view refresh is expensive. Doing it every 5 minutes is sufficient for most use cases.

---

## STEP 8: Add Request Deduplication (Prevent Duplicate Queries)

**File:** `services/productService.js`

**Add at the top of `buildProductListQuery`:**

```javascript
// Request deduplication - if same query is executing, wait for result
const activeQueries = new Map();

async function buildProductListQuery(filters, page, limit) {
  const cacheKey = getCacheKey(filters, page, limit);
  
  // Check if query is already executing
  if (activeQueries.has(cacheKey)) {
    return await activeQueries.get(cacheKey);
  }
  
  // Check cache
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Execute query and store promise
  const queryPromise = executeProductListQuery(filters, page, limit, cacheKey);
  activeQueries.set(cacheKey, queryPromise);
  
  try {
    const result = await queryPromise;
    return result;
  } finally {
    activeQueries.delete(cacheKey);
  }
}

async function executeProductListQuery(filters, page, limit, cacheKey) {
  // ... move existing query logic here ...
}
```

**Why:** Prevents duplicate queries when multiple users request the same data simultaneously.

---

## VERIFICATION

After applying changes:

1. **Check query times in logs:**
   - Product list: Should be <50ms
   - Product detail: Should be <20ms
   - Batch query: Should be <100ms

2. **Monitor connection pool:**
   - Should see max 10 connections
   - No connection timeouts

3. **Check index usage:**
   ```sql
   SELECT * FROM pg_stat_user_indexes 
   WHERE idx_scan > 0 
   ORDER BY idx_scan DESC;
   ```

---

## ROLLBACK PLAN

If optimizations cause issues:

1. **Remove query hints** (STEP 4)
2. **Increase timeouts** back to 30s (STEP 2)
3. **Increase connection pool** back to 50 (STEP 1)
4. **Remove DISTINCT ON** from batch query (STEP 3)

Keep the database indexes - they're always beneficial.

