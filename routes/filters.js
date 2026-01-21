const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../config/database');
// No longer need applyMarkup - using sell_price directly from DB

// Helper function to build price breaks from base price
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

// Helper function to fetch full product details for style codes
async function getFullProductDetails(styleCodes) {
  if (!styleCodes || styleCodes.length === 0) return [];

  const query = `
    SELECT 
      p.style_code,
      s.style_name,
      b.name as brand,
      p.colour_name,
      p.primary_colour,
      p.colour_image_url,
      p.primary_image_url,
      sz.name as size,
      sz.size_order,
      p.single_price,
      p.pack_price,
      p.carton_price,
      p.sell_price
    FROM products p
    INNER JOIN styles s ON p.style_code = s.style_code
    LEFT JOIN brands b ON s.brand_id = b.id
    LEFT JOIN sizes sz ON p.size_id = sz.id
    WHERE p.style_code = ANY($1::text[]) AND p.sku_status = 'Live'
    ORDER BY p.style_code, p.colour_name, sz.size_order
  `;

  const result = await queryWithTimeout(query, [styleCodes], 20000);
  
  // Group by style_code
  const productsMap = new Map();
  
  result.rows.forEach(row => {
    const styleCode = row.style_code;
    
    if (!productsMap.has(styleCode)) {
      productsMap.set(styleCode, {
        code: styleCode,
        name: row.style_name || '',
        brand: row.brand || '',
        primaryImageUrl: row.primary_image_url || '',
        colorsMap: new Map(),
        sizesSet: new Set(),
        prices: [],
        singlePrice: null,
        packPrice: null,
        cartonPrice: null,
        sellPrice: null
      });
    }
    
    const product = productsMap.get(styleCode);
    
    // Collect sizes
    if (row.size) {
      product.sizesSet.add(row.size);
    }
    
    // Collect colors
    const colorKey = row.colour_name || row.primary_colour || 'Unknown';
    if (!product.colorsMap.has(colorKey)) {
      const colorImage = row.colour_image_url || row.primary_image_url || '';
      product.colorsMap.set(colorKey, {
        name: colorKey,
        main: colorImage,
        thumb: colorImage
      });
    }
    
    // Collect prices
    if (row.single_price) {
      const single = parseFloat(row.single_price);
      if (!product.singlePrice) product.singlePrice = single;
    }
    if (row.carton_price) {
      const carton = parseFloat(row.carton_price);
      if (!product.cartonPrice) product.cartonPrice = carton;
    }
    if (row.sell_price) {
      const sell = parseFloat(row.sell_price);
      if (!product.sellPrice) product.sellPrice = sell;
    }
  });

  // Build response items maintaining original order
  const items = styleCodes.map(styleCode => {
    const product = productsMap.get(styleCode);
    if (!product) return null;

    // Use sell_price directly (already marked-up in DB)
    const basePrice = product.sellPrice || 0;
    const priceBreaks = buildPriceBreaks(basePrice);

    // Sort sizes
    const sizes = Array.from(product.sizesSet).sort((a, b) => {
      const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
      const aIndex = sizeOrder.indexOf(a.toUpperCase());
      const bIndex = sizeOrder.indexOf(b.toUpperCase());
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });

    // Display price = sell price (or fallback)
    const displayPrice = basePrice;

    return {
      code: product.code,
      name: product.name,
      price: displayPrice,
      image: product.primaryImageUrl || '',
      colors: Array.from(product.colorsMap.values()),
      sizes,
      customization: ['embroidery', 'print'],
      brand: product.brand || '',
      priceBreaks
    };
  }).filter(item => item !== null);

  return items;
}

