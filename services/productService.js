const { pool, queryWithTimeout } = require('../config/database');
const { getCategoryIdsFromSlugs } = require('./categoryService');
// No longer need price markup utilities - using sell_price directly from DB

const queryCache = new Map();
const aggregationCache = new Map(); // Separate cache for aggregations

// AGGRESSIVE CACHING for instant loading
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes (was 5)
const COUNT_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours (was 1 hour)
const SEARCH_CACHE_TTL = 60 * 60 * 1000; // 1 hour for searches (was 10 minutes)
const AGGREGATION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for aggregations

// PAGINATION CONFIGURATION - Enterprise-level settings
const PAGINATION_CONFIG = {
  // Maximum colors per product estimate (used for batch query limit calculation)
  MAX_COLORS_PER_PRODUCT: 50,
  // Absolute maximum rows to fetch in batch query (safety limit)
  MAX_BATCH_ROWS: 10000,
  // Minimum batch rows (ensures small requests work)
  MIN_BATCH_ROWS: 500,
  // Maximum page size allowed
  MAX_PAGE_SIZE: 200,
  // Default page size
  DEFAULT_PAGE_SIZE: 24
};

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
  const cacheKey = `query_${Math.abs(hash)}_${type}`;
  return cacheKey;
}

function getCached(key, cacheMap = queryCache) {
  const cached = cacheMap.get(key);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > cached.ttl) {
    cacheMap.delete(key);
    return null;
  }
  
  return cached.data;
}

function setAggregationCache(key, data, ttl = AGGREGATION_CACHE_TTL) {
  if (aggregationCache.size >= 500) {
    const firstKey = aggregationCache.keys().next().value;
    aggregationCache.delete(firstKey);
  }
  
  aggregationCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
}

