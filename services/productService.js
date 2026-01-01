const { pool, queryWithTimeout } = require('../config/database');
const { getCategoryIdsFromSlugs } = require('./categoryService');

const queryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const COUNT_CACHE_TTL = 60 * 60 * 1000;

function getCacheKey(filters, page, limit, type = 'results') {
  const normalizedFilters = {};
  Object.keys(filters).sort().forEach(key => {
    const value = filters[key];
    if (value === null || value === undefined || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) {
        normalizedFilters[key] = [...value].sort();
      }
    } else {
      normalizedFilters[key] = value;
    }
  });
  
  const filterString = Object.keys(normalizedFilters)
    .map(key => `${key}:${Array.isArray(normalizedFilters[key]) ? normalizedFilters[key].join(',') : normalizedFilters[key]}`)
    .join('|');
  
  const key = `${filterString}|page:${page}|limit:${limit}|type:${type}`;
  
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `query_${Math.abs(hash)}_${type}`;
}

function getCached(key) {
  const cached = queryCache.get(key);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > cached.ttl) {
    queryCache.delete(key);
    return null;
  }
  
  return cached.data;
}

function setCache(key, data, ttl = CACHE_TTL) {
  if (queryCache.size >= 1000) {
    const firstKey = queryCache.keys().next().value;
    queryCache.delete(firstKey);
  }
  
  queryCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
}

function clearCache() {
  queryCache.clear();
  console.log('[CACHE] Query cache cleared');
}