// Helper to get products by filter with full details
async function getFilteredProductsWithDetails(filterColumn, filterValue, page, limit) {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  // Get style codes matching the filter
  const styleCodesQuery = `
    SELECT DISTINCT style_code
    FROM product_search_materialized
    WHERE ${filterColumn} = $1 AND sku_status = 'Live'
    ORDER BY style_code
    LIMIT $2 OFFSET $3
  `;
  
  const countQuery = `
    SELECT COUNT(DISTINCT style_code) as total
    FROM product_search_materialized
    WHERE ${filterColumn} = $1 AND sku_status = 'Live'
  `;

  const [styleCodesResult, countResult] = await Promise.all([
    queryWithTimeout(styleCodesQuery, [filterValue, parseInt(limit), offset], 15000),
    queryWithTimeout(countQuery, [filterValue], 10000)
  ]);

  const styleCodes = styleCodesResult.rows.map(r => r.style_code);
  const items = await getFullProductDetails(styleCodes);
  const total = parseInt(countResult.rows[0]?.total || 0);

  // Calculate price range
  let minPrice = Infinity, maxPrice = 0;
  items.forEach(item => {
    if (item.price > 0) {
      minPrice = Math.min(minPrice, item.price);
      maxPrice = Math.max(maxPrice, item.price);
    }
  });

  return {
    items,
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    priceRange: {
      min: minPrice === Infinity ? 0 : Math.round(minPrice * 100) / 100,
      max: Math.round(maxPrice * 100) / 100
    }
  };
}

// Helper to get products by ARRAY filter (for slugs stored in arrays)
async function getArrayFilteredProductsWithDetails(arrayColumn, filterValue, page, limit, sort = 'newest', order = 'DESC') {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  // Normalize sort parameter
  let normalizedSort = sort;
  let normalizedOrder = order;
  
  if (sort === 'best') {
    normalizedSort = 'newest';
    normalizedOrder = 'DESC';
  } else if (sort === 'brand-az') {
    normalizedSort = 'brand';
    normalizedOrder = 'ASC';
  } else if (sort === 'brand-za') {
    normalizedSort = 'brand';
    normalizedOrder = 'DESC';
  } else if (sort === 'code-az') {
    normalizedSort = 'code';
    normalizedOrder = 'ASC';
  } else if (sort === 'code-za') {
    normalizedSort = 'code';
    normalizedOrder = 'DESC';
  } else if (sort === 'price-lh') {
    normalizedSort = 'price';
    normalizedOrder = 'ASC';
  } else if (sort === 'price-hl') {
    normalizedSort = 'price';
    normalizedOrder = 'DESC';
  }
  
  // Determine sort field - use fields from product_search_materialized or join tables
  let orderBy = 'psm.style_code';
  if (normalizedSort === 'price') {
    orderBy = `psm.sell_price ${normalizedOrder}, psm.style_code`;
  } else if (normalizedSort === 'name') {
    orderBy = `psm.style_name ${normalizedOrder}, psm.style_code`;
  } else if (normalizedSort === 'brand') {
    // Need to join brands table for brand sorting
    orderBy = `b.name ${normalizedOrder}, psm.style_code`;
  } else if (normalizedSort === 'code') {
    orderBy = `psm.style_code ${normalizedOrder}`;
  } else {
    // Default: newest (created_at)
    orderBy = `psm.created_at ${normalizedOrder}, psm.style_code`;
  }
  
  const styleCodesQuery = `
    SELECT DISTINCT psm.style_code
    FROM product_search_materialized psm
    LEFT JOIN styles s ON psm.style_code = s.style_code
    LEFT JOIN brands b ON s.brand_id = b.id
    WHERE ${arrayColumn} && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
    ORDER BY ${orderBy}
    LIMIT $2 OFFSET $3
  `;
  
  const countQuery = `
    SELECT COUNT(DISTINCT style_code) as total
    FROM product_search_materialized
    WHERE ${arrayColumn} && ARRAY[$1]::text[] AND sku_status = 'Live'
  `;

  const [styleCodesResult, countResult] = await Promise.all([
    queryWithTimeout(styleCodesQuery, [filterValue, parseInt(limit), offset], 15000),
    queryWithTimeout(countQuery, [filterValue], 10000)
  ]);

  const styleCodes = styleCodesResult.rows.map(r => r.style_code);
  const items = await getFullProductDetails(styleCodes);
  const total = parseInt(countResult.rows[0]?.total || 0);

  let minPrice = Infinity, maxPrice = 0;
  items.forEach(item => {
    if (item.price > 0) {
      minPrice = Math.min(minPrice, item.price);
      maxPrice = Math.max(maxPrice, item.price);
    }
  });

  return {
    items,
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    priceRange: {
      min: minPrice === Infinity ? 0 : Math.round(minPrice * 100) / 100,
      max: Math.round(maxPrice * 100) / 100
    }
  };
}

