const { pool, queryWithTimeout } = require('../config/database');
const { getCategoryIdsFromSlugs } = require('./categoryService');

const queryCache = new Map();
const aggregationCache = new Map(); // Separate cache for aggregations

// AGGRESSIVE CACHING for instant loading
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes (was 5)
const COUNT_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours (was 1 hour)
const SEARCH_CACHE_TTL = 60 * 60 * 1000; // 1 hour for searches (was 10 minutes)
const AGGREGATION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for aggregations

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

// Build filter aggregations - counts for each filter option based on current filtered set
async function buildFilterAggregations(filters, viewAlias = 'psm', preFilteredStyleCodes = null) {
  const aggregations = {};
  
  // OPTIMIZATION: If we have pre-filtered style codes (from search), use them to speed up aggregations
  const hasSearch = !!(filters.q || filters.text);
  const usePreFiltered = hasSearch && preFilteredStyleCodes && preFilteredStyleCodes.length > 0 && preFilteredStyleCodes.length < 5000;
  
  // Helper to build base conditions (all filters except the one being aggregated)
  const buildBaseConditions = (excludeFilter) => {
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    // OPTIMIZATION: If using pre-filtered style codes, start with them (much faster)
    if (usePreFiltered) {
      conditions.push(`${viewAlias}.style_code = ANY($${paramIndex}::text[])`);
      params.push(preFilteredStyleCodes);
      paramIndex++;
    }
    
    // Always filter by Live status
    conditions.push(`${viewAlias}.sku_status = 'Live'`);
    
    // Search condition (only if not using pre-filtered codes)
    if (!usePreFiltered) {
      const searchText = filters.q || filters.text;
      if (searchText && excludeFilter !== 'search') {
        const trimmedSearch = searchText.trim();
        const searchLength = trimmedSearch.length;
        
        if (searchLength <= 2) {
          conditions.push(`(${viewAlias}.style_code = UPPER($${paramIndex}) OR ${viewAlias}.style_code ILIKE $${paramIndex + 1})`);
          params.push(trimmedSearch);
          params.push(`${trimmedSearch}%`);
          paramIndex += 2;
        } else {
          const searchTerms = trimmedSearch.split(/\s+/).filter(t => t.length > 0);
          const normalizedSearch = searchTerms.join(' ');
          const searchUpper = normalizedSearch.toUpperCase();
          
          const normalizeTerm = (term) => term.toLowerCase().replace(/[^a-z0-9]/g, '-');
          const colorTerms = searchTerms.map(normalizeTerm);
          const fabricTerms = searchTerms.map(normalizeTerm);
          const necklineTerms = searchTerms.map(t => {
            const lower = t.toLowerCase();
            if (lower.includes('crew')) return 'crew-neck';
            if (lower.includes('vneck') || lower.includes('v-neck')) return 'v-neck';
            return normalizeTerm(t);
          });
          const sleeveTerms = searchTerms.map(t => {
            const lower = t.toLowerCase();
            if (lower.includes('long')) return 'long-sleeve';
            if (lower.includes('short')) return 'short-sleeve';
            return normalizeTerm(t);
          });
          const styleTerms = searchTerms.map(normalizeTerm);
          
          // OPTIMIZED: Prioritize full-text search (uses GIN index)
          conditions.push(`(
            ${viewAlias}.search_vector @@ plainto_tsquery('english', $${paramIndex}) OR
            ${viewAlias}.style_code = $${paramIndex + 1} OR
            ${viewAlias}.style_code ILIKE $${paramIndex + 2} OR
            ${viewAlias}.style_name ILIKE $${paramIndex + 3} OR
            (${viewAlias}.colour_slugs && $${paramIndex + 4}::text[]) OR
            (${viewAlias}.fabric_slugs && $${paramIndex + 5}::text[]) OR
            (${viewAlias}.neckline_slugs && $${paramIndex + 6}::text[]) OR
            (${viewAlias}.sleeve_slugs && $${paramIndex + 7}::text[]) OR
            (${viewAlias}.style_keyword_slugs && $${paramIndex + 8}::text[])
          )`);
          params.push(normalizedSearch, searchUpper, `${searchUpper}%`, `%${normalizedSearch}%`, 
                     colorTerms, fabricTerms, necklineTerms, sleeveTerms, styleTerms);
          paramIndex += 9;
        }
      }
    }
    
    // Product type filter
    let productTypeJoin = '';
    if (hasItems(filters.productType) && excludeFilter !== 'productType') {
      const normalizedProductTypes = filters.productType.map(pt => pt.trim().toLowerCase());
      productTypeJoin = `
        INNER JOIN styles s_pt ON ${viewAlias}.style_code = s_pt.style_code
        INNER JOIN product_types pt_pt ON s_pt.product_type_id = pt_pt.id 
          AND LOWER(TRIM(pt_pt.name)) = ANY($${paramIndex}::text[])`;
      params.push(normalizedProductTypes);
      paramIndex++;
    }
    
    // Price filters
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
    
    // Other filters (exclude the one being aggregated)
    if (hasItems(filters.gender) && excludeFilter !== 'gender') {
      conditions.push(`${viewAlias}.gender_slug = ANY($${paramIndex})`);
      params.push(filters.gender.map(g => g.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.ageGroup) && excludeFilter !== 'ageGroup') {
      conditions.push(`${viewAlias}.age_group_slug = ANY($${paramIndex})`);
      params.push(filters.ageGroup.map(a => a.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.primaryColour) && excludeFilter !== 'primaryColour') {
      conditions.push(`${viewAlias}.primary_colour IS NOT NULL AND LOWER(${viewAlias}.primary_colour) = ANY($${paramIndex})`);
      params.push(filters.primaryColour.map(c => c.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.sleeve) && excludeFilter !== 'sleeve') {
      const normalizedSlugs = filters.sleeve.map(normalizeSlug);
      conditions.push(`${viewAlias}.sleeve_slugs && $${paramIndex}::text[]`);
      params.push(normalizedSlugs);
      paramIndex++;
    }
    
    if (hasItems(filters.neckline) && excludeFilter !== 'neckline') {
      const normalizedSlugs = filters.neckline.map(normalizeSlug);
      conditions.push(`${viewAlias}.neckline_slugs && $${paramIndex}::text[]`);
      params.push(normalizedSlugs);
      paramIndex++;
    }
    
    if (hasItems(filters.fabric) && excludeFilter !== 'fabric') {
      conditions.push(`${viewAlias}.fabric_slugs && $${paramIndex}::text[]`);
      params.push(filters.fabric.map(f => f.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.size) && excludeFilter !== 'size') {
      conditions.push(`${viewAlias}.size_slugs && $${paramIndex}::text[]`);
      params.push(filters.size.map(s => s.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.tag) && excludeFilter !== 'tag') {
      conditions.push(`LOWER(${viewAlias}.tag_slug) = ANY($${paramIndex})`);
      params.push(filters.tag.map(t => t.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.effect) && excludeFilter !== 'effect') {
      const normalizedEffects = filters.effect.map(e => e.toLowerCase());
      conditions.push(`${viewAlias}.effects_arr && $${paramIndex}::text[]`);
      params.push(normalizedEffects);
      paramIndex++;
    }
    
    if (hasItems(filters.accreditations) && excludeFilter !== 'accreditations') {
      conditions.push(`${viewAlias}.accreditation_slugs && $${paramIndex}::text[]`);
      params.push(filters.accreditations.map(a => a.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.colourShade) && excludeFilter !== 'colourShade') {
      conditions.push(`${viewAlias}.colour_shade IS NOT NULL AND LOWER(${viewAlias}.colour_shade) = ANY($${paramIndex})`);
      params.push(filters.colourShade.map(c => c.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.weight) && excludeFilter !== 'weight') {
      conditions.push(`${viewAlias}.weight_slugs && $${paramIndex}::text[]`);
      params.push(filters.weight.map(w => w.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.fit) && excludeFilter !== 'fit') {
      conditions.push(`${viewAlias}.fit_slug IS NOT NULL AND LOWER(${viewAlias}.fit_slug) = ANY($${paramIndex})`);
      params.push(filters.fit.map(f => f.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.sector) && excludeFilter !== 'sector') {
      conditions.push(`${viewAlias}.sector_slugs && $${paramIndex}::text[]`);
      params.push(filters.sector.map(s => s.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.sport) && excludeFilter !== 'sport') {
      conditions.push(`${viewAlias}.sport_slugs && $${paramIndex}::text[]`);
      params.push(filters.sport.map(s => s.toLowerCase()));
      paramIndex++;
    }
    
    if (hasItems(filters.style) && excludeFilter !== 'style') {
      const normalizedStyles = filters.style.map(normalizeSlug);
      conditions.push(`${viewAlias}.style_keyword_slugs && $${paramIndex}::text[]`);
      params.push(normalizedStyles);
      paramIndex++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    return { whereClause, productTypeJoin, params };
  };
  
  // Initialize all 8 required filter types (always return all, even if empty)
  aggregations.gender = {};
  aggregations.ageGroup = {};
  aggregations.sleeve = {};
  aggregations.neckline = {};
  aggregations.fabric = {};
  aggregations.size = {};
  aggregations.feature = {};
  aggregations.tag = {};
  
  // OPTIMIZATION: Use shorter timeout for aggregations when using pre-filtered codes (they should be fast)
  const aggregationTimeout = usePreFiltered ? 10000 : 15000;
  
  // Helper function to run a single aggregation query
  const runAggregation = async (name, excludeFilter, buildQuery) => {
    try {
      const base = buildBaseConditions(excludeFilter);
      const query = buildQuery(base, viewAlias);
      const result = await queryWithTimeout(query, base.params, aggregationTimeout);
      const resultMap = {};
      result.rows.forEach(row => {
        resultMap[row.value] = parseInt(row.count);
      });
      return resultMap;
    } catch (err) {
      console.error(`[ERROR] ${name} aggregation failed:`, err.message);
      return {};
    }
  };
  
  try {
    // OPTIMIZATION: Run all aggregations in parallel using Promise.all
    // This reduces total time from sum of all queries to max of all queries
    const [
      genderResult,
      ageGroupResult,
      sleeveResult,
      necklineResult,
      fabricResult,
      sizeResult,
      tagResult
    ] = await Promise.all([
      // 1. Gender aggregations
      runAggregation('Gender', 'gender', (base, alias) => {
        const whereClause = `${base.whereClause} AND ${alias}.gender_slug IS NOT NULL`;
        return `
          SELECT 
            ${alias}.gender_slug as value,
            COUNT(DISTINCT ${alias}.style_code) as count
          FROM product_search_materialized ${alias}
          ${base.productTypeJoin}
          ${whereClause}
          GROUP BY ${alias}.gender_slug
          ORDER BY count DESC
        `;
      }),
      
      // 2. Age Group aggregations
      runAggregation('Age Group', 'ageGroup', (base, alias) => {
        const whereClause = `${base.whereClause} AND ${alias}.age_group_slug IS NOT NULL`;
        return `
          SELECT 
            ${alias}.age_group_slug as value,
            COUNT(DISTINCT ${alias}.style_code) as count
          FROM product_search_materialized ${alias}
          ${base.productTypeJoin}
          ${whereClause}
          GROUP BY ${alias}.age_group_slug
          ORDER BY count DESC
        `;
      }),
      
      // 3. Sleeve aggregations (from array) - OPTIMIZED with LIMIT
      runAggregation('Sleeve', 'sleeve', (base, alias) => {
        const whereClause = `${base.whereClause} AND ${alias}.sleeve_slugs IS NOT NULL AND array_length(${alias}.sleeve_slugs, 1) > 0`;
        return `
          SELECT 
            sleeve_value as value,
            COUNT(DISTINCT style_code) as count
          FROM (
            SELECT DISTINCT
              ${alias}.style_code,
              unnest(${alias}.sleeve_slugs) as sleeve_value
            FROM product_search_materialized ${alias}
            ${base.productTypeJoin}
            ${whereClause}
          ) subq
          GROUP BY sleeve_value
          ORDER BY count DESC
          LIMIT 30
        `;
      }),
      
      // 4. Neckline aggregations (from array) - OPTIMIZED with LIMIT
      runAggregation('Neckline', 'neckline', (base, alias) => {
        const whereClause = `${base.whereClause} AND ${alias}.neckline_slugs IS NOT NULL AND array_length(${alias}.neckline_slugs, 1) > 0`;
        return `
          SELECT 
            neckline_value as value,
            COUNT(DISTINCT style_code) as count
          FROM (
            SELECT DISTINCT
              ${alias}.style_code,
              unnest(${alias}.neckline_slugs) as neckline_value
            FROM product_search_materialized ${alias}
            ${base.productTypeJoin}
            ${whereClause}
          ) subq
          GROUP BY neckline_value
          ORDER BY count DESC
          LIMIT 30
        `;
      }),
      
      // 5. Fabric aggregations (from array) - OPTIMIZED with LIMIT
      runAggregation('Fabric', 'fabric', (base, alias) => {
        const whereClause = `${base.whereClause} AND ${alias}.fabric_slugs IS NOT NULL AND array_length(${alias}.fabric_slugs, 1) > 0`;
        return `
          SELECT 
            fabric_value as value,
            COUNT(DISTINCT style_code) as count
          FROM (
            SELECT DISTINCT
              ${alias}.style_code,
              unnest(${alias}.fabric_slugs) as fabric_value
            FROM product_search_materialized ${alias}
            ${base.productTypeJoin}
            ${whereClause}
          ) subq
          GROUP BY fabric_value
          ORDER BY count DESC
          LIMIT 30
        `;
      }),
      
      // 6. Size aggregations (from array) - OPTIMIZED with LIMIT and increased timeout
      (async () => {
        try {
          const sizeBase = buildBaseConditions('size');
          const sizeWhereClause = `${sizeBase.whereClause} AND ${viewAlias}.size_slugs IS NOT NULL AND array_length(${viewAlias}.size_slugs, 1) > 0`;
          const sizeQuery = `
            SELECT 
              size_value as value,
              COUNT(DISTINCT style_code) as count
            FROM (
              SELECT DISTINCT
                ${viewAlias}.style_code,
                unnest(${viewAlias}.size_slugs) as size_value
              FROM product_search_materialized ${viewAlias}
              ${sizeBase.productTypeJoin}
              ${sizeWhereClause}
            ) subq
            GROUP BY size_value
            ORDER BY count DESC
            LIMIT 50
          `;
          const sizeResult = await queryWithTimeout(sizeQuery, sizeBase.params, usePreFiltered ? 15000 : 20000);
          const resultMap = {};
          sizeResult.rows.forEach(row => {
            resultMap[row.value] = parseInt(row.count);
          });
          return resultMap;
        } catch (err) {
          console.error('[ERROR] Size aggregation failed:', err.message);
          return {};
        }
      })(),
      
      // 8. Tag aggregations
      runAggregation('Tag', 'tag', (base, alias) => {
        const whereClause = `${base.whereClause} AND ${alias}.tag_slug IS NOT NULL`;
        return `
          SELECT 
            LOWER(${alias}.tag_slug) as value,
            COUNT(DISTINCT ${alias}.style_code) as count
          FROM product_search_materialized ${alias}
          ${base.productTypeJoin}
          ${whereClause}
          GROUP BY LOWER(${alias}.tag_slug)
          ORDER BY count DESC
          LIMIT 50
        `;
      })
    ]);
    
    // Assign results
    aggregations.gender = genderResult;
    aggregations.ageGroup = ageGroupResult;
    aggregations.sleeve = sleeveResult;
    aggregations.neckline = necklineResult;
    aggregations.fabric = fabricResult;
    aggregations.size = sizeResult;
    aggregations.tag = tagResult;
    
    // 7. Feature aggregations - SKIPPED: feature column doesn't exist in product_search_materialized
    // Features are not available in the materialized view, return empty object
    
    return aggregations;
  } catch (error) {
    console.error('[ERROR] buildFilterAggregations failed:', {
      message: error.message,
      stack: error.stack,
      filters: JSON.stringify(filters)
    });
    // Return initialized aggregations on error (don't break the main query)
    return aggregations;
  }
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
      // OPTIMIZED: Natural language search - Performance focused
      const searchTerms = trimmedSearch.split(/\s+/).filter(t => t.length > 0);
      const normalizedSearch = searchTerms.join(' ');
      const searchUpper = normalizedSearch.toUpperCase();
      
      // Simplified normalization (faster)
      const normalizeTerm = (term, type) => {
        const lower = term.toLowerCase();
        switch(type) {
          case 'neckline':
            if (lower.includes('crew')) return 'crew-neck';
            if (lower.includes('vneck') || lower.includes('v-neck')) return 'v-neck';
            return lower.replace(/[^a-z0-9]/g, '-');
          case 'sleeve':
            if (lower.includes('long')) return 'long-sleeve';
            if (lower.includes('short')) return 'short-sleeve';
            return lower.replace(/[^a-z0-9]/g, '-');
          default:
            return lower.replace(/[^a-z0-9]/g, '-');
        }
      };
      
      // Pre-compute normalized terms
      const colorTerms = searchTerms.map(t => normalizeTerm(t, 'color'));
      const fabricTerms = searchTerms.map(t => normalizeTerm(t, 'fabric'));
      const necklineTerms = searchTerms.map(t => normalizeTerm(t, 'neckline'));
      const sleeveTerms = searchTerms.map(t => normalizeTerm(t, 'sleeve'));
      const styleTerms = searchTerms.map(t => normalizeTerm(t, 'style'));
      
      // OPTIMIZED: Prioritize indexed operations - full-text search first (GIN index)
      const fullTextParam = paramIndex;
      params.push(normalizedSearch);
      paramIndex++;
      
      const codeParam = paramIndex;
      params.push(searchUpper);
      paramIndex++;
      
      const codePrefixParam = paramIndex;
      params.push(`${searchUpper}%`);
      paramIndex++;
      
      // REMOVED: nameParam - style_name ILIKE is too slow
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
      
      // ULTRA-OPTIMIZED: Prioritize ONLY the fastest indexed operations
      // Remove slow ILIKE operations that cause full table scans
      // Focus on: full-text search (GIN index) + style_code (B-tree index) + array matches (GIN indexes)
      searchCondition = `(
        ${viewAlias}.search_vector @@ plainto_tsquery('english', $${fullTextParam}) OR
        ${viewAlias}.style_code = $${codeParam} OR
        ${viewAlias}.style_code ILIKE $${codePrefixParam} OR
        ${viewAlias}.colour_slugs && $${colorArrayParam}::text[] OR
        ${viewAlias}.fabric_slugs && $${fabricArrayParam}::text[] OR
        ${viewAlias}.neckline_slugs && $${necklineArrayParam}::text[] OR
        ${viewAlias}.sleeve_slugs && $${sleeveArrayParam}::text[] OR
        ${viewAlias}.style_keyword_slugs && $${styleArrayParam}::text[]
      )`;
      // REMOVED: style_name ILIKE - too slow, causes full table scan
      
      // ULTRA-OPTIMIZED: Simplified relevance - removed expensive calculations
      // Only calculate relevance for indexed operations (fast)
      searchRelevanceSelect = `
        (
          -- Exact style code match (100 points) - FAST (indexed)
          CASE WHEN ${viewAlias}.style_code = $${codeParam} THEN 100 ELSE 0 END +
          -- Prefix style code match (80 points) - FAST (indexed)
          CASE WHEN ${viewAlias}.style_code ILIKE $${codePrefixParam} THEN 80 ELSE 0 END +
          -- Full-text search (60 points) - FAST (GIN index)
          CASE WHEN ${viewAlias}.search_vector @@ plainto_tsquery('english', $${fullTextParam}) THEN 60 ELSE 0 END +
          -- Array matches (30 points each) - FAST (GIN indexes)
          CASE WHEN ${viewAlias}.colour_slugs && $${colorArrayParam}::text[] THEN 30 ELSE 0 END +
          CASE WHEN ${viewAlias}.fabric_slugs && $${fabricArrayParam}::text[] THEN 30 ELSE 0 END +
          CASE WHEN ${viewAlias}.neckline_slugs && $${necklineArrayParam}::text[] THEN 20 ELSE 0 END +
          CASE WHEN ${viewAlias}.sleeve_slugs && $${sleeveArrayParam}::text[] THEN 20 ELSE 0 END +
          CASE WHEN ${viewAlias}.style_keyword_slugs && $${styleArrayParam}::text[] THEN 15 ELSE 0 END
        ) as relevance_score`;
      // REMOVED: ts_rank_cd calculation - too expensive
      // REMOVED: style_name ILIKE - too slow
      
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
        MIN(${viewAlias}.single_price) as single_price,
        MIN(${viewAlias}.created_at) as created_at,
        MIN(COALESCE(pt.display_order, 999)) as product_type_priority
        ${hasSearch ? ', MAX(scf.relevance_score) as relevance_score' : ''}
      FROM style_codes_filtered scf
      INNER JOIN product_search_materialized ${viewAlias} ON scf.style_code = ${viewAlias}.style_code AND ${viewAlias}.sku_status = 'Live'
      LEFT JOIN styles s ON ${viewAlias}.style_code = s.style_code
        LEFT JOIN product_types pt ON s.product_type_id = pt.id
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

    // ULTRA-OPTIMIZATION: Return products IMMEDIATELY, don't wait for aggregations
    // Aggregations are the bottleneck - load them separately or in background
    const aggregationCacheKey = getCacheKey(filters, 0, 0, 'aggregations');
    const cachedAggregations = getAggregationCache(aggregationCacheKey);
    
    // Initialize empty filters structure
    let filterAggregations = {
      gender: {},
      ageGroup: {},
      sleeve: {},
      neckline: {},
      fabric: {},
      size: {},
      feature: {},
      tag: {}
    };
    
    // Only use cached aggregations if available (instant)
    if (cachedAggregations) {
      filterAggregations = cachedAggregations;
      console.log('[CACHE] Using cached aggregations - instant response');
    } else {
      // Start loading aggregations in background (NON-BLOCKING)
      // Don't await - return products immediately
      buildFilterAggregations(filters, 'psm', null)
        .then(aggregations => {
          // Cache for future requests
          setAggregationCache(aggregationCacheKey, aggregations, AGGREGATION_CACHE_TTL);
          console.log('[CACHE] Aggregations loaded and cached in background');
        })
        .catch(error => {
          console.error('[ERROR] Background aggregation failed:', error.message);
        });
      
      console.log('[QUERY] Returning products immediately, loading filters in background');
    }

    const queryResponse = { 
      items, 
      total, 
      priceRange,
      filters: filterAggregations // Empty if not cached, will populate on next request
    };
    
    // Cache the response immediately (with empty filters if not cached)
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
