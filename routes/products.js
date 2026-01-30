const express = require('express');
const router = express.Router();
const { pool, queryWithTimeout } = require('../config/database');
const { buildProductListQuery, buildProductDetailQuery } = require('../services/productService');
const { applyMarkup } = require('../utils/priceMarkup');

/**
 * GET /api/products
 * Product list endpoint with filtering, search, pagination
 */
router.get('/', async (req, res) => {
  try {
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
    // Map to internal sort values
    let normalizedSort = sort;
    let normalizedOrder = order;
    
    if (sort === 'best') {
      // Keep 'best' as-is so productService can prioritise special flags
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

    // Parse array params - handles both array format (gender[]=x&gender[]=y) and single values
    const parseArray = (val) => {
      if (!val) return [];
      // If already an array, return as is
      if (Array.isArray(val)) return val;
      // If it's an object (Express sometimes parses arrays as objects with numeric keys), convert to array
      if (typeof val === 'object') {
        return Object.values(val);
      }
      // Single value, wrap in array
      return [val];
    };

    // Map weight ranges to slugs
    // Frontend sends: "051-100", "101-150", "151-200", "201-250", "251-300", "over-300"
    // Database slugs: "051-100gsm", "101-150gsm", "151-200gsm", "201-250gsm", "251-300gsm", "over-300gsm"
    const mapWeightToSlug = (weightValue) => {
      if (!weightValue) return weightValue;
      const normalized = weightValue.toLowerCase().trim().replace(/\s+/g, '-');
      // Append 'gsm' if not already present
      return normalized.endsWith('gsm') ? normalized : `${normalized}gsm`;
    };

    // Normalize style keyword slugs - remove trailing "-1", "-2", etc. variations
    // Example: "crew-neck-1" -> "crew-neck", "classic-1" -> "classic"
    const normalizeStyleSlug = (slug) => {
      if (!slug) return slug;
      const lowerSlug = slug.toLowerCase().trim();
      // Remove trailing pattern like "-1", "-2", "-3", etc.
      // Match: word followed by dash and one or more digits at the end
      return lowerSlug.replace(/-\d+$/, '');
    };

    // Normalize style array - handle both 'style' and 'styles', normalize slugs, remove duplicates
    const styleArray = parseArray(style || styles); // Accept both parameter names
    const normalizedStyles = [...new Set(styleArray.map(normalizeStyleSlug).filter(s => s))];

    const filters = {
      q: q || text || null, // Handle both 'q' and 'text' parameters
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
      style: normalizedStyles, // Use normalized style slugs
      feature: parseArray(feature),
      size: parseArray(size),
      fabric: parseArray(fabric),
      flag: parseArray(flag),
      weight: parseArray(weight).map(mapWeightToSlug), // Map weight values to slugs
      fit: parseArray(fit),
      sector: parseArray(sector),
      sport: parseArray(sport),
      tag: parseArray(tag),
      effect: parseArray(effect),
      brand: parseArray(brand || brands), // Accept brand or brands parameter
      productType: parseArray(productType || productTypes || category || categories), // Accept productType, productTypes, category, categories (mobile uses category)
      sort: normalizedSort || 'newest', // Use normalized sort value
      order: normalizedOrder ? (normalizedOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC') : 'DESC' // Use normalized order value
    };

    // ENTERPRISE-LEVEL: Input validation and sanitization with logging
    const rawPage = parseInt(page);
    const rawLimit = parseInt(limit);
    
    // Validate and sanitize pagination parameters
    const pageNum = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const limitNum = Math.min(200, Math.max(1, isNaN(rawLimit) ? 24 : rawLimit));
    
    // Log pagination request for monitoring
    console.log(`[PAGINATION REQUEST] page=${pageNum}, limit=${limitNum}, rawLimit=${limit}, filters=${Object.keys(filters).filter(k => filters[k] && (Array.isArray(filters[k]) ? filters[k].length > 0 : true)).join(',')}`);
    
    if (filters.priceMin !== null && (isNaN(filters.priceMin) || filters.priceMin < 0)) {
      return res.status(400).json({ error: 'Invalid priceMin value' });
    }
    if (filters.priceMax !== null && (isNaN(filters.priceMax) || filters.priceMax < 0)) {
      return res.status(400).json({ error: 'Invalid priceMax value' });
    }
    if (filters.priceMin !== null && filters.priceMax !== null && filters.priceMin > filters.priceMax) {
      return res.status(400).json({ error: 'priceMin cannot be greater than priceMax' });
    }

    const { items, total, priceRange } = await buildProductListQuery(filters, pageNum, limitNum);

    // ENTERPRISE-LEVEL: Log response metrics
    console.log(`[PAGINATION RESPONSE] requested=${limitNum}, returned=${items.length}, total=${total}, page=${pageNum}`);
    
    // Warn if fewer items returned than requested (and not on last page)
    const expectedOnPage = Math.min(limitNum, total - (pageNum - 1) * limitNum);
    if (items.length < expectedOnPage && items.length > 0) {
      console.warn(`[PAGINATION WARNING] Fewer items returned than expected: got ${items.length}, expected ${expectedOnPage}`);
    }

    res.json({
      items,
      page: pageNum,
      limit: limitNum,
      total,
      priceRange
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch products:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    
    if (error.message && error.message.includes('timeout')) {
      return res.status(504).json({ 
        error: 'Request timeout', 
        message: 'The database query took too long. Please try again with more specific filters.' 
      });
    }
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return res.status(503).json({ 
        error: 'Service unavailable', 
        message: 'Database connection failed. Please try again later.' 
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error', 
      message: process.env.NODE_ENV === 'production' ? 'An error occurred' : error.message 
    });
  }
});

/**
 * GET /api/products/filters
 * Get filter aggregations (counts) for current filters
 * This endpoint allows frontend to load filters separately from products for instant loading
 */
router.get('/filters', async (req, res) => {
  try {
    const {
      q,
      text,
      priceMin,
      priceMax,
      gender,
      ageGroup,
      sleeve,
      neckline,
      fabric,
      size,
      tag,
      productType,
      productTypes,
      category,      // Alias for productType (used by mobile)
      categories     // Alias for productTypes (used by mobile)
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
      // Support both productType and category (mobile uses category)
      productType: parseArray(productType || productTypes || category || categories)
    };

    const { buildFilterAggregations } = require('../services/productService');
    const aggregations = await buildFilterAggregations(filters);

    res.json({ filters: aggregations });
  } catch (error) {
    console.error('[ERROR] Failed to fetch filter aggregations:', error.message);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

/**
 * GET /api/products/types
 * Get all product types with product counts
 * Useful for displaying product type filters in the frontend
 */
router.get('/types', async (req, res) => {
  try {
    
    const query = `
      SELECT 
        pt.id,
        pt.name,
        pt.display_order,
        COUNT(DISTINCT s.style_code) as product_count
      FROM product_types pt
      INNER JOIN styles s ON pt.id = s.product_type_id
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY pt.id, pt.name, pt.display_order
      HAVING COUNT(DISTINCT s.style_code) > 0
      ORDER BY pt.display_order ASC, pt.name ASC
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT s.style_code) as total
      FROM styles s
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
    `;

    const [result, countResult] = await Promise.all([
      queryWithTimeout(query, [], 10000),
      queryWithTimeout(countQuery, [], 10000)
    ]);
    
    const totalProducts = parseInt(countResult.rows[0]?.total || 0);
    
    const productTypes = result.rows.map(row => {
      const count = parseInt(row.product_count || 0);
      const percentage = totalProducts > 0 
        ? ((count / totalProducts) * 100).toFixed(2) 
        : '0.00';
      
      return {
        id: row.id,
        name: row.name,
        count: count,
        percentage: percentage + '%',
        displayOrder: row.display_order
      };
    });

    res.json({
      productTypes,
      total: totalProducts
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch product types:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

/**
 * GET /api/products/:code/related
 * Get related products (same brand AND same product type)
 */
router.get('/:code/related', async (req, res) => {
  try {
    const { code } = req.params;
    const { limit = 12 } = req.query;

    // First, get the current product's brand and product type
    const productInfoQuery = `
      SELECT 
        s.brand_id,
        s.product_type_id,
        b.name as brand_name,
        pt.name as product_type_name
      FROM styles s
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
      WHERE s.style_code = $1
    `;

    const productInfoResult = await queryWithTimeout(productInfoQuery, [code.toUpperCase()], 10000);

    if (productInfoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const { brand_id, product_type_id, brand_name, product_type_name } = productInfoResult.rows[0];

    // Get related products: same brand AND same product type (excluding current product)
    const relatedQuery = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand,
        pt.name as product_type
      FROM product_search_materialized psm
      INNER JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
      WHERE s.brand_id = $1 
        AND s.product_type_id = $2
        AND psm.style_code != $3
        AND psm.sku_status = 'Live'
      ORDER BY psm.created_at DESC
      LIMIT $4
    `;

    const relatedResult = await queryWithTimeout(
      relatedQuery, 
      [brand_id, product_type_id, code.toUpperCase(), parseInt(limit)], 
      15000
    );

    // If not enough related products from same brand+type, get more from same product type
    let additionalProducts = [];
    if (relatedResult.rows.length < parseInt(limit)) {
      const remainingLimit = parseInt(limit) - relatedResult.rows.length;
      const existingCodes = [code.toUpperCase(), ...relatedResult.rows.map(r => r.code)];
      
      const additionalQuery = `
        SELECT DISTINCT
          psm.style_code as code,
          psm.style_name as name,
          psm.single_price as price,
          psm.primary_image_url as image,
          b.name as brand,
          pt.name as product_type
        FROM product_search_materialized psm
        INNER JOIN styles s ON psm.style_code = s.style_code
        LEFT JOIN brands b ON s.brand_id = b.id
        LEFT JOIN product_types pt ON s.product_type_id = pt.id
        WHERE s.product_type_id = $1
          AND psm.style_code != ALL($2::text[])
          AND psm.sku_status = 'Live'
        ORDER BY psm.created_at DESC
        LIMIT $3
      `;

      const additionalResult = await queryWithTimeout(
        additionalQuery,
        [product_type_id, existingCodes, remainingLimit],
        15000
      );
      additionalProducts = additionalResult.rows;
    }

    // Apply markup to all related products' prices
    const applyMarkupToProducts = (products) => {
      return products.map(p => ({
        ...p,
        price: applyMarkup(parseFloat(p.price))
      }));
    };

    const markedUpRelated = applyMarkupToProducts(relatedResult.rows);
    const markedUpAdditional = applyMarkupToProducts(additionalProducts);
    const allRelated = [...markedUpRelated, ...markedUpAdditional];

    res.json({
      currentProduct: {
        code: code.toUpperCase(),
        brand: brand_name,
        productType: product_type_name
      },
      related: allRelated,
      total: allRelated.length,
      sameBrandAndType: markedUpRelated.length,
      sameTypeOnly: markedUpAdditional.length
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch related products:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/products/:code/pricing
 * Get pricing information for a style code
 * Returns: carton_price, markup_percent, and sell_price
 */
router.get('/:code/pricing', async (req, res) => {
  try {
    const { code } = req.params;

    // Query to get pricing information with the applied markup rule
    // First get the product, then find the matching pricing rule
    const query = `
      SELECT 
        p.style_code,
        COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) as carton_price,
        p.single_price,
        p.carton_price as raw_carton_price,
        p.sell_price,
        pr.markup_percent,
        pr.from_price as rule_from_price,
        pr.to_price as rule_to_price,
        pr.version as rule_version,
        NULL::text as rule_description
      FROM products p
      LEFT JOIN pricing_rules pr ON pr.active = true
        AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
          >= pr.from_price
        AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
          <= pr.to_price
      WHERE p.style_code = $1
        AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) IS NOT NULL
      ORDER BY pr.from_price DESC
      LIMIT 1
    `;

    const result = await queryWithTimeout(query, [code], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Product not found or has no pricing information',
        style_code: code 
      });
    }

    const row = result.rows[0];

    res.json({
      style_code: row.style_code,
      carton_price: parseFloat(row.carton_price) || 0,
      single_price: parseFloat(row.single_price) || 0,
      markup_percent: row.markup_percent ? parseFloat(row.markup_percent) : null,
      sell_price: row.sell_price ? parseFloat(row.sell_price) : null,
      pricing_rule: row.markup_percent ? {
        from_price: parseFloat(row.rule_from_price),
        to_price: parseFloat(row.rule_to_price),
        markup_percent: parseFloat(row.markup_percent),
        description: row.rule_description || null
      } : null
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch pricing information:', {
      message: error.message,
      stack: error.stack,
      style_code: req.params.code
    });
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/products/:code
 * Product detail endpoint
 */
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const product = await buildProductDetailQuery(code);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    console.error('[ERROR] Failed to fetch product detail:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;