// Helper to get products by LOWER() filter (for case-insensitive text columns)
async function getLowerFilteredProductsWithDetails(column, filterValue, page, limit) {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  const styleCodesQuery = `
    SELECT DISTINCT style_code
    FROM product_search_materialized
    WHERE LOWER(${column}) = $1 AND sku_status = 'Live'
    ORDER BY style_code
    LIMIT $2 OFFSET $3
  `;
  
  const countQuery = `
    SELECT COUNT(DISTINCT style_code) as total
    FROM product_search_materialized
    WHERE LOWER(${column}) = $1 AND sku_status = 'Live'
  `;

  const [styleCodesResult, countResult] = await Promise.all([
    queryWithTimeout(styleCodesQuery, [filterValue, parseInt(limit), offset], 15000),
    queryWithTimeout(countQuery, [filterValue], 10000)
  ]);

  const styleCodes = styleCodesResult.rows.map(r => r.style_code);
  const items = await getFullProductDetails(styleCodes);
  const total = parseInt(countResult.rows[0]?.total || 0);

  let minPrice = Infinity, maxPrice = 0;
  items.forEach(item => {
    if (item.price > 0) {
      minPrice = Math.min(minPrice, item.price);
      maxPrice = Math.max(maxPrice, item.price);
    }
  });

  return {
    items,
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    priceRange: {
      min: minPrice === Infinity ? 0 : Math.round(minPrice * 100) / 100,
      max: Math.round(maxPrice * 100) / 100
    }
  };
}

// Helper for brand filtering (uses JOINs)
async function getBrandFilteredProductsWithDetails(brandSlug, page, limit) {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  const styleCodesQuery = `
    SELECT DISTINCT psm.style_code
    FROM product_search_materialized psm
    LEFT JOIN styles s ON psm.style_code = s.style_code
    LEFT JOIN brands b ON s.brand_id = b.id
    WHERE (LOWER(REPLACE(b.name, ' ', '-')) = $1 OR LOWER(b.name) = $1) AND psm.sku_status = 'Live'
    ORDER BY psm.style_code
    LIMIT $2 OFFSET $3
  `;
  
  const countQuery = `
    SELECT COUNT(DISTINCT psm.style_code) as total
    FROM product_search_materialized psm
    LEFT JOIN styles s ON psm.style_code = s.style_code
    LEFT JOIN brands b ON s.brand_id = b.id
    WHERE (LOWER(REPLACE(b.name, ' ', '-')) = $1 OR LOWER(b.name) = $1) AND psm.sku_status = 'Live'
  `;

  const [styleCodesResult, countResult] = await Promise.all([
    queryWithTimeout(styleCodesQuery, [brandSlug, parseInt(limit), offset], 15000),
    queryWithTimeout(countQuery, [brandSlug], 10000)
  ]);

  const styleCodes = styleCodesResult.rows.map(r => r.style_code);
  const items = await getFullProductDetails(styleCodes);
  const total = parseInt(countResult.rows[0]?.total || 0);

  let minPrice = Infinity, maxPrice = 0;
  items.forEach(item => {
    if (item.price > 0) {
      minPrice = Math.min(minPrice, item.price);
      maxPrice = Math.max(maxPrice, item.price);
    }
  });

  return {
    items,
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    priceRange: {
      min: minPrice === Infinity ? 0 : Math.round(minPrice * 100) / 100,
      max: Math.round(maxPrice * 100) / 100
    }
  };
}