function hasItems(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

function normalizeSlug(slug) {
  return slug.toLowerCase().replace(/-?\d+$/, '');
}

async function getCategoryIdsWithChildrenCached(categoryIds) {
  if (!categoryIds || categoryIds.length === 0) {
    return [];
  }

  const query = `
    SELECT DISTINCT unnest(all_child_ids) as child_id
    FROM category_hierarchy_cache
    WHERE category_id = ANY($1::int[])
    UNION
    SELECT category_id FROM category_hierarchy_cache WHERE category_id = ANY($1::int[])
  `;

  const result = await queryWithTimeout(query, [categoryIds], 10000);
  return result.rows.map(row => row.child_id);
}

async function buildProductListQuery(filters, page, limit) {
  const cacheKey = getCacheKey(filters, page, limit);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[CACHE] Hit - returning cached result');
    return cached;
  }
  console.log(`[CACHE] Miss - executing query (key: ${cacheKey.substring(0, 50)}...)`);

  const offset = (page - 1) * limit;
  const conditions = [];
  let params = [];
  let paramIndex = 1;

  const sort = filters.sort || 'newest';
  const order = filters.order || 'DESC';
  const viewAlias = 'psm';
  const searchText = filters.q || filters.text;
  
  // Enhanced natural language search
  let searchCondition = '';
  let searchRelevanceSelect = '';
  let searchRelevanceOrder = '';
  let hasSearch = false;
  
  if (searchText) {
    hasSearch = true;
    const trimmedSearch = searchText.trim();
    const searchLength = trimmedSearch.length;
    
    if (searchLength <= 2) {
      // Very short queries: exact/prefix matching on style_code only
      searchCondition = `(
        ${viewAlias}.style_code = UPPER($${paramIndex}) OR
        ${viewAlias}.style_code ILIKE $${paramIndex + 1}
      )`;
      params.push(trimmedSearch);
      params.push(`${trimmedSearch}%`);
      paramIndex += 2;
      
      // Relevance: exact code match = highest priority
      searchRelevanceSelect = `
        CASE 
          WHEN ${viewAlias}.style_code = UPPER($${paramIndex - 2}) THEN 100
          WHEN ${viewAlias}.style_code ILIKE $${paramIndex - 1} THEN 50
          ELSE 0
        END as relevance_score`;
      
      searchRelevanceOrder = 'relevance_score DESC';
    } else {
      // Natural language search: split into terms and search across multiple fields
      const searchTerms = trimmedSearch.split(/\s+/).filter(t => t.length > 0);
      const normalizedSearch = searchTerms.join(' ');
      
      // Normalize terms for array matching
      const normalizeTerm = (term, type) => {
        const lower = term.toLowerCase();
        switch(type) {
          case 'neckline':
            if (lower.includes('crew')) return 'crew-neck';
            if (lower.includes('vneck') || lower.includes('v-neck')) return 'v-neck';
            if (lower.includes('round')) return 'round-neck';
            return lower.replace(/[^a-z0-9]/g, '-');
          case 'sleeve':
            if (lower.includes('long')) return 'long-sleeve';
            if (lower.includes('short')) return 'short-sleeve';
            if (lower.includes('3/4') || lower.includes('three-quarter')) return 'three-quarter-sleeve';
            if (lower.includes('sleeve')) return lower.replace(/\s*sleeves?\s*/i, '-sleeve');
            return lower.replace(/[^a-z0-9]/g, '-');
          case 'fabric':
          case 'color':
          case 'style':
          default:
            return lower.replace(/[^a-z0-9]/g, '-');
        }
      };
      
      const colorTerms = searchTerms.map(t => normalizeTerm(t, 'color'));
      const fabricTerms = searchTerms.map(t => normalizeTerm(t, 'fabric'));
      const necklineTerms = searchTerms.map(t => normalizeTerm(t, 'neckline'));
      const sleeveTerms = searchTerms.map(t => normalizeTerm(t, 'sleeve'));
      const styleTerms = searchTerms.map(t => normalizeTerm(t, 'style'));
      
      // Build comprehensive search condition (OR logic - any match)
      const searchParts = [];
      
      // 1. Full-text search on search_vector (most flexible, uses GIN index)
      searchParts.push(`${viewAlias}.search_vector @@ plainto_tsquery('english', $${paramIndex})`);
      params.push(normalizedSearch);
      paramIndex++;
      
      // 2. Style code exact/partial match (high priority)
      searchParts.push(`${viewAlias}.style_code ILIKE $${paramIndex}`);
      params.push(`%${normalizedSearch.toUpperCase()}%`);
      paramIndex++;
      
      // 3. Style name contains
      searchParts.push(`${viewAlias}.style_name ILIKE $${paramIndex}`);
      params.push(`%${normalizedSearch}%`);
      paramIndex++;
      
      // 4. Color match (check both array and text)
      const colorSearchParam = paramIndex;
      const colorTextParam = paramIndex + 1;
      searchParts.push(`(
        (${viewAlias}.colour_slugs IS NOT NULL AND ${viewAlias}.colour_slugs && $${colorSearchParam}::text[]) OR
        (${viewAlias}.primary_colour IS NOT NULL AND LOWER(${viewAlias}.primary_colour) LIKE $${colorTextParam})
      )`);
      params.push(colorTerms);
      params.push(`%${normalizedSearch.toLowerCase()}%`);
      paramIndex += 2;
      
      // 5. Fabric match (array only - may be empty, but check anyway)
      const fabricParam = paramIndex;
      searchParts.push(`(
        ${viewAlias}.fabric_slugs IS NOT NULL AND 
        ${viewAlias}.fabric_slugs && $${fabricParam}::text[]
      )`);
      params.push(fabricTerms);
      paramIndex++;
      
      // 6. Neckline match (array only)
      const necklineParam = paramIndex;
      searchParts.push(`(
        ${viewAlias}.neckline_slugs IS NOT NULL AND 
        ${viewAlias}.neckline_slugs && $${necklineParam}::text[]
      )`);
      params.push(necklineTerms);
      paramIndex++;
      
      // 7. Sleeve match (array only)
      const sleeveParam = paramIndex;
      searchParts.push(`(
        ${viewAlias}.sleeve_slugs IS NOT NULL AND 
        ${viewAlias}.sleeve_slugs && $${sleeveParam}::text[]
      )`);
      params.push(sleeveTerms);
      paramIndex++;
      
      // 8. Style keyword match (array - has data like {hooded})
      const styleParam = paramIndex;
      searchParts.push(`(
        ${viewAlias}.style_keyword_slugs IS NOT NULL AND 
        ${viewAlias}.style_keyword_slugs && $${styleParam}::text[]
      )`);
      params.push(styleTerms);
      paramIndex++;
      
      // Combine all search conditions with OR
      searchCondition = `(${searchParts.join(' OR ')})`;
      
      // Build relevance scoring
      // Store parameter indices for relevance calculation
      const exactCodeParam = paramIndex;
      params.push(normalizedSearch.toUpperCase());
      paramIndex++;
      
      const prefixCodeParam = paramIndex;
      params.push(`${normalizedSearch.toUpperCase()}%`);
      paramIndex++;
      
      const fullTextParam = paramIndex;
      params.push(normalizedSearch);
      paramIndex++;
      
      const nameParam = paramIndex;
      params.push(`%${normalizedSearch}%`);
      paramIndex++;
      
      searchRelevanceSelect = `
        (
          -- Exact style code match (highest priority: 100 points)
          CASE WHEN ${viewAlias}.style_code = UPPER($${exactCodeParam}) THEN 100 ELSE 0 END +
          -- Prefix style code match (80 points)
          CASE WHEN ${viewAlias}.style_code ILIKE $${prefixCodeParam} THEN 80 ELSE 0 END +
          -- Full-text search relevance (0-60 points, scaled)
          CASE WHEN ${viewAlias}.search_vector @@ plainto_tsquery('english', $${fullTextParam}) 
            THEN LEAST(ts_rank(${viewAlias}.search_vector, plainto_tsquery('english', $${fullTextParam})) * 60, 60)
            ELSE 0 END +
          -- Style name contains all terms (40 points)
          CASE WHEN ${viewAlias}.style_name ILIKE $${nameParam} THEN 40 ELSE 0 END +
          -- Color match - array (30 points)
          CASE WHEN (
            ${viewAlias}.colour_slugs IS NOT NULL AND 
            ${viewAlias}.colour_slugs && $${colorSearchParam}::text[]
          ) THEN 30 ELSE 0 END +
          -- Color match - text (25 points)
          CASE WHEN (
            ${viewAlias}.primary_colour IS NOT NULL AND 
            LOWER(${viewAlias}.primary_colour) LIKE $${colorTextParam}
          ) THEN 25 ELSE 0 END +
          -- Fabric match (25 points)
          CASE WHEN (
            ${viewAlias}.fabric_slugs IS NOT NULL AND 
            ${viewAlias}.fabric_slugs && $${fabricParam}::text[]
          ) THEN 25 ELSE 0 END +
          -- Neckline match (20 points)
          CASE WHEN (
            ${viewAlias}.neckline_slugs IS NOT NULL AND 
            ${viewAlias}.neckline_slugs && $${necklineParam}::text[]
          ) THEN 20 ELSE 0 END +
          -- Sleeve match (20 points)
          CASE WHEN (
            ${viewAlias}.sleeve_slugs IS NOT NULL AND 
            ${viewAlias}.sleeve_slugs && $${sleeveParam}::text[]
          ) THEN 20 ELSE 0 END +
          -- Style keyword match (15 points)
          CASE WHEN (
            ${viewAlias}.style_keyword_slugs IS NOT NULL AND 
            ${viewAlias}.style_keyword_slugs && $${styleParam}::text[]
          ) THEN 15 ELSE 0 END
        ) as relevance_score`;
      
      searchRelevanceOrder = 'relevance_score DESC';
    }
    
    conditions.push(searchCondition);
  }

  // Price range filter (indexed)
  if (filters.priceMin !== null && filters.priceMin !== undefined) {
    conditions.push(`${viewAlias}.single_price >= $${paramIndex}`);
    params.push(filters.priceMin);
    paramIndex++;
  }
  if (filters.priceMax !== null && filters.priceMax !== undefined) {
    conditions.push(`${viewAlias}.single_price <= $${paramIndex}`);
    params.push(filters.priceMax);
    paramIndex++;
  }

  // Gender filter (indexed)
  if (hasItems(filters.gender)) {
    conditions.push(`${viewAlias}.gender_slug = ANY($${paramIndex})`);
    params.push(filters.gender.map(g => g.toLowerCase()));
    paramIndex++;
  }

  // Age group filter (indexed)
  if (hasItems(filters.ageGroup)) {
    conditions.push(`${viewAlias}.age_group_slug = ANY($${paramIndex})`);
    params.push(filters.ageGroup.map(a => a.toLowerCase()));
    paramIndex++;
  }

  // Primary colour filter (indexed)
  if (hasItems(filters.primaryColour)) {
    conditions.push(`${viewAlias}.primary_colour IS NOT NULL AND LOWER(${viewAlias}.primary_colour) = ANY($${paramIndex})`);
    params.push(filters.primaryColour.map(c => c.toLowerCase()));
    paramIndex++;
  }

  // Colour shade filter (indexed)
  if (hasItems(filters.colourShade)) {
    conditions.push(`${viewAlias}.colour_shade IS NOT NULL AND LOWER(${viewAlias}.colour_shade) = ANY($${paramIndex})`);
    params.push(filters.colourShade.map(c => c.toLowerCase()));
    paramIndex++;
  }

  // Tag filter (indexed)
  if (hasItems(filters.tag)) {
    conditions.push(`LOWER(${viewAlias}.tag_slug) = ANY($${paramIndex})`);
    params.push(filters.tag.map(t => t.toLowerCase()));
    paramIndex++;
  }

  // Fit filter
  if (hasItems(filters.fit)) {
    conditions.push(`${viewAlias}.fit_slug IS NOT NULL AND LOWER(${viewAlias}.fit_slug) = ANY($${paramIndex})`);
    params.push(filters.fit.map(f => f.toLowerCase()));
    paramIndex++;
  }

  // Features filter - REMOVED: features column doesn't exist in view
  // If you need features filtering, add it to the view first
  // if (hasItems(filters.feature)) {
  //   // Skip - features column doesn't exist
  // }

  // Effect filter - OPTIMIZED: Use array column with GIN index (replaces ILIKE)
  if (hasItems(filters.effect)) {
    const normalizedEffects = filters.effect.map(e => e.toLowerCase());
    conditions.push(`${viewAlias}.effects_arr && $${paramIndex}::text[]`);
    params.push(normalizedEffects);
    paramIndex++;
  }

  // Sleeve filter - OPTIMIZED: Use precomputed array column (no EXISTS, no JOIN)
  if (hasItems(filters.sleeve)) {
    const normalizedSlugs = filters.sleeve.map(normalizeSlug);
    conditions.push(`${viewAlias}.sleeve_slugs && $${paramIndex}::text[]`);
    params.push(normalizedSlugs);
    paramIndex++;
  }

  // Neckline filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.neckline)) {
    const normalizedSlugs = filters.neckline.map(normalizeSlug);
    conditions.push(`${viewAlias}.neckline_slugs && $${paramIndex}::text[]`);
    params.push(normalizedSlugs);
    paramIndex++;
  }

  // Style keyword filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.style)) {
    const normalizedSlugs = filters.style.map(normalizeSlug);
    conditions.push(`${viewAlias}.style_keyword_slugs && $${paramIndex}::text[]`);
    params.push(normalizedSlugs);
    paramIndex++;
  }

  // Colour filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.colour)) {
    conditions.push(`${viewAlias}.colour_slugs && $${paramIndex}::text[]`);
    params.push(filters.colour.map(c => c.toLowerCase()));
    paramIndex++;
  }

  // Size filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.size)) {
    conditions.push(`${viewAlias}.size_slugs && $${paramIndex}::text[]`);
    params.push(filters.size.map(s => s.toLowerCase()));
    paramIndex++;
  }

  // Fabric filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.fabric)) {
    conditions.push(`${viewAlias}.fabric_slugs && $${paramIndex}::text[]`);
    params.push(filters.fabric.map(f => f.toLowerCase()));
    paramIndex++;
  }

  // Flag filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.flag)) {
    conditions.push(`${viewAlias}.flag_slugs && $${paramIndex}::text[]`);
    params.push(filters.flag.map(f => f.toLowerCase()));
    paramIndex++;
  }

  // Weight filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.weight)) {
    conditions.push(`${viewAlias}.weight_slugs && $${paramIndex}::text[]`);
    params.push(filters.weight.map(w => w.toLowerCase()));
    paramIndex++;
  }

  // Accreditations filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.accreditations)) {
    conditions.push(`${viewAlias}.accreditation_slugs && $${paramIndex}::text[]`);
    params.push(filters.accreditations.map(a => a.toLowerCase()));
    paramIndex++;
  }

  // Sector filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.sector)) {
    conditions.push(`${viewAlias}.sector_slugs && $${paramIndex}::text[]`);
    params.push(filters.sector.map(s => s.toLowerCase()));
    paramIndex++;
  }

  // Sport filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.sport)) {
    conditions.push(`${viewAlias}.sport_slugs && $${paramIndex}::text[]`);
    params.push(filters.sport.map(s => s.toLowerCase()));
    paramIndex++;
  }

  // Category filter - OPTIMIZED: Use precomputed category_ids array + cache table
  if (hasItems(filters.category)) {
    const categorySlugs = filters.category.filter(c => isNaN(parseInt(c)));
    const categoryIds = filters.category.filter(c => !isNaN(parseInt(c))).map(c => parseInt(c));
    
    let allCategoryIds = [...categoryIds];
    
    if (categorySlugs.length > 0) {
      const slugIds = await getCategoryIdsFromSlugs(categorySlugs);
      allCategoryIds = [...allCategoryIds, ...slugIds];
    }
    
    if (allCategoryIds.length > 0) {
      // Use cached hierarchy lookup (FAST - no recursive CTE per query)
      const categoryIdsWithChildren = await getCategoryIdsWithChildrenCached(allCategoryIds);
      
      if (categoryIdsWithChildren.length > 0) {
        // Use array overlap operator (GIN index, super fast)
        conditions.push(`${viewAlias}.category_ids && $${paramIndex}::int[]`);
        params.push(categoryIdsWithChildren);
        paramIndex++;
      }
    }
  }

  // Product type filter - matches product type names (e.g., "T-Shirts", "Hoodies")
  // Store product type filter info for use in query CTE
  let productTypeJoin = '';
  if (hasItems(filters.productType)) {
    // Normalize product type names - handle case-insensitive matching
    const normalizedProductTypes = filters.productType.map(pt => pt.trim().toLowerCase());
    // Build JOIN clause for first CTE - this ensures strict filtering at source
    // Apply filter directly in JOIN ON clause for stricter filtering
    productTypeJoin = `
      INNER JOIN styles s_pt ON ${viewAlias}.style_code = s_pt.style_code
      INNER JOIN product_types pt_pt ON s_pt.product_type_id = pt_pt.id 
        AND LOWER(TRIM(pt_pt.name)) = ANY($${paramIndex}::text[])`;
    params.push(normalizedProductTypes);
    paramIndex++;
  }

  // Always filter by Live status
  conditions.push(`${viewAlias}.sku_status = 'Live'`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : `WHERE ${viewAlias}.sku_status = 'Live'`;

  // Sorting
  let orderBy = `${viewAlias}.created_at ${order}`;
  if (sort === 'price') {
    orderBy = `${viewAlias}.single_price ${order}`;
  } else if (sort === 'name') {
    orderBy = `${viewAlias}.style_name ${order}`;
  }

  const limitParamIndex = params.length + 1;
  const offsetParamIndex = params.length + 2;
  
  const optimizedQuery = `
    WITH style_codes_filtered AS (
      SELECT DISTINCT ${viewAlias}.style_code
      ${hasSearch && searchRelevanceSelect ? `, ${searchRelevanceSelect}` : ''}
      FROM product_search_materialized ${viewAlias}
      ${productTypeJoin}
      ${whereClause}
    ),
    style_codes_with_meta AS (
      SELECT 
        scf.style_code,
        MIN(${viewAlias}.style_name) as style_name,
        MIN(${viewAlias}.single_price) as single_price,
        MIN(${viewAlias}.created_at) as created_at,
        MIN(COALESCE(pt.display_order, 999)) as product_type_priority
        ${hasSearch ? ', MAX(scf.relevance_score) as relevance_score' : ''}
      FROM style_codes_filtered scf
      INNER JOIN product_search_materialized ${viewAlias} ON scf.style_code = ${viewAlias}.style_code
      LEFT JOIN styles s ON ${viewAlias}.style_code = s.style_code
        LEFT JOIN product_types pt ON s.product_type_id = pt.id
      WHERE ${viewAlias}.sku_status = 'Live'
      GROUP BY scf.style_code
      ),
    paginated_style_codes AS (
        SELECT style_code
      FROM style_codes_with_meta
        ORDER BY 
          ${hasSearch && searchRelevanceOrder ? `${searchRelevanceOrder}, ` : ''}
          product_type_priority ASC,
          ${sort === 'price' ? 'single_price' : sort === 'name' ? 'style_name' : 'created_at'} ${order}
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      ),
      total_count AS (
      SELECT COUNT(*) as total
      FROM style_codes_filtered
      ),
      price_range AS (
        SELECT 
          MIN(${viewAlias}.single_price) as min_price,
          MAX(${viewAlias}.single_price) as max_price
        FROM style_codes_filtered scf
        INNER JOIN product_search_materialized ${viewAlias} ON scf.style_code = ${viewAlias}.style_code
        WHERE ${viewAlias}.sku_status = 'Live'
      )
      SELECT 
      psc.style_code,
        tc.total,
        pr.min_price,
        pr.max_price
    FROM paginated_style_codes psc
      CROSS JOIN total_count tc
      CROSS JOIN price_range pr
    `;
    
    params.push(limit, offset);
  
  try {
    const startTime = Date.now();
    
    // Check cache for total count and price range (they change less frequently)
    const countCacheKey = getCacheKey(filters, 0, 0, 'count');
    const priceRangeCacheKey = getCacheKey(filters, 0, 0, 'priceRange');
    const cachedCount = getCached(countCacheKey);
    const cachedPriceRange = getCached(priceRangeCacheKey);
    
    // STEP 1: Get style codes only (FAST - uses materialized view with array columns)
    // If we have cached count/priceRange, we can simplify the query
    let queryResult;
    if (cachedCount && cachedPriceRange) {
      // Simplified query - skip count and price range calculation
      const simplifiedQuery = `
        WITH style_codes_filtered AS (
          SELECT DISTINCT ${viewAlias}.style_code
          ${hasSearch && searchRelevanceSelect ? `, ${searchRelevanceSelect}` : ''}
          FROM product_search_materialized ${viewAlias}
          ${productTypeJoin}
          ${whereClause}
        ),
        style_codes_with_meta AS (
      SELECT 
            scf.style_code,
            MIN(${viewAlias}.style_name) as style_name,
            MIN(${viewAlias}.single_price) as single_price,
            MIN(${viewAlias}.created_at) as created_at,
            MIN(COALESCE(pt.display_order, 999)) as product_type_priority
            ${hasSearch ? ', MAX(scf.relevance_score) as relevance_score' : ''}
          FROM style_codes_filtered scf
          INNER JOIN product_search_materialized ${viewAlias} ON scf.style_code = ${viewAlias}.style_code
          LEFT JOIN styles s ON ${viewAlias}.style_code = s.style_code
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
          WHERE ${viewAlias}.sku_status = 'Live'
          GROUP BY scf.style_code
        ),
        paginated_style_codes AS (
      SELECT style_code
          FROM style_codes_with_meta
      ORDER BY 
        ${hasSearch && searchRelevanceOrder ? `${searchRelevanceOrder}, ` : ''}
        product_type_priority ASC,
        ${sort === 'price' ? 'single_price' : sort === 'name' ? 'style_name' : 'created_at'} ${order}
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
    )
    SELECT 
          psc.style_code,
          $${params.length + 1}::bigint as total,
          $${params.length + 2}::numeric as min_price,
          $${params.length + 3}::numeric as max_price
        FROM paginated_style_codes psc
      `;
      params.push(cachedCount, cachedPriceRange.min, cachedPriceRange.max);
      queryResult = await queryWithTimeout(simplifiedQuery, params, 30000);
    } else {
      queryResult = await queryWithTimeout(optimizedQuery, params, 30000);
    }
    
    const queryTime = Date.now() - startTime;
    console.log(`[QUERY] Filter query: ${queryTime}ms`);
    
    if (queryResult.rows.length === 0) {
      return { items: [], total: 0, priceRange: { min: 0, max: 0 } };
    }
    
    const firstRow = queryResult.rows[0];
    let total = parseInt(firstRow.total) || 0;
    let priceRange = {
      min: parseFloat(firstRow.min_price) || 0,
      max: parseFloat(firstRow.max_price) || 0
    };
    
    // Cache count and price range separately (longer TTL - they change less frequently)
    if (!cachedCount) {
      setCache(countCacheKey, total, COUNT_CACHE_TTL);
    } else {
      total = cachedCount;
    }
    
    if (!cachedPriceRange) {
      setCache(priceRangeCacheKey, priceRange, COUNT_CACHE_TTL);
    } else {
      priceRange = cachedPriceRange;
    }
    
    const styleCodes = queryResult.rows.map(row => row.style_code);
    
    if (styleCodes.length === 0) {
      return { items: [], total, priceRange };
    }

    // STEP 2: Fetch full details for only the paginated style codes (SMALL DATASET)
    const batchStartTime = Date.now();
    const batchQuery = `
      SELECT DISTINCT
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
        t.name as tag,
        t.slug as tag_slug,
        p.created_at
      FROM products p
      INNER JOIN styles s ON p.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN sizes sz ON p.size_id = sz.id
      LEFT JOIN tags t ON p.tag_id = t.id
      WHERE p.style_code = ANY($1) AND p.sku_status = 'Live'
      ORDER BY p.style_code, p.colour_name, sz.size_order
    `;

    const batchResult = await queryWithTimeout(batchQuery, [styleCodes], 30000);
    const batchQueryTime = Date.now() - batchStartTime;
    console.log(`[QUERY] Details query: ${batchQueryTime}ms`);

    // Group results by style_code
    const productsMap = new Map();
    
    batchResult.rows.forEach(row => {
      const styleCode = row.code;
      if (!productsMap.has(styleCode)) {
        productsMap.set(styleCode, {
          code: styleCode,
          name: row.name,
          brand: row.brand,
          colorsMap: new Map(),
          sizesSet: new Set(),
          prices: [],
          singlePrice: null,
          packPrice: null,
          cartonPrice: null,
          customization: new Set(),
          primaryImageUrl: row.primary_image_url
        });
      }

      const product = productsMap.get(styleCode);

      if (row.size) {
        product.sizesSet.add(row.size);
      }

      const colorKey = row.colour_name || row.primary_colour || 'Unknown';
      if (!product.colorsMap.has(colorKey)) {
        product.colorsMap.set(colorKey, {
          name: colorKey,
          main: row.colour_image_url || row.primary_image_url || '',
          thumb: row.colour_image_url || row.primary_image_url || ''
        });
      }

      if (row.single_price) {
        product.prices.push(parseFloat(row.single_price));
        if (!product.singlePrice) {
          product.singlePrice = parseFloat(row.single_price);
        }
      }
      if (row.pack_price) {
        product.prices.push(parseFloat(row.pack_price));
        if (!product.packPrice) {
          product.packPrice = parseFloat(row.pack_price);
        }
      }
      if (row.carton_price) {
        product.prices.push(parseFloat(row.carton_price));
        if (!product.cartonPrice) {
          product.cartonPrice = parseFloat(row.carton_price);
        }
      }

      if (row.tag) {
        product.customization.add(row.tag.toLowerCase());
      }
    });

    // Build response items
    const items = styleCodes.map(styleCode => {
      const product = productsMap.get(styleCode);
      if (!product) return null;

      let packPrice = product.packPrice || product.singlePrice;
      let cartonPrice = product.cartonPrice || packPrice || product.singlePrice;
      const priceTiers = [product.singlePrice, packPrice, cartonPrice].filter(p => p !== null && p > 0);
      const priceBreaks = buildPriceBreaks(priceTiers);

      const customization = product.customization.size > 0 
        ? Array.from(product.customization) 
        : ['print', 'embroidery'];

      const sizes = Array.from(product.sizesSet).sort((a, b) => {
        const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
        const aIndex = sizeOrder.indexOf(a.toUpperCase());
        const bIndex = sizeOrder.indexOf(b.toUpperCase());
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.localeCompare(b);
      });

      return {
        code: product.code,
        name: product.name,
        price: Math.min(...product.prices.filter(p => p > 0)),
        image: product.primaryImageUrl || '',
        colors: Array.from(product.colorsMap.values()),
        sizes,
        customization,
        brand: product.brand || '',
        priceBreaks
      };
    }).filter(item => item !== null);

    const totalTime = Date.now() - startTime;
    console.log(`[QUERY] Total product list: ${totalTime}ms`);

    const queryResponse = { items, total, priceRange };
    
    if (totalTime < 5000) {
      setCache(cacheKey, queryResponse, CACHE_TTL);
      console.log(`[CACHE] Result cached (TTL: ${CACHE_TTL/1000}s)`);
    } else {
      console.log(`[CACHE] Query too slow (${totalTime}ms) - skipping cache`);
    }

    return queryResponse;
  } catch (error) {
    console.error('[ERROR] buildProductListQuery failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

function buildPriceBreaks(prices) {
  if (prices.length === 0) return [];

  const sortedPrices = [...prices].sort((a, b) => b - a);
  const breaks = [];

  if (sortedPrices.length >= 3) {
    breaks.push({ min: 1, max: 9, price: sortedPrices[0] });
    breaks.push({ min: 10, max: 24, price: sortedPrices[1] });
    breaks.push({ min: 25, max: 99999, price: sortedPrices[2] });
  } else if (sortedPrices.length === 2) {
    breaks.push({ min: 1, max: 9, price: sortedPrices[0] });
    breaks.push({ min: 10, max: 99999, price: sortedPrices[1] });
  } else {
    breaks.push({ min: 1, max: 99999, price: sortedPrices[0] });
  }

  return breaks;
}

async function buildProductDetailQuery(styleCode) {
  const cacheKey = `product_detail_${styleCode}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[CACHE] Hit for product detail: ${styleCode}`);
    return cached;
  }

  const startTime = Date.now();
  
  const detailQuery = `
    SELECT 
      s.style_code,
      s.style_name,
      s.specification as description,
      s.fabric_description,
      b.name as brand,
      p.colour_name,
      p.primary_colour,
      p.colour_shade,
      p.colour_image_url,
      p.primary_image_url,
      sz.name as size,
      sz.size_order,
      p.single_price,
      p.pack_price,
      p.carton_price,
      t.name as tag
    FROM styles s
    LEFT JOIN brands b ON s.brand_id = b.id
    LEFT JOIN products p ON p.style_code = s.style_code AND p.sku_status = 'Live'
    LEFT JOIN sizes sz ON p.size_id = sz.id
    LEFT JOIN tags t ON p.tag_id = t.id
    WHERE s.style_code = $1
    ORDER BY p.colour_name, sz.size_order
  `;

  const detailResult = await queryWithTimeout(detailQuery, [styleCode], 10000);
  const queryTime = Date.now() - startTime;
  console.log(`[QUERY] Product detail: ${queryTime}ms`);
  
  if (detailResult.rows.length === 0) {
    return null;
  }

  const firstRow = detailResult.rows[0];
  const colorsMap = new Map();
  const sizesSet = new Set();
  const prices = [];
  const customizationSet = new Set();
  let mainImage = firstRow.primary_image_url || '';

  detailResult.rows.forEach(row => {
    if (row.size) {
      sizesSet.add(row.size);
    }

    const colorKey = row.colour_name || row.primary_colour || 'Unknown';
    if (!colorsMap.has(colorKey)) {
      const colorImage = row.colour_image_url || row.primary_image_url || '';
      colorsMap.set(colorKey, {
        name: colorKey,
        main: colorImage,
        thumb: colorImage
      });
    }

    if (row.single_price) prices.push(parseFloat(row.single_price));
    if (row.pack_price) prices.push(parseFloat(row.pack_price));
    if (row.carton_price) prices.push(parseFloat(row.carton_price));

    if (row.tag) {
      customizationSet.add(row.tag.toLowerCase());
    }
  });

  let singlePrice = null;
  let packPrice = null;
  let cartonPrice = null;

  detailResult.rows.forEach(row => {
    if (!singlePrice && row.single_price) singlePrice = parseFloat(row.single_price);
    if (!packPrice && row.pack_price) packPrice = parseFloat(row.pack_price);
    if (!cartonPrice && row.carton_price) cartonPrice = parseFloat(row.carton_price);
  });

  if (!packPrice) packPrice = singlePrice;
  if (!cartonPrice) cartonPrice = packPrice || singlePrice;
  
  const priceTiers = [singlePrice, packPrice, cartonPrice].filter(p => p !== null && p > 0);
  const priceBreaks = buildPriceBreaks(priceTiers);

  const sizes = Array.from(sizesSet).sort((a, b) => {
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
    const aIndex = sizeOrder.indexOf(a.toUpperCase());
    const bIndex = sizeOrder.indexOf(b.toUpperCase());
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  }).slice(0, 5);

  const colors = Array.from(colorsMap.values());
  
  if (colors.length === 0) {
    colors.push({
      name: 'Unknown',
      main: mainImage || '',
      thumb: mainImage || ''
    });
  }

  const images = [];
  let productMainImage = mainImage;
  
  if (!productMainImage && colors.length > 0 && colors[0].main) {
    productMainImage = colors[0].main;
  }
  
  if (productMainImage) {
    images.push({ url: productMainImage, type: 'main' });
  }
  
  colors.forEach(color => {
    if (color.main && color.main !== productMainImage) {
      images.push({ url: color.main, type: 'thumb' });
    }
  });

  const minPrice = prices.length > 0 ? Math.min(...prices.filter(p => p > 0)) : 0;
  
  const productDetail = {
    code: styleCode,
    name: firstRow.style_name || '',
    brand: firstRow.brand || '',
    price: minPrice,
    basePrice: minPrice,
    priceBreaks: priceBreaks || [],
    colors: colors,
    sizes: sizes.length > 0 ? sizes : [],
    images: images,
    description: firstRow.description || '',
    details: {
      fit: '',
      fabric: firstRow.fabric_description || '',
      weight: '',
      care: ''
    },
    customization: customizationSet.size > 0 ? Array.from(customizationSet) : ['print', 'embroidery']
  };

  // Cache product details (longer TTL - product details change less frequently)
  setCache(cacheKey, productDetail, COUNT_CACHE_TTL);
  
  return productDetail;
}

module.exports = {
  buildProductListQuery,
  buildProductDetailQuery,
  clearCache
};
