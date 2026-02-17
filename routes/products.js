const express = require('express');
const router = express.Router();
const { pool, queryWithTimeout } = require('../config/database');
const { buildProductListQuery, buildProductDetailQuery } = require('../services/productService');
const { applyMarkup } = require('../utils/priceMarkup');
const cache = require('../services/cacheService');

/**
 * Helper: wrap a route handler's response in Redis cache.
 * Uses the full URL as cache key. TTL defaults to PRODUCTS (3 days).
 */
async function routeCache(req, ttl) {
  const rawKey = `products:route:${req.originalUrl}`;
  let hash = 0;
  for (let i = 0; i < rawKey.length; i++) {
    const char = rawKey.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const cacheKey = `products:route:${Math.abs(hash)}`;
  let cached = null;
  try {
    cached = await cache.get(cacheKey);
  } catch (err) {
    console.warn(`[CACHE] Products route get error:`, err.message);
  }
  return {
    cacheKey,
    cached,
    ttl: ttl || cache.TTL.PRODUCTS,
    async store(data) {
      try {
        await cache.set(cacheKey, data, this.ttl);
      } catch (err) {
        console.warn(`[CACHE] Products route set error:`, err.message);
      }
    }
  };
}

/**
 * GET /api/products
 * Product list endpoint with filtering, search, pagination
 */
router.get('/', async (req, res) => {
  try {
    const rc = await routeCache(req);
    if (rc.cached) return res.json(rc.cached);

    const {
      page = 1,
      limit = 24,
      q,
      text, // Frontend may send 'text' instead of 'q'
      priceMin,
      priceMax,
      gender,
      ageGroup,
      sleeve,
      neckline,
      accreditations,
      primaryColour,
      colourShade,
      colour,
      style,
      styles, // Accept both 'style' and 'styles' parameters
      feature,
      size,
      fabric,
      flag,
      isBestSeller,
      isRecommended,
      weight,
      fit,
      sector,
      sport,
      tag,
      effect,
      brand,        // Brand filter - accepts brand slug(s) or name(s)
      brands,       // Accept both 'brand' and 'brands' parameters
      productType, // Product type filter - accepts product type names
      productTypes, // Accept both 'productType' and 'productTypes' parameters
      category,     // Alias for productType (used by mobile)
      categories,   // Alias for productTypes (used by mobile)
      sort = 'newest',
      order = 'desc'
    } = req.query;

    // Normalize sort parameter to handle frontend values
    // Frontend sends: best, brand-az, brand-za, code-az, code-za, price-lh, price-hl
    let normalizedSort = sort;
    let normalizedOrder = order;

    if (sort === 'best') {
      normalizedSort = 'best';
      normalizedOrder = 'desc';
    } else if (sort === 'brand-az') {
      normalizedSort = 'brand';
      normalizedOrder = 'asc';
    } else if (sort === 'brand-za') {
      normalizedSort = 'brand';
      normalizedOrder = 'desc';
    } else if (sort === 'code-az') {
      normalizedSort = 'code';
      normalizedOrder = 'asc';
    } else if (sort === 'code-za') {
      normalizedSort = 'code';
      normalizedOrder = 'desc';
    } else if (sort === 'price-lh') {
      normalizedSort = 'price';
      normalizedOrder = 'asc';
    } else if (sort === 'price-hl') {
      normalizedSort = 'price';
      normalizedOrder = 'desc';
    }

    // Helper functions
    const parseArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'object') return Object.values(val);
      return [val];
    };

    const mapWeightToSlug = (weightValue) => {
      if (!weightValue) return weightValue;
      const normalized = weightValue.toLowerCase().trim().replace(/\s+/g, '-');
      return normalized.endsWith('gsm') ? normalized : `${normalized}gsm`;
    };

    const normalizeStyleSlug = (slug) => {
      if (!slug) return slug;
      const lowerSlug = slug.toLowerCase().trim();
      return lowerSlug.replace(/-\d+$/, '');
    };

    const styleArray = parseArray(style || styles);
    const normalizedStyles = [...new Set(styleArray.map(normalizeStyleSlug).filter(s => s))];

    const filters = {
      q: q || text || null,
      priceMin: priceMin ? parseFloat(priceMin) : null,
      priceMax: priceMax ? parseFloat(priceMax) : null,
      gender: parseArray(gender),
      ageGroup: parseArray(ageGroup),
      sleeve: parseArray(sleeve),
      neckline: parseArray(neckline),
      accreditations: parseArray(accreditations),
      primaryColour: parseArray(primaryColour),
      colourShade: parseArray(colourShade),
      colour: parseArray(colour),
      style: normalizedStyles,
      feature: parseArray(feature),
      size: parseArray(size),
      fabric: parseArray(fabric),
      flag: parseArray(flag),
      isBestSeller: isBestSeller === 'true' || isBestSeller === true,
      isRecommended: isRecommended === 'true' || isRecommended === true,
      weight: parseArray(weight).map(mapWeightToSlug),
      fit: parseArray(fit),
      sector: parseArray(sector),
      sport: parseArray(sport),
      tag: parseArray(tag),
      effect: parseArray(effect),
      brand: parseArray(brand || brands),
      productType: parseArray(productType || productTypes || category || categories),
      sort: normalizedSort,
      order: normalizedOrder ? (normalizedOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC') : 'DESC'
    };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 24));

    console.log(`[PAGINATION REQUEST] page=${pageNum}, limit=${limitNum}, filters=${Object.keys(filters).filter(k => filters[k] && (Array.isArray(filters[k]) ? filters[k].length > 0 : true)).join(',')}`);

    const { items, total, priceRange } = await buildProductListQuery(filters, pageNum, limitNum);

    const response = {
      items,
      page: pageNum,
      limit: limitNum,
      total,
      priceRange
    };
    await rc.store(response);
    res.json(response);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/products/discontinued
 * Discontinued product list endpoint
 */
router.get('/discontinued', async (req, res) => {
  try {
    const rc = await routeCache(req);
    if (rc.cached) return res.json(rc.cached);

    const {
      page = 1,
      limit = 24,
      q,
      productType,
      productTypes,
      category,
      categories
    } = req.query;

    const parseArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'object') return Object.values(val);
      return [val];
    };

    const normalizeProductType = (pt) => {
      if (!pt) return pt;
      const normalized = pt.trim().toLowerCase();
      let cleaned = normalized.replace(/[- ]/g, '');
      if (cleaned.includes('tshirt')) {
        cleaned = 'tshirts';
      }
      return cleaned;
    };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 24));
    const offset = (pageNum - 1) * limitNum;

    const params = [];
    const conditions = ["p.sku_status = 'Discontinued'"];
    let pIdx = 1;

    if (q) {
      conditions.push(`(s.style_name ILIKE $${pIdx} OR s.style_code ILIKE $${pIdx})`);
      params.push(`%${q}%`);
      pIdx++;
    }

    const ptFilter = parseArray(productType || productTypes || category || categories);
    if (ptFilter.length > 0) {
      const normalizedPTs = ptFilter.map(normalizeProductType);
      conditions.push(`LOWER(REPLACE(REPLACE(pt.name, '-', ''), ' ', '')) = ANY($${pIdx}::text[])`);
      params.push(normalizedPTs);
      pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT 
        s.style_code as code, 
        s.style_name as name, 
        MIN(p.sell_price) as price,
        MIN(COALESCE(
          NULLIF(p.primary_image_url, 'Not available'), 
          NULLIF(p.colour_image_url, 'Not available')
        )) as image,
        MIN(b.name) as brand,
        MIN(pt.name) as product_type
      FROM products p
      INNER JOIN styles s ON p.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
      ${whereClause}
      GROUP BY s.style_code, s.style_name
      ORDER BY s.style_name ASC
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;

    const countSql = `
      SELECT COUNT(DISTINCT s.style_code) as count
      FROM products p
      INNER JOIN styles s ON p.style_code = s.style_code
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
      ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      queryWithTimeout(sql, [...params, limitNum, offset], 15000),
      queryWithTimeout(countSql, params, 15000)
    ]);

    const items = result.rows;
    const total = parseInt(countResult.rows[0].count, 10) || 0;

    const response = {
      items,
      page: pageNum,
      limit: limitNum,
      total,
      message: items.length === 0 ? "No discontinued products found" : undefined
    };

    await rc.store(response);
    res.json(response);
  } catch (error) {
    console.error('[ERROR] Failed to fetch discontinued products:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/products/filters
 * Get filter aggregations (counts) for current filters
 */
router.get('/filters', async (req, res) => {
  try {
    const rc = await routeCache(req, cache.TTL.FILTER);
    if (rc.cached) return res.json(rc.cached);

    const {
      q, text, priceMin, priceMax, gender, ageGroup, sleeve, neckline, fabric, size, tag, productType, productTypes, category, categories
    } = req.query;

    const parseArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'object') return Object.values(val);
      return [val];
    };

    const filters = {
      q: q || text || null,
      priceMin: priceMin ? parseFloat(priceMin) : null,
      priceMax: priceMax ? parseFloat(priceMax) : null,
      gender: parseArray(gender),
      ageGroup: parseArray(ageGroup),
      sleeve: parseArray(sleeve),
      neckline: parseArray(neckline),
      fabric: parseArray(fabric),
      size: parseArray(size),
      tag: parseArray(tag),
      productType: parseArray(productType || productTypes || category || categories)
    };

    const { buildFilterAggregations } = require('../services/productService');
    const aggregations = await buildFilterAggregations(filters);

    const response = { filters: aggregations };
    await rc.store(response);
    res.json(response);
  } catch (error) {
    console.error('[ERROR] Failed to fetch filters:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/products/suggest
 */
router.get('/suggest', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ brands: [], types: [], products: [] });

    const rc = await routeCache(req, cache.TTL.PRODUCTS);
    if (rc.cached) return res.json(rc.cached);

    const { getSearchSuggestions } = require('../services/search');
    const suggestions = await getSearchSuggestions(q);

    await rc.store(suggestions);
    res.json(suggestions);
  } catch (error) {
    res.json({ brands: [], types: [], products: [] });
  }
});

/**
 * GET /api/products/types
 */
router.get('/types', async (req, res) => {
  try {
    const rc = await routeCache(req);
    if (rc.cached) return res.json(rc.cached);

    const query = `
      SELECT pt.id, pt.name, pt.display_order, COUNT(DISTINCT s.style_code) as product_count
      FROM product_types pt
      INNER JOIN styles s ON pt.id = s.product_type_id
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY pt.id, pt.name, pt.display_order
      HAVING COUNT(DISTINCT s.style_code) > 0
      ORDER BY pt.display_order ASC, pt.name ASC
    `;

    const result = await queryWithTimeout(query, [], 10000);
    const response = { productTypes: result.rows };
    await rc.store(response);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/products/:code/related
 */
router.get('/:code/related', async (req, res) => {
  try {
    const { code } = req.params;
    const { limit = 12 } = req.query;

    const query = `
      SELECT DISTINCT psm.style_code as code, psm.style_name as name, psm.sell_price as price, psm.primary_image_url as image
      FROM product_search_mv psm
      JOIN styles s ON psm.style_code = s.style_code
      WHERE s.product_type_id = (SELECT product_type_id FROM styles WHERE style_code = $1)
        AND psm.style_code != $1
        AND psm.sku_status = 'Live'
      LIMIT $2
    `;

    const result = await queryWithTimeout(query, [code.toUpperCase(), parseInt(limit)], 10000);
    res.json({ related: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/products/:code
 */
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const product = await buildProductDetailQuery(code);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