// Helper for product type filtering (uses JOINs)
async function getProductTypeFilteredProductsWithDetails(productTypeSlug, page, limit, sort = 'newest', order = 'DESC') {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  // Normalize product type: remove hyphens and spaces, convert to DB format (e.g., "tshirts")
  // Handles: tshirts, tshirt, t shirt, t-shirt, t-shirts -> all match "tshirts" in DB
  const normalizeProductType = (slug) => {
    const normalized = slug.trim().toLowerCase();
    // Remove all hyphens and spaces
    let cleaned = normalized.replace(/[- ]/g, '');
    // Handle t-shirt variations specifically - always use plural "tshirts" to match DB
    if (cleaned.includes('tshirt')) {
      cleaned = 'tshirts'; // Always use plural form as stored in DB
    }
    return cleaned;
  };
  
  const searchTerm = normalizeProductType(productTypeSlug);
  
  // Normalize sort parameter
  let normalizedSort = sort;
  let normalizedOrder = order;
  
  if (sort === 'best') {
    normalizedSort = 'newest';
    normalizedOrder = 'DESC';
  } else if (sort === 'brand-az') {
    normalizedSort = 'brand';
    normalizedOrder = 'ASC';
  } else if (sort === 'brand-za') {
    normalizedSort = 'brand';
    normalizedOrder = 'DESC';
  } else if (sort === 'code-az') {
    normalizedSort = 'code';
    normalizedOrder = 'ASC';
  } else if (sort === 'code-za') {
    normalizedSort = 'code';
    normalizedOrder = 'DESC';
  } else if (sort === 'price-lh') {
    normalizedSort = 'price';
    normalizedOrder = 'ASC';
  } else if (sort === 'price-hl') {
    normalizedSort = 'price';
    normalizedOrder = 'DESC';
  }
  
  // Determine sort field
  let orderBy = 'psm.style_code';
  if (normalizedSort === 'price') {
    orderBy = `psm.sell_price ${normalizedOrder}, psm.style_code`;
  } else if (normalizedSort === 'name') {
    orderBy = `psm.style_name ${normalizedOrder}, psm.style_code`;
  } else if (normalizedSort === 'brand') {
    orderBy = `b.name ${normalizedOrder}, psm.style_code`;
  } else if (normalizedSort === 'code') {
    orderBy = `psm.style_code ${normalizedOrder}`;
  } else {
    // Default: newest (created_at)
    orderBy = `psm.created_at ${normalizedOrder}, psm.style_code`;
  }
  
  const styleCodesQuery = `
    SELECT DISTINCT psm.style_code
    FROM product_search_materialized psm
    INNER JOIN styles s ON psm.style_code = s.style_code
    INNER JOIN product_types pt ON s.product_type_id = pt.id
    LEFT JOIN brands b ON s.brand_id = b.id
    WHERE LOWER(REPLACE(REPLACE(pt.name, '-', ''), ' ', '')) = $1 AND psm.sku_status = 'Live'
    ORDER BY ${orderBy}
    LIMIT $2 OFFSET $3
  `;
  
  const countQuery = `
    SELECT COUNT(DISTINCT psm.style_code) as total
    FROM product_search_materialized psm
    INNER JOIN styles s ON psm.style_code = s.style_code
    INNER JOIN product_types pt ON s.product_type_id = pt.id
    WHERE LOWER(REPLACE(REPLACE(pt.name, '-', ''), ' ', '')) = $1 AND psm.sku_status = 'Live'
  `;

  const [styleCodesResult, countResult] = await Promise.all([
    queryWithTimeout(styleCodesQuery, [searchTerm, parseInt(limit), offset], 15000),
    queryWithTimeout(countQuery, [searchTerm], 10000)
  ]);

  const styleCodes = styleCodesResult.rows.map(r => r.style_code);
  const items = await getFullProductDetails(styleCodes);
  const total = parseInt(countResult.rows[0]?.total || 0);

  let minPrice = Infinity, maxPrice = 0;
  items.forEach(item => {
    if (item.price > 0) {
      minPrice = Math.min(minPrice, item.price);
      maxPrice = Math.max(maxPrice, item.price);
    }
  });

  return {
    items,
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    priceRange: {
      min: minPrice === Infinity ? 0 : Math.round(minPrice * 100) / 100,
      max: Math.round(maxPrice * 100) / 100
    }
  };
}

