const express = require('express');
const router = express.Router();
const { pool, queryWithTimeout } = require('../config/database');
const { buildProductListQuery, buildProductDetailQuery } = require('../services/productService');

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
      category, // Category filter - accepts slugs or IDs
      categories, // Accept both 'category' and 'categories' parameters
      productType, // Product type filter - accepts product type names
      productTypes, // Accept both 'productType' and 'productTypes' parameters
      sort = 'newest',
      order = 'desc'
    } = req.query;

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
      category: parseArray(category || categories), // Accept both 'category' and 'categories', supports slugs or IDs
      productType: parseArray(productType || productTypes), // Accept both 'productType' and 'productTypes', supports product type names
      sort: sort || 'newest', // Ensure default
      order: order ? (order.toLowerCase() === 'asc' ? 'ASC' : 'DESC') : 'DESC' // Ensure default
    };

    // Input validation and sanitization
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 24));
    
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