function getAggregationCache(key) {
  return getCached(key, aggregationCache);
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
  // Just lowercase - don't strip trailing numbers as they may be part of actual slugs
  // e.g., "long-sleeve-2" is a valid slug in the database
  return slug.toLowerCase().trim();
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

// Build filter aggregations - ENHANCED: Returns full metadata (slug, name, count) for dynamic frontend
async function buildFilterAggregations(filters, viewAlias = 'psm', preFilteredStyleCodes = null) {
  // Check cache first
  const cacheKey = getCacheKey(filters, 1, 1, 'aggregations_v2');
  const cachedAggregations = getAggregationCache(cacheKey);
  if (cachedAggregations) {
    console.log('[FILTER AGGREGATIONS] Cache hit');
    return cachedAggregations;
  }
  
  const startTime = Date.now();
  
  // Initialize ALL filter types as arrays (always return all, even if empty)
  const aggregations = {
    gender: [],
    ageGroup: [],
    sleeve: [],
    neckline: [],
    accreditations: [],
    primaryColour: [],
    colourShade: [],
    style: [],
    feature: [],
    size: [],
    fabric: [],
    weight: [],
    fit: [],
    sector: [],
    sport: [],
    tag: [],
    effect: []
  };
  
  // Build base WHERE conditions (applied to all aggregations)
  const buildBaseConditions = () => {
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    // Pre-filtered style codes for search optimization
    const hasSearch = !!(filters.q || filters.text);
    const usePreFiltered = hasSearch && preFilteredStyleCodes && preFilteredStyleCodes.length > 0 && preFilteredStyleCodes.length < 5000;
    
    if (usePreFiltered) {
      conditions.push(`psm.style_code = ANY($${paramIndex}::text[])`);
      params.push(preFilteredStyleCodes);
      paramIndex++;
    }
    
    // Always filter by Live status
    conditions.push(`psm.sku_status = 'Live'`);
    
    // Product type filter
    let productTypeJoin = '';
    if (hasItems(filters.productType)) {
      const normalizeProductType = (pt) => {
        const normalized = pt.trim().toLowerCase().replace(/[- ]/g, '');
        if (normalized.includes('tshirt')) {
          return normalized.includes('shirts') ? 'tshirts' : 'tshirt';
        }
        return normalized;
      };
      const uniqueProductTypes = [...new Set(filters.productType.map(normalizeProductType))];
      productTypeJoin = `
        INNER JOIN styles s_pt ON psm.style_code = s_pt.style_code
        INNER JOIN product_types pt_pt ON s_pt.product_type_id = pt_pt.id 
          AND LOWER(REPLACE(REPLACE(pt_pt.name, '-', ''), ' ', '')) = ANY($${paramIndex}::text[])`;
      params.push(uniqueProductTypes);
      paramIndex++;
    }
    
    // Price filters
    if (filters.priceMin !== null && filters.priceMin !== undefined) {
      conditions.push(`psm.sell_price >= $${paramIndex}`);
      params.push(filters.priceMin);
      paramIndex++;
    }
    if (filters.priceMax !== null && filters.priceMax !== undefined) {
      conditions.push(`psm.sell_price <= $${paramIndex}`);
      params.push(filters.priceMax);
      paramIndex++;
    }
    
    // Apply all active filters (for cross-filter counting)
    if (hasItems(filters.gender)) {
      conditions.push(`psm.gender_slug = ANY($${paramIndex})`);
      params.push(filters.gender.map(g => g.toLowerCase()));
      paramIndex++;
    }
    if (hasItems(filters.ageGroup)) {
      conditions.push(`psm.age_group_slug = ANY($${paramIndex})`);
      params.push(filters.ageGroup.map(a => a.toLowerCase()));
      paramIndex++;
    }
    if (hasItems(filters.primaryColour)) {
      conditions.push(`LOWER(psm.primary_colour) = ANY($${paramIndex})`);
      params.push(filters.primaryColour.map(c => c.toLowerCase()));
      paramIndex++;
    }
    if (hasItems(filters.sleeve)) {
      conditions.push(`psm.sleeve_slugs::text[] && $${paramIndex}::text[]`);
      params.push(filters.sleeve.map(s => s.toLowerCase()));
      paramIndex++;
    }
    if (hasItems(filters.neckline)) {
      conditions.push(`psm.neckline_slugs::text[] && $${paramIndex}::text[]`);
      params.push(filters.neckline.map(n => n.toLowerCase()));
      paramIndex++;
    }
    if (hasItems(filters.fabric)) {
      conditions.push(`psm.fabric_slugs::text[] && $${paramIndex}::text[]`);
      params.push(filters.fabric.map(f => f.toLowerCase()));
      paramIndex++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, productTypeJoin, params };
  };
  
  try {
    const base = buildBaseConditions();
    
    // 🚀 ENHANCED: Single combined query with JOINs to lookup tables for names
    // Returns: filter_type, slug, name, count for fully dynamic frontend
    const combinedQuery = `
      WITH base_products AS (
        SELECT DISTINCT 
          psm.style_code,
          psm.gender_slug,
          psm.age_group_slug,
          psm.tag_slug,
          psm.primary_colour,
          psm.colour_shade,
          psm.sleeve_slugs,
          psm.neckline_slugs,
          psm.fabric_slugs,
          psm.size_slugs,
          psm.style_keyword_slugs,
          psm.weight_slugs,
          psm.fit_slugs,
          psm.feature_slugs,
          psm.effects_arr,
          psm.accreditation_slugs,
          psm.sector_slugs,
          psm.sport_slugs
        FROM product_search_materialized psm
        ${base.productTypeJoin}
        ${base.whereClause}
      ),
      
      -- Gender aggregation with lookup
      gender_agg AS (
        SELECT 
          'gender' as filter_type, 
          g.slug, 
          g.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp
        JOIN genders g ON bp.gender_slug = g.slug
        WHERE bp.gender_slug IS NOT NULL
        GROUP BY g.slug, g.name
        ORDER BY count DESC
      ),
      
      -- Age Group aggregation with lookup
      age_agg AS (
        SELECT 
          'ageGroup' as filter_type, 
          ag.slug, 
          ag.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp
        JOIN age_groups ag ON bp.age_group_slug = ag.slug
        WHERE bp.age_group_slug IS NOT NULL
        GROUP BY ag.slug, ag.name
        ORDER BY count DESC
      ),
      
      -- Tag aggregation with lookup
      tag_agg AS (
        SELECT 
          'tag' as filter_type, 
          t.slug, 
          t.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp
        JOIN tags t ON LOWER(bp.tag_slug) = LOWER(t.slug)
        WHERE bp.tag_slug IS NOT NULL AND bp.tag_slug != ''
        GROUP BY t.slug, t.name
        ORDER BY count DESC
        LIMIT 20
      ),
      
      -- Primary Colour (name = capitalized slug)
      primary_colour_agg AS (
        SELECT 
          'primaryColour' as filter_type, 
          LOWER(primary_colour) as slug, 
          INITCAP(primary_colour) as name,
          COUNT(DISTINCT style_code)::int as count
        FROM base_products
        WHERE primary_colour IS NOT NULL AND primary_colour != ''
        GROUP BY LOWER(primary_colour), INITCAP(primary_colour)
        ORDER BY count DESC
        LIMIT 30
      ),
      
      -- Colour Shade (name from data)
      colour_shade_agg AS (
        SELECT 
          'colourShade' as filter_type, 
          LOWER(colour_shade) as slug, 
          colour_shade as name,
          COUNT(DISTINCT style_code)::int as count
        FROM base_products
        WHERE colour_shade IS NOT NULL AND colour_shade != ''
        GROUP BY LOWER(colour_shade), colour_shade
        ORDER BY count DESC
        LIMIT 50
      ),
      
      -- Sleeve aggregation with lookup
      sleeve_agg AS (
        SELECT 
          'sleeve' as filter_type, 
          sk.slug, 
          sk.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.sleeve_slugs) as arr_slug
        JOIN style_keywords sk ON arr_slug = sk.slug
        WHERE bp.sleeve_slugs IS NOT NULL AND array_length(bp.sleeve_slugs, 1) > 0
        GROUP BY sk.slug, sk.name
        ORDER BY count DESC
        LIMIT 30
      ),
      
      -- Neckline aggregation with lookup
      neckline_agg AS (
        SELECT 
          'neckline' as filter_type, 
          sk.slug, 
          sk.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.neckline_slugs) as arr_slug
        JOIN style_keywords sk ON arr_slug = sk.slug
        WHERE bp.neckline_slugs IS NOT NULL AND array_length(bp.neckline_slugs, 1) > 0
        GROUP BY sk.slug, sk.name
        ORDER BY count DESC
        LIMIT 30
      ),
      
      -- Fabric aggregation with lookup
      fabric_agg AS (
        SELECT 
          'fabric' as filter_type, 
          f.slug, 
          f.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.fabric_slugs) as arr_slug
        JOIN fabrics f ON arr_slug = f.slug
        WHERE bp.fabric_slugs IS NOT NULL AND array_length(bp.fabric_slugs, 1) > 0
        GROUP BY f.slug, f.name
        ORDER BY count DESC
        LIMIT 30
      ),
      
      -- Size aggregation with lookup (includes size_order for sorting)
      size_agg AS (
        SELECT 
          'size' as filter_type, 
          s.slug, 
          s.name,
          COUNT(DISTINCT bp.style_code)::int as count,
          s.size_order
        FROM base_products bp, unnest(bp.size_slugs) as arr_slug
        JOIN sizes s ON arr_slug = s.slug
        WHERE bp.size_slugs IS NOT NULL AND array_length(bp.size_slugs, 1) > 0
        GROUP BY s.slug, s.name, s.size_order
        ORDER BY s.size_order ASC NULLS LAST, count DESC
        LIMIT 50
      ),
      
      -- Style Keywords aggregation with lookup
      style_agg AS (
        SELECT 
          'style' as filter_type, 
          sk.slug, 
          sk.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.style_keyword_slugs) as arr_slug
        JOIN style_keywords sk ON arr_slug = sk.slug
        WHERE bp.style_keyword_slugs IS NOT NULL AND array_length(bp.style_keyword_slugs, 1) > 0
        GROUP BY sk.slug, sk.name
        ORDER BY count DESC
        LIMIT 50
      ),
      
      -- Weight aggregation with lookup
      weight_agg AS (
        SELECT 
          'weight' as filter_type, 
          wr.slug, 
          wr.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.weight_slugs) as arr_slug
        JOIN weight_ranges wr ON arr_slug = wr.slug
        WHERE bp.weight_slugs IS NOT NULL AND array_length(bp.weight_slugs, 1) > 0
        GROUP BY wr.slug, wr.name
        ORDER BY wr.name ASC
        LIMIT 20
      ),
      
      -- Fit aggregation with lookup
      fit_agg AS (
        SELECT 
          'fit' as filter_type, 
          sk.slug, 
          sk.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.fit_slugs) as arr_slug
        JOIN style_keywords sk ON arr_slug = sk.slug
        WHERE bp.fit_slugs IS NOT NULL AND array_length(bp.fit_slugs, 1) > 0
        GROUP BY sk.slug, sk.name
        ORDER BY count DESC
        LIMIT 20
      ),
      
      -- Feature aggregation with lookup
      feature_agg AS (
        SELECT 
          'feature' as filter_type, 
          sk.slug, 
          sk.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.feature_slugs) as arr_slug
        JOIN style_keywords sk ON arr_slug = sk.slug
        WHERE bp.feature_slugs IS NOT NULL AND array_length(bp.feature_slugs, 1) > 0
        GROUP BY sk.slug, sk.name
        ORDER BY count DESC
        LIMIT 50
      ),
      
      -- Effect aggregation with lookup
      effect_agg AS (
        SELECT 
          'effect' as filter_type, 
          e.slug, 
          e.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.effects_arr) as arr_slug
        JOIN effects e ON arr_slug = e.slug
        WHERE bp.effects_arr IS NOT NULL AND array_length(bp.effects_arr, 1) > 0
        GROUP BY e.slug, e.name
        ORDER BY count DESC
        LIMIT 20
      ),
      
      -- Accreditations aggregation with lookup
      accreditations_agg AS (
        SELECT 
          'accreditations' as filter_type, 
          a.slug, 
          a.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.accreditation_slugs) as arr_slug
        JOIN accreditations a ON arr_slug = a.slug
        WHERE bp.accreditation_slugs IS NOT NULL AND array_length(bp.accreditation_slugs, 1) > 0
        GROUP BY a.slug, a.name
        ORDER BY count DESC
        LIMIT 50
      ),
      
      -- Sector aggregation with lookup
      sector_agg AS (
        SELECT 
          'sector' as filter_type, 
          rs.slug, 
          rs.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.sector_slugs) as arr_slug
        JOIN related_sectors rs ON arr_slug = rs.slug
        WHERE bp.sector_slugs IS NOT NULL AND array_length(bp.sector_slugs, 1) > 0
        GROUP BY rs.slug, rs.name
        ORDER BY count DESC
        LIMIT 20
      ),
      
      -- Sport aggregation with lookup
      sport_agg AS (
        SELECT 
          'sport' as filter_type, 
          rsp.slug, 
          rsp.name,
          COUNT(DISTINCT bp.style_code)::int as count
        FROM base_products bp, unnest(bp.sport_slugs) as arr_slug
        JOIN related_sports rsp ON arr_slug = rsp.slug
        WHERE bp.sport_slugs IS NOT NULL AND array_length(bp.sport_slugs, 1) > 0
        GROUP BY rsp.slug, rsp.name
        ORDER BY count DESC
        LIMIT 20
      )
      
      -- Combine all aggregations
      SELECT filter_type, slug, name, count FROM gender_agg
      UNION ALL SELECT filter_type, slug, name, count FROM age_agg
      UNION ALL SELECT filter_type, slug, name, count FROM tag_agg
      UNION ALL SELECT filter_type, slug, name, count FROM primary_colour_agg
      UNION ALL SELECT filter_type, slug, name, count FROM colour_shade_agg
      UNION ALL SELECT filter_type, slug, name, count FROM sleeve_agg
      UNION ALL SELECT filter_type, slug, name, count FROM neckline_agg
      UNION ALL SELECT filter_type, slug, name, count FROM fabric_agg
      UNION ALL SELECT filter_type, slug, name, count FROM size_agg
      UNION ALL SELECT filter_type, slug, name, count FROM style_agg
      UNION ALL SELECT filter_type, slug, name, count FROM weight_agg
      UNION ALL SELECT filter_type, slug, name, count FROM fit_agg
      UNION ALL SELECT filter_type, slug, name, count FROM feature_agg
      UNION ALL SELECT filter_type, slug, name, count FROM effect_agg
      UNION ALL SELECT filter_type, slug, name, count FROM accreditations_agg
      UNION ALL SELECT filter_type, slug, name, count FROM sector_agg
      UNION ALL SELECT filter_type, slug, name, count FROM sport_agg
    `;
    
    const result = await queryWithTimeout(combinedQuery, base.params, 30000);
    
    // Process results into arrays of objects with full metadata
    result.rows.forEach(row => {
      if (row.slug && row.filter_type && aggregations[row.filter_type]) {
        aggregations[row.filter_type].push({
          slug: row.slug,
          name: row.name || row.slug, // Fallback to slug if name is missing
          count: parseInt(row.count)
        });
      }
    });
    
    const duration = Date.now() - startTime;
    console.log(`[FILTER AGGREGATIONS] Completed in ${duration}ms (single query with names, ${result.rows.length} results)`);
    
    // Cache the results
    setAggregationCache(cacheKey, aggregations);
    
    return aggregations;
  } catch (error) {
    console.error('[ERROR] buildFilterAggregations failed:', error.message);
    // Return initialized aggregations on error (don't break the main query)
    return aggregations;
  }
}

async function buildProductListQuery(filters, page, limit) {
  const cacheKey = getCacheKey(filters, page, limit);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[CACHE] Hit - returning cached result`);
    return cached;
  }

  // ENTERPRISE-LEVEL: When color or price filters are active, fetch more items to account for post-filtering
  // This ensures we return the correct number of items after strict filtering
  const hasPriceFilter = (filters.priceMin !== null && filters.priceMin !== undefined) || 
                         (filters.priceMax !== null && filters.priceMax !== undefined);
  const hasColorFilter = hasItems(filters.primaryColour) || hasItems(filters.colourShade) || hasItems(filters.colour);
  const hasStrictFilters = hasPriceFilter || hasColorFilter;
  const fetchLimit = hasStrictFilters ? Math.min(limit * 3, 200) : limit; // Fetch up to 3x limit or 200, whichever is smaller
  const offset = (page - 1) * limit;
  
  // ENTERPRISE-LEVEL: Log active filters for debugging
  const activeFilters = {
    primaryColour: filters.primaryColour,
    colourShade: filters.colourShade,
    colour: filters.colour,
    priceMin: filters.priceMin,
    priceMax: filters.priceMax
  };
  console.log(`[FILTER DEBUG] Active color/price filters:`, JSON.stringify(activeFilters));
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
      // OPTIMIZED: Natural language search - Performance focused with flexible matching
      const searchTerms = trimmedSearch.split(/\s+/).filter(t => t.length > 0);
      
      // Create flexible search variations (handle hyphens/spaces)
      const createSearchVariations = (term) => {
        const variations = new Set();
        const lower = term.toLowerCase();
        
        // Original term
        variations.add(lower);
        
        // Common hyphen variations
        if (lower.includes('tshirt')) {
          variations.add(lower.replace(/tshirt/g, 't-shirt'));
          variations.add(lower.replace(/tshirt/g, 't shirt'));
        }
        if (lower.includes('tshirts')) {
          variations.add(lower.replace(/tshirts/g, 't-shirts'));
          variations.add(lower.replace(/tshirts/g, 't shirts'));
        }
        if (lower.includes('vneck')) {
          variations.add(lower.replace(/vneck/g, 'v-neck'));
        }
        if (lower.includes('crewneck')) {
          variations.add(lower.replace(/crewneck/g, 'crew-neck'));
        }
        
        // Without hyphens (tshirt from t-shirt)
        variations.add(lower.replace(/-/g, ''));
        
        // With spaces (t shirt from t-shirt)
        variations.add(lower.replace(/-/g, ' '));
        
        return Array.from(variations);
      };
      
      // Generate all search variations
      const allVariations = searchTerms.flatMap(createSearchVariations);
      // For full-text search, include variations so "tshirts" also searches for "t-shirts"
      // Join all variations with OR for better matching
      const searchVariationsForText = allVariations.filter((v, i, arr) => arr.indexOf(v) === i); // unique
      const normalizedSearch = searchVariationsForText.join(' ');
      const searchUpper = normalizedSearch.toUpperCase();
      
      // Create hyphen-normalized version for array matching
      const normalizeTerm = (term, type) => {
        const lower = term.toLowerCase();
        // Handle common hyphen variations
        if (lower.includes('tshirt')) {
          const base = lower.replace(/tshirt/g, 't-shirt');
          return base.replace(/[^a-z0-9-]/g, '-');
        }
        switch(type) {
          case 'neckline':
            if (lower.includes('crew') || lower.includes('crewneck')) return 'crew-neck-2';
            if (lower.includes('vneck') || lower.includes('v-neck')) return 'v-neck-2';
            return lower.replace(/[^a-z0-9]/g, '-');
          case 'sleeve':
            if (lower.includes('long')) return 'long-sleeve-2';
            if (lower.includes('short')) return 'short-sleeve-2';
            return lower.replace(/[^a-z0-9]/g, '-');
          default:
            return lower.replace(/[^a-z0-9]/g, '-');
        }
      };
      
      // Pre-compute normalized terms (try both with and without hyphens)
      // This ensures "tshirt" matches "t-shirt" in array columns
      const getTermVariations = (term, type) => {
        const normalized = normalizeTerm(term, type);
        const variations = new Set([normalized]);
        
        // Add without hyphens
        variations.add(normalized.replace(/-/g, ''));
        
        // Add with hyphens for common cases
        if (term.toLowerCase().includes('tshirt')) {
          variations.add('t-shirt');
          variations.add('t-shirts');
        }
        if (term.toLowerCase().includes('vneck')) {
          variations.add('v-neck-2');
        }
        if (term.toLowerCase().includes('crewneck')) {
          variations.add('crew-neck-2');
        }
        
        return Array.from(variations);
      };
      
      const colorTerms = searchTerms.flatMap(t => getTermVariations(t, 'color'));
      const fabricTerms = searchTerms.flatMap(t => getTermVariations(t, 'fabric'));
      const necklineTerms = searchTerms.flatMap(t => getTermVariations(t, 'neckline'));
      const sleeveTerms = searchTerms.flatMap(t => getTermVariations(t, 'sleeve'));
      const styleTerms = searchTerms.flatMap(t => getTermVariations(t, 'style'));
      
      // OPTIMIZED: Prioritize indexed operations - full-text search first (GIN index)
      // Use to_tsquery with OR for flexible matching
      const fullTextParam = paramIndex;
      params.push(normalizedSearch);
    paramIndex++;
      
      const codeParam = paramIndex;
      params.push(searchUpper);
      paramIndex++;
      
      const codePrefixParam = paramIndex;
      params.push(`${searchUpper}%`);
      paramIndex++;
      
      // Add flexible name matching (handles hyphens) - use regex pattern
      const namePatternParam = paramIndex;
      // Create pattern that matches both "tshirt" and "t-shirt" in style_name
      const namePattern = searchTerms.map(t => {
        const lower = t.toLowerCase().trim();
        let pattern = lower;
        
        // CRITICAL: Handle tshirt/tshirts -> t-shirt/t-shirts (user types without hyphen)
        // When user types "tshirts", we need to match "t-shirts" in database
        if (lower.match(/^tshirts?$/)) {
          // Exact match for tshirt or tshirts - match all variations
          if (lower === 'tshirts') {
            pattern = 't[- ]?shirts?'; // Matches: t-shirts, t shirts, tshirts
          } else {
            pattern = 't[- ]?shirt'; // Matches: t-shirt, t shirt, tshirt
          }
        } else if (lower.includes('tshirts')) {
          // Contains tshirts - replace with flexible pattern
          pattern = pattern.replace(/tshirts/g, 't[- ]?shirts?');
        } else if (lower.includes('tshirt')) {
          // Contains tshirt - replace with flexible pattern
          pattern = pattern.replace(/tshirt/g, 't[- ]?shirt');
        } else {
          // For other terms, handle common hyphen variations
          // vneck -> v[- ]?neck (matches v-neck, v neck, vneck)
          pattern = pattern.replace(/vneck/g, 'v[- ]?neck');
          // crewneck -> crew[- ]?neck
          pattern = pattern.replace(/crewneck/g, 'crew[- ]?neck');
          // Make hyphens and spaces optional for other terms
          pattern = pattern.replace(/-/g, '[- ]?');
          pattern = pattern.replace(/\s+/g, '[- ]?');
          // Escape special regex chars
          pattern = pattern.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
        }
        
        return pattern;
      }).join('.*');
      params.push(namePattern);
      paramIndex++;
      
      // Array parameters (use GIN indexes efficiently)
      const colorArrayParam = paramIndex;
      params.push(colorTerms);
      paramIndex++;
      
      const fabricArrayParam = paramIndex;
      params.push(fabricTerms);
      paramIndex++;
      
      const necklineArrayParam = paramIndex;
      params.push(necklineTerms);
      paramIndex++;
      
      const sleeveArrayParam = paramIndex;
      params.push(sleeveTerms);
      paramIndex++;
      
      const styleArrayParam = paramIndex;
      params.push(styleTerms);
      paramIndex++;
      
      // Normalize product type search terms - convert all variations to "tshirts" format
      // Handles: tshirts, tshirt, t shirt, t-shirt, t-shirts -> all match "tshirts" in DB
      const normalizeProductTypeForSearch = (searchText) => {
        const lower = searchText.toLowerCase().trim();
        // Remove all hyphens and spaces, convert to single word format
        let normalized = lower.replace(/[- ]/g, '');
        // Handle t-shirt variations specifically - always use plural "tshirts" to match DB
        if (normalized.includes('tshirt')) {
          normalized = 'tshirts'; // Always use plural form as stored in DB
        }
        return normalized;
      };
      
      // Check if search might be looking for a product type
      const productTypeSearchTerm = normalizeProductTypeForSearch(trimmedSearch);
      const productTypeParam = paramIndex;
      params.push(productTypeSearchTerm);
      paramIndex++;
      
      // ULTRA-OPTIMIZED: Prioritize ONLY the fastest indexed operations
      // Add flexible name matching with pattern (handles hyphen variations)
      // Include product type name matching - all variations match "tshirts" in DB
      searchCondition = `(
        ${viewAlias}.search_vector @@ plainto_tsquery('english', $${fullTextParam}) OR
        ${viewAlias}.style_code = $${codeParam} OR
        ${viewAlias}.style_code ILIKE $${codePrefixParam} OR
        ${viewAlias}.style_name ~* $${namePatternParam} OR
        ${viewAlias}.colour_slugs::text[] && $${colorArrayParam}::text[] OR
        ${viewAlias}.fabric_slugs::text[] && $${fabricArrayParam}::text[] OR
        ${viewAlias}.neckline_slugs::text[] && $${necklineArrayParam}::text[] OR
        ${viewAlias}.sleeve_slugs::text[] && $${sleeveArrayParam}::text[] OR
        ${viewAlias}.style_keyword_slugs::text[] && $${styleArrayParam}::text[] OR
        EXISTS (
          SELECT 1 FROM styles s_pt_search 
          INNER JOIN product_types pt_search ON s_pt_search.product_type_id = pt_search.id
          WHERE s_pt_search.style_code = ${viewAlias}.style_code 
            AND LOWER(REPLACE(REPLACE(pt_search.name, '-', ''), ' ', '')) = $${productTypeParam}
        )
      )`;
      
      // ULTRA-OPTIMIZED: Simplified relevance - removed expensive calculations
      // Only calculate relevance for indexed operations (fast)
      searchRelevanceSelect = `
        (
          -- Exact style code match (100 points) - FAST (indexed)
          CASE WHEN ${viewAlias}.style_code = $${codeParam} THEN 100 ELSE 0 END +
          -- Prefix style code match (80 points) - FAST (indexed)
          CASE WHEN ${viewAlias}.style_code ILIKE $${codePrefixParam} THEN 80 ELSE 0 END +
          -- Name pattern match (70 points) - Flexible hyphen matching
          CASE WHEN ${viewAlias}.style_name ~* $${namePatternParam} THEN 70 ELSE 0 END +
          -- Product type match (65 points) - All variations match "tshirts" in DB
          CASE WHEN EXISTS (
            SELECT 1 FROM styles s_pt_rel 
            INNER JOIN product_types pt_rel ON s_pt_rel.product_type_id = pt_rel.id
            WHERE s_pt_rel.style_code = ${viewAlias}.style_code 
              AND LOWER(REPLACE(REPLACE(pt_rel.name, '-', ''), ' ', '')) = $${productTypeParam}
          ) THEN 65 ELSE 0 END +
          -- Full-text search (60 points) - FAST (GIN index)
          CASE WHEN ${viewAlias}.search_vector @@ plainto_tsquery('english', $${fullTextParam}) THEN 60 ELSE 0 END +
          -- Array matches (30 points each) - FAST (GIN indexes)
          CASE WHEN ${viewAlias}.colour_slugs::text[] && $${colorArrayParam}::text[] THEN 30 ELSE 0 END +
          CASE WHEN ${viewAlias}.fabric_slugs::text[] && $${fabricArrayParam}::text[] THEN 30 ELSE 0 END +
          CASE WHEN ${viewAlias}.neckline_slugs::text[] && $${necklineArrayParam}::text[] THEN 20 ELSE 0 END +
          CASE WHEN ${viewAlias}.sleeve_slugs::text[] && $${sleeveArrayParam}::text[] THEN 20 ELSE 0 END +
          CASE WHEN ${viewAlias}.style_keyword_slugs::text[] && $${styleArrayParam}::text[] THEN 15 ELSE 0 END
        ) as relevance_score`;
      // REMOVED: ts_rank_cd calculation - too expensive
      
      searchRelevanceOrder = 'relevance_score DESC';
    }
    
    conditions.push(searchCondition);
  }

  // Price range filter - REMOVED from initial WHERE clause
  // Price filters will be applied in style_codes_with_meta CTE using HAVING clause
  // This ensures we filter by products table sell_price (source of truth) not materialized view
  // Store price filter params separately for use in HAVING clause
  const priceFilterParams = [];
  if (filters.priceMin !== null && filters.priceMin !== undefined) {
    priceFilterParams.push(filters.priceMin);
  }
  if (filters.priceMax !== null && filters.priceMax !== undefined) {
    priceFilterParams.push(filters.priceMax);
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

  // Fit filter - OPTIMIZED: Use precomputed array column (matches new view structure)
  if (hasItems(filters.fit)) {
    const normalizedFits = filters.fit.map(normalizeSlug);
    conditions.push(`${viewAlias}.fit_slugs::text[] && $${paramIndex}::text[]`);
    params.push(normalizedFits);
    paramIndex++;
  }

  // Features filter - ENABLED: Uses new feature_slugs column from updated view
  if (hasItems(filters.feature)) {
    const normalizedFeatures = filters.feature.map(normalizeSlug);
    conditions.push(`${viewAlias}.feature_slugs::text[] && $${paramIndex}::text[]`);
    params.push(normalizedFeatures);
    paramIndex++;
  }

  // Effect filter - OPTIMIZED: Use array column with GIN index (replaces ILIKE)
  if (hasItems(filters.effect)) {
    const normalizedEffects = filters.effect.map(e => e.toLowerCase());
    conditions.push(`${viewAlias}.effects_arr::text[] && $${paramIndex}::text[]`);
    params.push(normalizedEffects);
    paramIndex++;
  }

  // Sleeve filter - OPTIMIZED: Use precomputed array column (no EXISTS, no JOIN)
  if (hasItems(filters.sleeve)) {
    const normalizedSlugs = filters.sleeve.map(normalizeSlug);
    conditions.push(`${viewAlias}.sleeve_slugs::text[] && $${paramIndex}::text[]`);
    params.push(normalizedSlugs);
    paramIndex++;
  }

  // Neckline filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.neckline)) {
    const normalizedSlugs = filters.neckline.map(normalizeSlug);
    conditions.push(`${viewAlias}.neckline_slugs::text[] && $${paramIndex}::text[]`);
    params.push(normalizedSlugs);
    paramIndex++;
  }

  // Style keyword filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.style)) {
    const normalizedSlugs = filters.style.map(normalizeSlug);
    conditions.push(`${viewAlias}.style_keyword_slugs::text[] && $${paramIndex}::text[]`);
    params.push(normalizedSlugs);
    paramIndex++;
  }

  // Colour filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.colour)) {
    conditions.push(`${viewAlias}.colour_slugs::text[] && $${paramIndex}::text[]`);
    params.push(filters.colour.map(c => c.toLowerCase()));
    paramIndex++;
  }

  // Size filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.size)) {
    conditions.push(`${viewAlias}.size_slugs::text[] && $${paramIndex}::text[]`);
    params.push(filters.size.map(s => s.toLowerCase()));
    paramIndex++;
  }

  // Fabric filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.fabric)) {
    conditions.push(`${viewAlias}.fabric_slugs::text[] && $${paramIndex}::text[]`);
    params.push(filters.fabric.map(f => f.toLowerCase()));
    paramIndex++;
  }

  // Flag filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.flag)) {
    conditions.push(`${viewAlias}.flag_slugs::text[] && $${paramIndex}::text[]`);
    params.push(filters.flag.map(f => f.toLowerCase()));
    paramIndex++;
  }

  // Weight filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.weight)) {
    conditions.push(`${viewAlias}.weight_slugs::text[] && $${paramIndex}::text[]`);
    params.push(filters.weight.map(w => w.toLowerCase()));
    paramIndex++;
  }

  // Accreditations filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.accreditations)) {
    conditions.push(`${viewAlias}.accreditation_slugs::text[] && $${paramIndex}::text[]`);
    params.push(filters.accreditations.map(a => a.toLowerCase()));
    paramIndex++;
  }

  // Sector filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.sector)) {
    conditions.push(`${viewAlias}.sector_slugs::text[] && $${paramIndex}::text[]`);
    params.push(filters.sector.map(s => s.toLowerCase()));
    paramIndex++;
  }

  // Sport filter - OPTIMIZED: Use precomputed array column
  if (hasItems(filters.sport)) {
    conditions.push(`${viewAlias}.sport_slugs::text[] && $${paramIndex}::text[]`);
    params.push(filters.sport.map(s => s.toLowerCase()));
    paramIndex++;
  }

  // Category filter - REMOVED: Use /api/categories endpoint instead

  // Product type filter - matches product type names (e.g., "tshirts" in DB)
  // Normalize all variations (tshirts, tshirt, t shirt, t-shirt, t-shirts) to "tshirts"
  // Store product type filter info for use in query CTE
  let productTypeJoin = '';
  if (hasItems(filters.productType)) {
    // Normalize product type: remove hyphens and spaces, convert to DB format (e.g., "tshirts")
    // Handles: tshirts, tshirt, t shirt, t-shirt, t-shirts -> all match "tshirts" in DB
    const normalizeProductType = (pt) => {
      const normalized = pt.trim().toLowerCase();
      // Remove all hyphens and spaces
      let cleaned = normalized.replace(/[- ]/g, '');
      // Handle t-shirt variations specifically - always use plural "tshirts" to match DB
      if (cleaned.includes('tshirt')) {
        cleaned = 'tshirts'; // Always use plural form as stored in DB
      }
      return cleaned;
    };
    
    const normalizedProductTypes = filters.productType.map(normalizeProductType);
    // Remove duplicates
    const uniqueProductTypes = [...new Set(normalizedProductTypes)];
    
    // Build JOIN clause for first CTE - this ensures strict filtering at source
    // Apply filter directly in JOIN ON clause for stricter filtering
    // Match by removing hyphens/spaces from DB name and comparing
    productTypeJoin = `
      INNER JOIN styles s_pt ON ${viewAlias}.style_code = s_pt.style_code
      INNER JOIN product_types pt_pt ON s_pt.product_type_id = pt_pt.id 
        AND LOWER(REPLACE(REPLACE(pt_pt.name, '-', ''), ' ', '')) = ANY($${paramIndex}::text[])`;
    params.push(uniqueProductTypes);
        paramIndex++;
  }

  // Always filter by Live status - MUST be first for index matching
  // Index predicates require: WHERE sku_status = 'Live' AND ...
  // Putting this first ensures planner recognizes index can be used
  const whereClause = conditions.length > 0 
    ? `WHERE ${viewAlias}.sku_status = 'Live' AND ${conditions.join(' AND ')}`
    : `WHERE ${viewAlias}.sku_status = 'Live'`;

  // Sorting - determine sort field and order
  let sortField = 'created_at';
  if (sort === 'price') {
    sortField = 'sell_price';
  } else if (sort === 'name') {
    sortField = 'style_name';
  } else if (sort === 'brand') {
    sortField = 'brand_name';
  } else if (sort === 'code') {
    sortField = 'style_code';
  }
  
  const orderBy = `${sortField} ${order}`;

  // Add price filter parameters to params array (for HAVING clause in style_codes_with_meta)
  // These must be added before calculating limitParamIndex and offsetParamIndex
  const priceFilterParamIndex = params.length + 1;
  if (filters.priceMin !== null && filters.priceMin !== undefined) {
    params.push(filters.priceMin);
  }
  if (filters.priceMax !== null && filters.priceMax !== undefined) {
    params.push(filters.priceMax);
  }
  
  const limitParamIndex = params.length + 1;
  const offsetParamIndex = params.length + 2;
  
  // Construct ORDER BY clause
  const orderByClause = sort === 'price' ? `sell_price ${order}, product_type_priority ASC` : sort === 'name' ? `style_name ${order}, product_type_priority ASC` : sort === 'brand' ? `brand_name ${order}, product_type_priority ASC` : sort === 'code' ? `style_code ${order}, product_type_priority ASC` : `product_type_priority ASC, created_at ${order}`;
  
  // ULTRA-OPTIMIZATION: Restructure query for search - use indexed operations first
  // For search, prioritize full-text search index by structuring query properly
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
        MIN(p.sell_price) as sell_price,
        MIN(${viewAlias}.created_at) as created_at,
        MIN(COALESCE(pt.display_order, 999)) as product_type_priority,
        MIN(COALESCE(b.name, '')) as brand_name
        ${hasSearch ? ', MAX(scf.relevance_score) as relevance_score' : ''}
      FROM style_codes_filtered scf
      INNER JOIN product_search_materialized ${viewAlias} ON scf.style_code = ${viewAlias}.style_code
      INNER JOIN products p ON ${viewAlias}.style_code = p.style_code AND p.sku_status = 'Live'
      LEFT JOIN styles s ON ${viewAlias}.style_code = s.style_code
        LEFT JOIN product_types pt ON s.product_type_id = pt.id
        LEFT JOIN brands b ON s.brand_id = b.id
      WHERE ${viewAlias}.sku_status = 'Live'
      GROUP BY scf.style_code
      HAVING 
        MIN(p.sell_price) IS NOT NULL
        ${filters.priceMin !== null && filters.priceMin !== undefined ? `AND MIN(p.sell_price) >= $${priceFilterParamIndex}` : ''}
        ${filters.priceMax !== null && filters.priceMax !== undefined ? `AND MIN(p.sell_price) <= $${priceFilterParamIndex + (filters.priceMin !== null && filters.priceMin !== undefined ? 1 : 0)}` : ''}
      ),
    paginated_style_codes AS (
        SELECT style_code, sell_price
      FROM style_codes_with_meta
        ORDER BY 
          ${hasSearch && searchRelevanceOrder ? `${searchRelevanceOrder}, ` : ''}
          ${orderByClause}
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      ),
      total_count AS (
      SELECT COUNT(*) as total
      FROM style_codes_filtered
      ),
      price_range AS (
        SELECT 
          MIN(${viewAlias}.sell_price) as min_price,
          MAX(${viewAlias}.sell_price) as max_price
        FROM style_codes_filtered scf
        INNER JOIN product_search_materialized ${viewAlias} ON scf.style_code = ${viewAlias}.style_code
        WHERE ${viewAlias}.sku_status = 'Live' AND ${viewAlias}.sell_price IS NOT NULL
      )
      SELECT 
      psc.style_code,
      psc.sell_price as sorted_sell_price,
        tc.total,
        pr.min_price,
        pr.max_price
    FROM paginated_style_codes psc
      CROSS JOIN total_count tc
      CROSS JOIN price_range pr
    `;
    
    params.push(fetchLimit, offset);
  
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
            MIN(p.sell_price) as sell_price,
            MIN(${viewAlias}.created_at) as created_at,
            MIN(COALESCE(pt.display_order, 999)) as product_type_priority,
            MIN(COALESCE(b.name, '')) as brand_name
            ${hasSearch ? ', MAX(scf.relevance_score) as relevance_score' : ''}
          FROM style_codes_filtered scf
          INNER JOIN product_search_materialized ${viewAlias} ON scf.style_code = ${viewAlias}.style_code
          INNER JOIN products p ON ${viewAlias}.style_code = p.style_code AND p.sku_status = 'Live'
          LEFT JOIN styles s ON ${viewAlias}.style_code = s.style_code
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
            LEFT JOIN brands b ON s.brand_id = b.id
          WHERE ${viewAlias}.sku_status = 'Live'
          GROUP BY scf.style_code
          HAVING 
            MIN(p.sell_price) IS NOT NULL
            ${filters.priceMin !== null && filters.priceMin !== undefined ? `AND MIN(p.sell_price) >= $${priceFilterParamIndex}` : ''}
            ${filters.priceMax !== null && filters.priceMax !== undefined ? `AND MIN(p.sell_price) <= $${priceFilterParamIndex + (filters.priceMin !== null && filters.priceMin !== undefined ? 1 : 0)}` : ''}
        ),
        paginated_style_codes AS (
      SELECT style_code, sell_price
          FROM style_codes_with_meta
      ORDER BY 
        ${hasSearch && searchRelevanceOrder ? `${searchRelevanceOrder}, ` : ''}
        ${orderByClause}
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
    )
    SELECT 
          psc.style_code,
          psc.sell_price as sorted_sell_price,
          $${params.length + 1}::bigint as total,
          $${params.length + 2}::numeric as min_price,
          $${params.length + 3}::numeric as max_price
        FROM paginated_style_codes psc
      `;
      params.push(cachedCount, cachedPriceRange.min, cachedPriceRange.max);
      queryResult = await queryWithTimeout(simplifiedQuery, params, 20000);
    } else {
      queryResult = await queryWithTimeout(optimizedQuery, params, 20000);
    }
    
    const queryTime = Date.now() - startTime;
    console.log(`[QUERY] Style codes query: ${queryTime}ms, rows: ${queryResult.rows.length}`);
    
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
    // Store the sorted sell_price from SQL query for each style code
    const sortedPricesMap = new Map();
    queryResult.rows.forEach(row => {
      if (row.sorted_sell_price !== null && row.sorted_sell_price !== undefined) {
        sortedPricesMap.set(row.style_code, parseFloat(row.sorted_sell_price));
      }
    });
  
    if (styleCodes.length === 0) {
      return { items: [], total, priceRange };
    }

    // STEP 2: Fetch full details for only the paginated style codes (SMALL DATASET)
    const batchStartTime = Date.now();
    
    // ENTERPRISE-LEVEL: Dynamic batch limit calculation
    // Each product can have multiple colors, so we need enough rows to cover all products
    // Formula: styleCodes.length * MAX_COLORS_PER_PRODUCT, capped at MAX_BATCH_ROWS
    const dynamicBatchLimit = Math.max(
      PAGINATION_CONFIG.MIN_BATCH_ROWS,
      Math.min(
        styleCodes.length * PAGINATION_CONFIG.MAX_COLORS_PER_PRODUCT,
        PAGINATION_CONFIG.MAX_BATCH_ROWS
      )
    );
    
    console.log(`[PAGINATION] Batch query limit: ${dynamicBatchLimit} (for ${styleCodes.length} style codes)`);
    
    // ENTERPRISE-LEVEL: Build color filter conditions for batch query
    // When color filters are applied, we MUST filter the batch query too
    // Otherwise, products with multiple colors will show ALL colors instead of just filtered ones
    const batchParams = [styleCodes, dynamicBatchLimit];
    let batchColorConditions = [];
    let batchParamIndex = 3;
    
    // Apply primaryColour filter to batch query
    if (hasItems(filters.primaryColour)) {
      batchColorConditions.push(`LOWER(p.primary_colour) = ANY($${batchParamIndex}::text[])`);
      batchParams.push(filters.primaryColour.map(c => c.toLowerCase()));
      batchParamIndex++;
      console.log(`[FILTER DEBUG] Applying primaryColour filter to batch: ${filters.primaryColour.join(', ')}`);
    }
    
    // Apply colourShade filter to batch query
    if (hasItems(filters.colourShade)) {
      batchColorConditions.push(`LOWER(p.colour_shade) = ANY($${batchParamIndex}::text[])`);
      batchParams.push(filters.colourShade.map(c => c.toLowerCase()));
      batchParamIndex++;
      console.log(`[FILTER DEBUG] Applying colourShade filter to batch: ${filters.colourShade.join(', ')}`);
    }
    
    // Build the color WHERE clause (if any filters are active)
    const batchColorWhereClause = batchColorConditions.length > 0 
      ? `AND (${batchColorConditions.join(' OR ')})` 
      : '';
    
    // OPTIMIZED: Use DISTINCT ON to reduce rows - one per style_code+colour combination
    // Dynamic limit ensures all requested products are retrieved regardless of color count
    // CRITICAL FIX: Apply color filters to batch query to ensure only matching colors are returned
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
      ${batchColorWhereClause}
      ORDER BY p.style_code, p.colour_name, COALESCE(sz.size_order, 999)
      LIMIT $2
    `;

    const batchResult = await queryWithTimeout(batchQuery, batchParams, 30000); // 30s timeout for larger batch queries
    const batchQueryTime = Date.now() - batchStartTime;
    console.log(`[QUERY] Details query: ${batchQueryTime}ms (${batchResult.rows.length} rows returned)`);

    // Group results by style_code
    const productsMap = new Map();
    const priceMinFilter = filters.priceMin;
    const priceMaxFilter = filters.priceMax;
    
    // ENTERPRISE-LEVEL: Track filtered colors for each product
    // When color filters are active, we track which colors matched to prioritize them in display
    const colorFilterActive = hasItems(filters.primaryColour) || hasItems(filters.colourShade);
    const filteredPrimaryColours = (filters.primaryColour || []).map(c => c.toLowerCase());
    const filteredColourShades = (filters.colourShade || []).map(c => c.toLowerCase());
    
    console.log(`[FILTER DEBUG] Color filter active: ${colorFilterActive}, primaryColours: ${filteredPrimaryColours.join(',')}, colourShades: ${filteredColourShades.join(',')}`);
    
    batchResult.rows.forEach(row => {
      // If price filters are active, ignore SKUs whose sell_price is outside the requested range
      const sellPriceValue = row.sell_price !== null && row.sell_price !== undefined ? parseFloat(row.sell_price) : null;
      if ((priceMinFilter !== null && priceMinFilter !== undefined) || (priceMaxFilter !== null && priceMaxFilter !== undefined)) {
        // Require a valid sell_price when price filters are used
        if (!Number.isFinite(sellPriceValue)) {
          return;
        }
        if (priceMinFilter !== null && priceMinFilter !== undefined && sellPriceValue < priceMinFilter) {
          return;
        }
        if (priceMaxFilter !== null && priceMaxFilter !== undefined && sellPriceValue > priceMaxFilter) {
          return;
        }
      }
      
      // ENTERPRISE-LEVEL: When color filter is active, verify this row matches the filter
      // This is a safety check - the SQL should already filter, but we double-check here
      if (colorFilterActive) {
        const rowPrimaryColour = (row.primary_colour || '').toLowerCase();
        const rowColourShade = (row.colour_shade || '').toLowerCase();
        
        let colorMatches = false;
        
        // Check if row matches primaryColour filter
        if (filteredPrimaryColours.length > 0 && filteredPrimaryColours.includes(rowPrimaryColour)) {
          colorMatches = true;
        }
        
        // Check if row matches colourShade filter
        if (filteredColourShades.length > 0 && filteredColourShades.includes(rowColourShade)) {
          colorMatches = true;
        }
        
        // If no specific filters but colorFilterActive, we've already filtered in SQL
        if (filteredPrimaryColours.length === 0 && filteredColourShades.length === 0) {
          colorMatches = true;
        }
        
        if (!colorMatches) {
          console.log(`[FILTER DEBUG] Skipping row - color doesn't match: ${row.code}, primary_colour: ${rowPrimaryColour}, colour_shade: ${rowColourShade}`);
          return; // Skip this row
        }
      }
      
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
          primaryImageUrl: row.primary_image_url,
          // ENTERPRISE-LEVEL: Track the first filtered color's image for priority display
          filteredColorImage: null
        });
      }

      const product = productsMap.get(styleCode);

      if (row.size) {
        product.sizesSet.add(row.size);
      }

      const colorKey = row.colour_name || row.primary_colour || 'Unknown';
      const colorImage = row.colour_image_url || row.primary_image_url || '';
      
      if (!product.colorsMap.has(colorKey)) {
        product.colorsMap.set(colorKey, {
          name: colorKey,
          main: colorImage,
          thumb: colorImage
        });
        
        // ENTERPRISE-LEVEL: If this is the first color and color filter is active, 
        // use this color's image as the primary display image
        if (colorFilterActive && !product.filteredColorImage && colorImage) {
          product.filteredColorImage = colorImage;
        }
      }

      if (row.single_price) {
        const single = parseFloat(row.single_price);
        if (!product.singlePrice) {
          product.singlePrice = single;
        }
      }
      if (row.carton_price) {
        const carton = parseFloat(row.carton_price);
        if (!product.cartonPrice) {
          product.cartonPrice = carton;
        }
      }
      if (row.sell_price) {
        const sell = parseFloat(row.sell_price);
        // Always use the minimum sell_price encountered (products table is source of truth)
        // If there are multiple values, use the minimum price
        if (!product.sellPrice || sell < product.sellPrice) {
          product.sellPrice = sell;
        }
      }

      if (row.tag) {
        product.customization.add(row.tag.toLowerCase());
      }
    });

    // ENTERPRISE-LEVEL: Track missing products for debugging and monitoring
    const missingProducts = [];
    const invalidPriceProducts = [];
    
    // Build response items with MARKUP applied
    const items = styleCodes.map(styleCode => {
      const product = productsMap.get(styleCode);
      if (!product) {
        missingProducts.push(styleCode);
        return null;
      }
      
      // ENTERPRISE-LEVEL: When color filter is active, product must have at least one matching color
      // If colorsMap is empty after filtering, this product shouldn't be shown
      if (colorFilterActive && product.colorsMap.size === 0) {
        console.log(`[FILTER DEBUG] Excluding product ${styleCode} - no matching colors after filter`);
        return null;
      }

      // Use the sorted sell_price from SQL query to ensure displayed price matches sort order
      // This ensures consistency: the price shown is the same price used for sorting
      const basePrice = sortedPricesMap.get(styleCode) || product.sellPrice || 0;
      if (!basePrice || basePrice === 0) {
        invalidPriceProducts.push({ code: styleCode, sortedPrice: sortedPricesMap.get(styleCode), productPrice: product.sellPrice });
        return null;
      }
      
      const priceBreaks = buildPriceBreaks(basePrice);

      // Always hardcode customization options
      const customization = ['embroidery', 'print'];

      const sizes = Array.from(product.sizesSet).sort((a, b) => {
        const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
        const aIndex = sizeOrder.indexOf(a.toUpperCase());
        const bIndex = sizeOrder.indexOf(b.toUpperCase());
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.localeCompare(b);
      });

      // ENTERPRISE-LEVEL: When color filter is active, use the filtered color's image
      // This ensures the product thumbnail shows the color the user filtered for
      // Falls back to primaryImageUrl or first available color image
      let displayImage = product.primaryImageUrl || '';
      if (colorFilterActive && product.filteredColorImage) {
        displayImage = product.filteredColorImage;
        console.log(`[FILTER DEBUG] Using filtered color image for ${styleCode}: ${displayImage.substring(0, 50)}...`);
      } else if (product.colorsMap.size > 0) {
        // Fallback to first color's image if no filtered image
        const firstColor = product.colorsMap.values().next().value;
        if (firstColor && firstColor.main) {
          displayImage = firstColor.main;
        }
      }

      // Price should match priceBreaks[0].price (1-9 tier with 0% discount)
      // Use basePrice which is the single price after markup, same as product details API
      return {
        code: product.code,
        name: product.name,
        price: basePrice,
        image: displayImage,
        colors: Array.from(product.colorsMap.values()),
        sizes,
        customization,
        brand: product.brand || '',
        priceBreaks
      };
    }).filter(item => item !== null);
    
    // ENTERPRISE-LEVEL: Log pagination health metrics
    const paginationHealth = {
      requestedStyleCodes: styleCodes.length,
      productsMapSize: productsMap.size,
      missingCount: missingProducts.length,
      invalidPriceCount: invalidPriceProducts.length,
      finalItemsCount: items.length,
      batchRowsReturned: batchResult.rows.length,
      batchLimit: dynamicBatchLimit,
      colorFilterActive: colorFilterActive
    };
    
    if (missingProducts.length > 0 || invalidPriceProducts.length > 0) {
      console.warn(`[PAGINATION WARNING] Missing: ${missingProducts.length}, Invalid price: ${invalidPriceProducts.length}`, {
        missingProducts: missingProducts.slice(0, 10), // Log first 10 for debugging
        invalidPriceProducts: invalidPriceProducts.slice(0, 5),
        paginationHealth
      });
    }
    
    // ENTERPRISE-LEVEL: When color filter is active, log additional debugging info
    if (colorFilterActive) {
      console.log(`[FILTER DEBUG] Color filter results: SQL returned ${styleCodes.length} style_codes, batch returned ${batchResult.rows.length} rows, final items: ${items.length}`);
      
      // Warn if significant filtering happened post-SQL (indicates data quality issues)
      const filterLossRate = styleCodes.length > 0 ? ((styleCodes.length - items.length) / styleCodes.length * 100).toFixed(1) : 0;
      if (filterLossRate > 20) {
        console.warn(`[FILTER WARNING] High post-SQL filter loss: ${filterLossRate}% of products filtered out. This may indicate stale materialized view data.`);
      }
    }
    
    console.log(`[PAGINATION] Health: requested=${paginationHealth.requestedStyleCodes}, returned=${paginationHealth.finalItemsCount}, missing=${paginationHealth.missingCount}`);

    // Final safety net: ensure displayed prices honor priceMin/priceMax
    const filteredItems = items.filter(item => {
      if (priceMinFilter !== null && priceMinFilter !== undefined && item.price < priceMinFilter) {
        return false;
      }
      if (priceMaxFilter !== null && priceMaxFilter !== undefined && item.price > priceMaxFilter) {
        return false;
      }
      return true;
    });

    // Recompute price range based on filtered items for accurate UI feedback
    const filteredPriceRange = filteredItems.length
      ? {
          min: Math.min(...filteredItems.map(i => i.price)),
          max: Math.max(...filteredItems.map(i => i.price))
        }
      : { min: 0, max: 0 };

    const totalTime = Date.now() - startTime;
    console.log(`[QUERY] Total product list: ${totalTime}ms`);

    // Price range is already in sell_price (marked-up), no conversion needed
    // Use filtered price range when price filters are active to avoid misleading UI
    const markedUpPriceRange = (priceMinFilter !== null && priceMinFilter !== undefined) || 
                               (priceMaxFilter !== null && priceMaxFilter !== undefined)
      ? filteredPriceRange
      : priceRange;

    // ENTERPRISE-LEVEL: Adjust total count when filters cause significant page shortfall
    // If we requested 'limit' items but got fewer (not on last page), something is wrong
    // This can happen when the materialized view has stale color data
    let adjustedTotal = total;
    const expectedItemsOnPage = Math.min(limit, total - offset);
    const actualItemsOnPage = filteredItems.length;
    
    // Only adjust if we're getting significantly fewer items than expected AND filters are active
    if (hasStrictFilters && actualItemsOnPage < expectedItemsOnPage && actualItemsOnPage > 0) {
      // Calculate adjustment factor based on what we actually got vs expected
      const actualRatio = actualItemsOnPage / expectedItemsOnPage;
      adjustedTotal = Math.ceil(total * actualRatio);
      console.log(`[FILTER ADJUSTMENT] Adjusted total from ${total} to ${adjustedTotal} (ratio: ${actualRatio.toFixed(2)})`);
    }

    const queryResponse = { 
      items: filteredItems, 
      total: adjustedTotal, 
      priceRange: markedUpPriceRange
    };
    
    // Cache the response
    const cacheTTL = (filters.q || filters.text) ? SEARCH_CACHE_TTL : CACHE_TTL;
    setCache(cacheKey, queryResponse, cacheTTL);
    console.log(`[CACHE] Result cached (TTL: ${cacheTTL/1000}s)`);

    return queryResponse;
  } catch (error) {
    console.error('[ERROR] buildProductListQuery failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

function buildPriceBreaks(basePrice) {
  if (!basePrice || basePrice <= 0) return [];

  const breaks = [];

  // Discount tiers based on base price (1-9 tier)
  const DISCOUNT_TIERS = {
    '1-9': 0,        // 0% - Base price
    '10-24': 0.08,   // 8% discount
    '25-49': 0.10,   // 10% discount
    '50-99': 0.15,   // 15% discount
    '100-249': 0.25, // 25% discount
    '250+': 0.30     // 30% discount
  };

  // Calculate all 6 price break tiers based on base price and discount percentages
  breaks.push({ 
    min: 1, 
    max: 9, 
    price: Math.round(basePrice * 100) / 100 
  });
  breaks.push({ 
    min: 10, 
    max: 24, 
    price: Math.round(basePrice * (1 - DISCOUNT_TIERS['10-24']) * 100) / 100 
  });
  breaks.push({ 
    min: 25, 
    max: 49, 
    price: Math.round(basePrice * (1 - DISCOUNT_TIERS['25-49']) * 100) / 100 
  });
  breaks.push({ 
    min: 50, 
    max: 99, 
    price: Math.round(basePrice * (1 - DISCOUNT_TIERS['50-99']) * 100) / 100 
  });
  breaks.push({ 
    min: 100, 
    max: 249, 
    price: Math.round(basePrice * (1 - DISCOUNT_TIERS['100-249']) * 100) / 100 
  });
  breaks.push({ 
    min: 250, 
    max: 99999, 
    price: Math.round(basePrice * (1 - DISCOUNT_TIERS['250+']) * 100) / 100 
  });

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
      pt.name as product_type,
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
      p.sell_price,
      t.name as tag
    FROM styles s
    LEFT JOIN brands b ON s.brand_id = b.id
    LEFT JOIN product_types pt ON s.product_type_id = pt.id
    LEFT JOIN products p ON p.style_code = s.style_code AND p.sku_status = 'Live'
    LEFT JOIN sizes sz ON p.size_id = sz.id
    LEFT JOIN tags t ON p.tag_id = t.id
    WHERE s.style_code = $1
    ORDER BY p.colour_name, sz.size_order
  `;

  const detailResult = await queryWithTimeout(detailQuery, [styleCode], 10000); // 10s timeout for detail query
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
  let maxSellPrice = 0; // Track maximum sell_price across all rows (consistent with product list API)

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
    if (row.carton_price) prices.push(parseFloat(row.carton_price));

    // Track minimum sell_price (consistent with product list API which uses MIN)
    if (row.sell_price) {
      const sell = parseFloat(row.sell_price);
      if (maxSellPrice === 0 || sell < maxSellPrice) {
        maxSellPrice = sell;
      }
    }

    if (row.tag) {
      customizationSet.add(row.tag.toLowerCase());
    }
  });

  // Use minimum sell_price directly (already marked-up in DB)
  // This matches the product list API which uses MIN(sell_price) per style_code
  const basePrice = maxSellPrice || 0;
  const priceBreaks = buildPriceBreaks(basePrice);

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

  // Price and basePrice should be the same (single unit price after markup)
  // The 1-9 tier in priceBreaks also equals basePrice (0% discount)
  
  const productDetail = {
    code: styleCode,
    name: firstRow.style_name || '',
    brand: firstRow.brand || '',
    productType: firstRow.product_type || '',
    price: basePrice,  // Same as basePrice - single unit price after markup
    basePrice: basePrice,  // Single price after markup (matches 1-9 tier)
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
    customization: ['embroidery', 'print']
  };

  // Cache product details (longer TTL - product details change less frequently)
  setCache(cacheKey, productDetail, COUNT_CACHE_TTL);
  
  return productDetail;
}

// Export buildFilterAggregations for use in routes
async function getFilterAggregations(filters) {
  return await buildFilterAggregations(filters, 'psm', null);
}

module.exports = {
  buildProductListQuery,
  buildProductDetailQuery,
  buildFilterAggregations: getFilterAggregations, // Export for routes
  clearCache
};