// ============================================================================
// GENDER ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/genders
 * Returns all genders from the database
 */
router.get('/genders', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        g.id,
        g.name,
        g.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM genders g
      LEFT JOIN product_search_materialized psm ON psm.gender_slug = g.slug AND psm.sku_status = 'Live'
      GROUP BY g.id, g.name, g.slug
      ORDER BY g.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ genders: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch genders:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/genders/:slug/products
 * Returns products matching a specific gender slug
 */
router.get('/genders/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getFilteredProductsWithDetails('gender_slug', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by gender:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// AGE GROUP ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/age-groups
 * Returns all age groups from the database
 */
router.get('/age-groups', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        ag.id,
        ag.name,
        ag.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM age_groups ag
      LEFT JOIN product_search_materialized psm ON psm.age_group_slug = ag.slug AND psm.sku_status = 'Live'
      GROUP BY ag.id, ag.name, ag.slug
      ORDER BY ag.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ ageGroups: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch age groups:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/age-groups/:slug/products
 * Returns products matching a specific age group slug
 */
router.get('/age-groups/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getFilteredProductsWithDetails('age_group_slug', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by age group:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// SLEEVE ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/sleeves
 * Returns all sleeve types from the database
 */
router.get('/sleeves', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        sk.id,
        sk.name,
        sk.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM style_keywords sk
      WHERE sk.type = 'sleeve'
      LEFT JOIN product_search_materialized psm ON psm.sleeve_slugs && ARRAY[sk.slug] AND psm.sku_status = 'Live'
      GROUP BY sk.id, sk.name, sk.slug
      ORDER BY sk.name ASC
    `;
    
    // Fallback query if above fails
    const fallbackQuery = `
      SELECT DISTINCT
        unnest(sleeve_slugs) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND sleeve_slugs IS NOT NULL
      GROUP BY unnest(sleeve_slugs)
      ORDER BY product_count DESC
    `;

    try {
      const result = await queryWithTimeout(query, [], 10000);
      res.json({ sleeves: result.rows, total: result.rows.length });
    } catch {
      const result = await queryWithTimeout(fallbackQuery, [], 10000);
      const sleeves = result.rows.map((row, idx) => ({
        id: idx + 1,
        name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        slug: row.slug,
        product_count: parseInt(row.product_count)
      }));
      res.json({ sleeves, total: sleeves.length });
    }
  } catch (error) {
    console.error('[ERROR] Failed to fetch sleeves:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/sleeves/:slug/products
 * Returns products matching a specific sleeve slug
 */
router.get('/sleeves/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('sleeve_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by sleeve:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// NECKLINE ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/necklines
 * Returns all neckline types from the database
 */
router.get('/necklines', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        unnest(neckline_slugs) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND neckline_slugs IS NOT NULL
      GROUP BY unnest(neckline_slugs)
      ORDER BY product_count DESC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    const necklines = result.rows.map((row, idx) => ({
      id: idx + 1,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      slug: row.slug,
      product_count: parseInt(row.product_count)
    }));
    res.json({ necklines, total: necklines.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch necklines:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/necklines/:slug/products
 * Returns products matching a specific neckline slug
 */
router.get('/necklines/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('neckline_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by neckline:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// FABRIC ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/fabrics
 * Returns all fabric types from the database
 */
router.get('/fabrics', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        f.id,
        f.name,
        f.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM fabrics f
      LEFT JOIN product_search_materialized psm ON psm.fabric_slugs && ARRAY[f.slug] AND psm.sku_status = 'Live'
      GROUP BY f.id, f.name, f.slug
      ORDER BY f.name ASC
    `;
    
    const fallbackQuery = `
      SELECT DISTINCT
        unnest(fabric_slugs) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND fabric_slugs IS NOT NULL
      GROUP BY unnest(fabric_slugs)
      ORDER BY product_count DESC
    `;

    try {
      const result = await queryWithTimeout(query, [], 10000);
      res.json({ fabrics: result.rows, total: result.rows.length });
    } catch {
      const result = await queryWithTimeout(fallbackQuery, [], 10000);
      const fabrics = result.rows.map((row, idx) => ({
        id: idx + 1,
        name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        slug: row.slug,
        product_count: parseInt(row.product_count)
      }));
      res.json({ fabrics, total: fabrics.length });
    }
  } catch (error) {
    console.error('[ERROR] Failed to fetch fabrics:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/fabrics/:slug/products
 * Returns products matching a specific fabric slug
 */
router.get('/fabrics/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('fabric_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by fabric:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// SIZE ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/sizes
 * Returns all sizes from the database
 */
router.get('/sizes', async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id,
        s.name,
        s.slug,
        s.size_order,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM sizes s
      LEFT JOIN product_search_materialized psm ON psm.size_slugs && ARRAY[s.slug] AND psm.sku_status = 'Live'
      GROUP BY s.id, s.name, s.slug, s.size_order
      ORDER BY s.size_order ASC NULLS LAST, s.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ sizes: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch sizes:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/sizes/:slug/products
 * Returns products matching a specific size slug
 */
router.get('/sizes/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('size_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by size:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// COLOR ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/colors
 * Returns all colors from the database
 */
router.get('/colors', async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM colours c
      LEFT JOIN product_search_materialized psm ON psm.colour_slugs && ARRAY[c.slug] AND psm.sku_status = 'Live'
      GROUP BY c.id, c.name, c.slug
      ORDER BY product_count DESC, c.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ colors: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch colors:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/colors/:slug/products
 * Returns products matching a specific color slug
 */
router.get('/colors/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('colour_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by color:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// PRIMARY COLOR ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/primary-colors
 * Returns all primary colors from the database
 */
router.get('/primary-colors', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        LOWER(primary_colour) as slug,
        primary_colour as name,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND primary_colour IS NOT NULL
      GROUP BY primary_colour
      ORDER BY product_count DESC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    const primaryColors = result.rows.map((row, idx) => ({
      id: idx + 1,
      name: row.name,
      slug: row.slug,
      product_count: parseInt(row.product_count)
    }));
    res.json({ primaryColors, total: primaryColors.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch primary colors:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/primary-colors/:slug/products
 * Returns products matching a specific primary color slug
 */
router.get('/primary-colors/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getLowerFilteredProductsWithDetails('primary_colour', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by primary color:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// STYLE KEYWORDS ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/styles
 * Returns all style keywords from the database
 */
router.get('/styles', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        unnest(style_keyword_slugs) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND style_keyword_slugs IS NOT NULL
      GROUP BY unnest(style_keyword_slugs)
      ORDER BY product_count DESC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    const styles = result.rows.map((row, idx) => ({
      id: idx + 1,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      slug: row.slug,
      product_count: parseInt(row.product_count)
    }));
    res.json({ styles, total: styles.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch styles:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/styles/:slug/products
 * Returns products matching a specific style keyword slug
 */
router.get('/styles/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('style_keyword_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by style:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// TAG ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/tags
 * Returns all tags from the database
 */
router.get('/tags', async (req, res) => {
  try {
    const query = `
      SELECT 
        t.id,
        t.name,
        t.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM tags t
      LEFT JOIN product_search_materialized psm ON LOWER(psm.tag_slug) = LOWER(t.slug) AND psm.sku_status = 'Live'
      GROUP BY t.id, t.name, t.slug
      ORDER BY product_count DESC, t.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ tags: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch tags:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/tags/:slug/products
 * Returns products matching a specific tag slug
 */
router.get('/tags/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getLowerFilteredProductsWithDetails('tag_slug', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by tag:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// WEIGHT ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/weights
 * Returns all weight ranges from the database
 */
router.get('/weights', async (req, res) => {
  try {
    const query = `
      SELECT 
        w.id,
        w.name,
        w.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM weights w
      LEFT JOIN product_search_materialized psm ON psm.weight_slugs && ARRAY[w.slug] AND psm.sku_status = 'Live'
      GROUP BY w.id, w.name, w.slug
      ORDER BY w.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ weights: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch weights:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/weights/:slug/products
 * Returns products matching a specific weight slug
 */
router.get('/weights/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('weight_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by weight:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// FIT ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/fits
 * Returns all fit types from the database
 */
router.get('/fits', async (req, res) => {
  try {
    const query = `
      SELECT 
        f.id,
        f.name,
        f.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM fits f
      LEFT JOIN product_search_materialized psm ON LOWER(psm.fit_slug) = LOWER(f.slug) AND psm.sku_status = 'Live'
      GROUP BY f.id, f.name, f.slug
      ORDER BY product_count DESC, f.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ fits: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch fits:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/fits/:slug/products
 * Returns products matching a specific fit slug
 */
router.get('/fits/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getLowerFilteredProductsWithDetails('fit_slug', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by fit:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// SECTOR ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/sectors
 * Returns all sectors from the database
 */
router.get('/sectors', async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id,
        s.name,
        s.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM sectors s
      LEFT JOIN product_search_materialized psm ON psm.sector_slugs && ARRAY[s.slug] AND psm.sku_status = 'Live'
      GROUP BY s.id, s.name, s.slug
      ORDER BY product_count DESC, s.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ sectors: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch sectors:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/sectors/:slug/products
 * Returns products matching a specific sector slug
 */
router.get('/sectors/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('sector_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by sector:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// SPORT ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/sports
 * Returns all sports from the database
 */
router.get('/sports', async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id,
        s.name,
        s.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM sports s
      LEFT JOIN product_search_materialized psm ON psm.sport_slugs && ARRAY[s.slug] AND psm.sku_status = 'Live'
      GROUP BY s.id, s.name, s.slug
      ORDER BY product_count DESC, s.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ sports: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch sports:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/sports/:slug/products
 * Returns products matching a specific sport slug
 */
router.get('/sports/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('sport_slugs', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by sport:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// EFFECT ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/effects
 * Returns all effects from the database
 */
router.get('/effects', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        unnest(effects_arr) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND effects_arr IS NOT NULL
      GROUP BY unnest(effects_arr)
      ORDER BY product_count DESC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    const effects = result.rows.map((row, idx) => ({
      id: idx + 1,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      slug: row.slug,
      product_count: parseInt(row.product_count)
    }));
    res.json({ effects, total: effects.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch effects:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/effects/:slug/products
 * Returns products matching a specific effect slug
 */
router.get('/effects/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getArrayFilteredProductsWithDetails('effects_arr', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by effect:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// ACCREDITATION ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/accreditations
 * Returns all accreditations from the database
 */
router.get('/accreditations', async (req, res) => {
  try {
    const query = `
      SELECT 
        a.id,
        a.name,
        a.slug,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM accreditations a
      LEFT JOIN product_search_materialized psm ON psm.accreditation_slugs && ARRAY[a.slug] AND psm.sku_status = 'Live'
      GROUP BY a.id, a.name, a.slug
      ORDER BY product_count DESC, a.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ accreditations: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch accreditations:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/accreditations/:slug/products
 * Returns products matching a specific accreditation slug
 */
router.get('/accreditations/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24, sort = 'newest', order = 'desc' } = req.query;
    const result = await getArrayFilteredProductsWithDetails('accreditation_slugs', slug.toLowerCase(), page, limit, sort, order.toUpperCase());
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by accreditation:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// COLOUR SHADE ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/colour-shades
 * Returns all colour shades from the database
 */
router.get('/colour-shades', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        LOWER(colour_shade) as slug,
        colour_shade as name,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND colour_shade IS NOT NULL
      GROUP BY colour_shade
      ORDER BY product_count DESC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    const colourShades = result.rows.map((row, idx) => ({
      id: idx + 1,
      name: row.name,
      slug: row.slug,
      product_count: parseInt(row.product_count)
    }));
    res.json({ colourShades, total: colourShades.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch colour shades:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/colour-shades/:slug/products
 * Returns products matching a specific colour shade slug
 */
router.get('/colour-shades/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getLowerFilteredProductsWithDetails('colour_shade', slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by colour shade:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// BRAND ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/brands
 * Returns all brands from the database
 */
router.get('/brands', async (req, res) => {
  try {
    const query = `
      SELECT 
        b.id,
        b.name,
        LOWER(REPLACE(b.name, ' ', '-')) as slug,
        COUNT(DISTINCT s.style_code) as product_count
      FROM brands b
      LEFT JOIN styles s ON b.id = s.brand_id
      LEFT JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY b.id, b.name
      ORDER BY b.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ brands: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch brands:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/brands/:slug/products
 * Returns products matching a specific brand (by slug or name)
 */
router.get('/brands/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const result = await getBrandFilteredProductsWithDetails(slug.toLowerCase(), page, limit);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by brand:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// PRODUCT TYPE ENDPOINTS
// ============================================================================

/**
 * GET /api/filters/product-types
 * Returns all product types from the database
 */
router.get('/product-types', async (req, res) => {
  try {
    // Use INNER JOIN to only count styles that actually have Live products
    // This matches the materialized view behavior and main API
    const query = `
      SELECT 
        pt.id,
        pt.name,
        COALESCE(pt.slug, LOWER(REPLACE(pt.name, ' ', '-'))) as slug,
        pt.display_order,
        COUNT(DISTINCT psm.style_code) as product_count
      FROM product_types pt
      LEFT JOIN styles s ON pt.id = s.product_type_id
      INNER JOIN product_search_materialized psm ON s.style_code = psm.style_code AND psm.sku_status = 'Live'
      GROUP BY pt.id, pt.name, pt.slug, pt.display_order
      ORDER BY pt.display_order ASC, pt.name ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ productTypes: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch product types:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/product-types/:slug/products
 * Returns products matching a specific product type (by slug or name)
 */
router.get('/product-types/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 24, sort = 'newest', order = 'desc' } = req.query;
    const result = await getProductTypeFilteredProductsWithDetails(slug, page, limit, sort, order.toUpperCase());
    res.json(result);
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by product type:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// PRICE RANGE ENDPOINT
// ============================================================================

/**
 * GET /api/filters/price-range
 * Returns min and max prices across all products (with markup applied)
 */
router.get('/price-range', async (req, res) => {
  try {
    const query = `
      SELECT 
        MIN(sell_price) as min_price,
        MAX(sell_price) as max_price
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND sell_price IS NOT NULL AND sell_price > 0
    `;
    const result = await queryWithTimeout(query, [], 10000);
    const row = result.rows[0];
    // Price range is already in sell_price (marked-up)
    res.json({
      min: parseFloat(row.min_price || 0),
      max: parseFloat(row.max_price || 0)
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch price range:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/price-range/:min/:max/products
 * Returns products within a specific price range
 */
router.get('/price-range/:min/:max/products', async (req, res) => {
  try {
    const { min, max } = req.params;
    const { page = 1, limit = 24 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const styleCodesQuery = `
      SELECT DISTINCT style_code
      FROM product_search_materialized
      WHERE sell_price >= $1 AND sell_price <= $2 AND sku_status = 'Live'
      ORDER BY sell_price ASC, style_code
      LIMIT $3 OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE sell_price >= $1 AND sell_price <= $2 AND sku_status = 'Live'
    `;

    const [styleCodesResult, countResult] = await Promise.all([
      queryWithTimeout(styleCodesQuery, [parseFloat(min), parseFloat(max), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [parseFloat(min), parseFloat(max)], 10000)
    ]);

    const styleCodes = styleCodesResult.rows.map(r => r.style_code);
    const items = await getFullProductDetails(styleCodes);
    const total = parseInt(countResult.rows[0]?.total || 0);

    let minPrice = Infinity, maxPrice = 0;
    items.forEach(item => {
      if (item.price > 0) {
        minPrice = Math.min(minPrice, item.price);
        maxPrice = Math.max(maxPrice, item.price);
      }
    });

    res.json({
      items,
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      priceRange: {
        min: minPrice === Infinity ? 0 : Math.round(minPrice * 100) / 100,
        max: Math.round(maxPrice * 100) / 100
      }
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by price range:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
