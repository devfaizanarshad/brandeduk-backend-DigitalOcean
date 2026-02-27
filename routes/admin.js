const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../config/database');
const { broadcastCacheInvalidation } = require('../services/cacheSync');
const { refreshMaterializedViews } = require('../utils/refreshViews');

function isSafeIdentifier(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_]+$/.test(name);
}

/**
 * GET /api/admin/tables
 * List all user tables in the public schema.
 */
router.get('/tables', async (req, res) => {
  try {
    const sql = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const result = await queryWithTimeout(sql, [], 10000);
    res.json({ tables: result.rows.map(r => r.table_name) });
  } catch (error) {
    console.error('[ADMIN] Failed to list tables:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/products/search
 * Advanced product search for admin panel with all fields
 * Supports filtering by style_code, brand, status, price range, etc.
 */
router.get('/products/search', async (req, res) => {
  try {
    const {
      q,
      style_code,
      supplier,
      brand_id,
      product_type_id,
      sku_status,
      price_min,
      price_max,
      is_best_seller,
      is_recommended,
      limit = 50,
      offset = 0
    } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (q) {
      conditions.push(`(s.style_name ILIKE $${paramIndex} OR s.style_code ILIKE $${paramIndex} OR p.sku_code ILIKE $${paramIndex})`);
      params.push(`%${q}%`);
      paramIndex++;
    }

    if (style_code) {
      conditions.push(`p.style_code = $${paramIndex}`);
      params.push(style_code.toUpperCase());
      paramIndex++;
    }

    if (supplier) {
      // Allow single or repeated query params: supplier=uneek or supplier=uneek&supplier=ralawise
      const suppliers = Array.isArray(supplier) ? supplier : [supplier];
      conditions.push(`sup.slug = ANY($${paramIndex}::text[])`);
      params.push(suppliers.map(s => String(s).toLowerCase().trim()).filter(Boolean));
      paramIndex++;
    }

    if (brand_id) {
      conditions.push(`s.brand_id = $${paramIndex}`);
      params.push(parseInt(brand_id));
      paramIndex++;
    }

    if (product_type_id) {
      conditions.push(`s.product_type_id = $${paramIndex}`);
      params.push(parseInt(product_type_id));
      paramIndex++;
    }

    if (sku_status) {
      conditions.push(`p.sku_status = $${paramIndex}`);
      params.push(sku_status);
      paramIndex++;
    }

    if (price_min) {
      conditions.push(`p.sell_price >= $${paramIndex}`);
      params.push(parseFloat(price_min));
      paramIndex++;
    }

    if (price_max) {
      conditions.push(`p.sell_price <= $${paramIndex}`);
      params.push(parseFloat(price_max));
      paramIndex++;
    }

    if (is_best_seller !== undefined) {
      conditions.push(`s.is_best_seller = $${paramIndex}`);
      params.push(is_best_seller === 'true' || is_best_seller === true);
      paramIndex++;
    }

    if (is_recommended !== undefined) {
      conditions.push(`s.is_recommended = $${paramIndex}`);
      params.push(is_recommended === 'true' || is_recommended === true);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const query = `
      SELECT 
        p.id,
        p.style_code,
        p.sku_code,
        s.style_name,
        sup.slug as supplier,
        b.name as brand_name,
        pt.name as product_type_name,
        p.carton_price,
        p.single_price,
        p.sell_price,
        p.sku_status,
        p.primary_image_url,
        p.colour_name,
        sz.name as size_name,
        p.created_at,
        p.updated_at,
        p.pricing_version,
        p.last_priced_at,
        s.is_best_seller,
        s.is_recommended
      FROM products p
      LEFT JOIN styles s ON p.style_code = s.style_code
      LEFT JOIN suppliers sup ON s.supplier_id = sup.id
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
      LEFT JOIN sizes sz ON p.size_id = sz.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      LEFT JOIN styles s ON p.style_code = s.style_code
      LEFT JOIN suppliers sup ON s.supplier_id = sup.id
      ${whereClause}
    `;

    params.push(limitNum, offsetNum);

    const [result, countResult] = await Promise.all([
      queryWithTimeout(query, params, 20000),
      queryWithTimeout(countQuery, params.slice(0, -2), 10000)
    ]);

    res.json({
      items: result.rows,
      total: parseInt(countResult.rows[0]?.total || 0),
      limit: limitNum,
      offset: offsetNum
    });
  } catch (error) {
    console.error('[ADMIN] Failed to search products:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/products/featured
 * List styles that have featured flags (best seller or recommended) enabled.
 * Returns products grouped by style code.
 */
router.get('/products/featured', async (req, res) => {
  try {
    const { type, product_type_id, limit = 50, offset = 0 } = req.query;

    let conditions = ['(s.is_best_seller = true OR s.is_recommended = true)'];
    const params = [];
    let pIdx = 1;

    if (type === 'best') {
      conditions = ['s.is_best_seller = true'];
    } else if (type === 'recommended') {
      conditions = ['s.is_recommended = true'];
    }

    if (product_type_id) {
      conditions.push(`s.product_type_id = $${pIdx++}`);
      params.push(parseInt(product_type_id, 10));
    }

    const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT 
        s.style_code,
        s.style_name,
        s.is_best_seller,
        s.is_recommended,
        s.best_seller_order,
        s.recommended_order,
        b.name as brand_name,
        pt.name as product_type_name,
        (SELECT p.sell_price FROM products p WHERE p.style_code = s.style_code AND p.sku_status = 'Live' LIMIT 1) as price,
        (SELECT p.primary_image_url FROM products p WHERE p.style_code = s.style_code AND p.sku_status = 'Live' LIMIT 1) as image,
        (SELECT COUNT(*) FROM products p WHERE p.style_code = s.style_code AND p.sku_status = 'Live') as sku_count
      FROM styles s
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
      ${whereClause}
      ORDER BY 
        ${type === 'best' ? 's.best_seller_order ASC' : (type === 'recommended' ? 's.recommended_order ASC' : 's.updated_at DESC')}
      LIMIT $${pIdx++} OFFSET $${pIdx++}
    `;

    const countSql = `SELECT COUNT(*) FROM styles s ${whereClause}`;

    const summarySql = `
      SELECT pt.id, pt.name, COUNT(DISTINCT s.style_code) as count
      FROM styles s
      JOIN product_types pt ON s.product_type_id = pt.id
      WHERE s.is_best_seller = true OR s.is_recommended = true
      GROUP BY pt.id, pt.name
      ORDER BY pt.name ASC
    `;

    const queryParams = [...params, limitNum, offsetNum];
    const [result, countResult, summaryResult] = await Promise.all([
      queryWithTimeout(sql, queryParams, 10000),
      queryWithTimeout(countSql, params, 10000),
      // Summary SQL for categories doesn't need the product_type_id filter 
      // as it provides counts for ALL categories (to populate tabs)
      queryWithTimeout(summarySql, [], 10000)
    ]);

    res.json({
      items: result.rows,
      total: parseInt(countResult.rows[0].count),
      by_product_type: summaryResult.rows.map(r => ({
        id: r.id,
        name: r.name,
        count: parseInt(r.count)
      })),
      limit: limitNum,
      offset: offsetNum
    });
  } catch (error) {
    console.error('[ADMIN] Failed to list featured products:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/products/by-style/:code
 * Get all SKUs (products) for a specific style code (admin view with all fields)
 */
router.get('/products/by-style/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const query = `
      SELECT 
        p.*,
        s.style_name,
        b.name as brand_name,
        pt.name as product_type_name,
        sz.name as size_name,
        c.name as colour_name,
        t.name as tag_name,
        s.is_best_seller,
        s.is_recommended
      FROM products p
      LEFT JOIN styles s ON p.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
      LEFT JOIN sizes sz ON p.size_id = sz.id
      LEFT JOIN colours c ON p.colour_id = c.id
      LEFT JOIN tags t ON p.tag_id = t.id
      WHERE p.style_code = $1
      ORDER BY p.colour_name, sz.size_order
    `;

    const result = await queryWithTimeout(query, [code.toUpperCase()], 15000);

    res.json({
      style_code: code.toUpperCase(),
      items: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[ADMIN] Failed to fetch products by style:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/products/statistics
 * Get product statistics (counts by status, price ranges, etc.)
 */
router.get('/products/statistics', async (req, res) => {
  try {
    const statusQuery = `
      SELECT sku_status, COUNT(*) as count
      FROM products
      GROUP BY sku_status
    `;

    const priceRangeQuery = `
      SELECT 
        CASE
          WHEN sell_price < 10 THEN '0-10'
          WHEN sell_price < 20 THEN '10-20'
          WHEN sell_price < 30 THEN '20-30'
          WHEN sell_price < 50 THEN '30-50'
          WHEN sell_price < 100 THEN '50-100'
          ELSE '100+'
        END as price_range,
        COUNT(*) as count
      FROM products
      WHERE sku_status = 'Live' AND sell_price IS NOT NULL
      GROUP BY price_range
      ORDER BY MIN(sell_price)
    `;

    const [statusResult, priceResult] = await Promise.all([
      queryWithTimeout(statusQuery, [], 10000),
      queryWithTimeout(priceRangeQuery, [], 10000)
    ]);

    res.json({
      byStatus: statusResult.rows,
      byPriceRange: priceResult.rows
    });
  } catch (error) {
    console.error('[ADMIN] Failed to get product statistics:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/products/markup-overrides
 * List all active markup overrides
 */
router.get('/products/markup-overrides', async (req, res) => {
  try {
    const { product_type_id } = req.query;
    let whereClause = '';
    const params = [];

    if (product_type_id) {
      whereClause = 'WHERE s.product_type_id = $1';
      params.push(parseInt(product_type_id, 10));
    }

    const query = `
      SELECT 
        pmo.style_code, 
        s.style_name, 
        pmo.markup_percent as markup, 
        pmo.updated_at,
        (SELECT p.primary_image_url FROM products p WHERE p.style_code = s.style_code AND p.sku_status = 'Live' LIMIT 1) as image
      FROM product_markup_overrides pmo
      LEFT JOIN styles s ON pmo.style_code = s.style_code
      ${whereClause}
      ORDER BY pmo.updated_at DESC
    `;

    const summarySql = `
      SELECT pt.id, pt.name, COUNT(DISTINCT pmo.style_code) as count
      FROM product_markup_overrides pmo
      JOIN styles s ON pmo.style_code = s.style_code
      JOIN product_types pt ON s.product_type_id = pt.id
      GROUP BY pt.id, pt.name
      ORDER BY pt.name ASC
    `;

    const [result, summaryResult] = await Promise.all([
      queryWithTimeout(query, params, 10000),
      queryWithTimeout(summarySql, [], 10000)
    ]);

    res.json({
      items: result.rows.map(row => ({
        style_code: row.style_code,
        style_name: row.style_name || 'Unknown Style',
        image: row.image || '',
        percentage: parseFloat(row.markup),
        updated_at: row.updated_at
      })),
      by_product_type: summaryResult.rows.map(r => ({
        id: r.id,
        name: r.name,
        count: parseInt(r.count)
      })),
      count: result.rows.length
    });
  } catch (error) {
    console.error('[ADMIN] Failed to list markup overrides:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/products/price-overrides
 * List all active price break overrides (grouped by style)
 */
router.get('/products/price-overrides', async (req, res) => {
  try {
    const { product_type_id } = req.query;
    let whereClause = '';
    const params = [];

    if (product_type_id) {
      whereClause = 'WHERE s.product_type_id = $1';
      params.push(parseInt(product_type_id, 10));
    }

    const query = `
      SELECT 
        ppo.style_code,
        s.style_name,
        ppo.min_qty as min,
        ppo.max_qty as max,
        ppo.discount_percent as percentage,
        ppo.updated_at,
        (SELECT p.primary_image_url FROM products p WHERE p.style_code = s.style_code AND p.sku_status = 'Live' LIMIT 1) as image
      FROM product_price_overrides ppo
      LEFT JOIN styles s ON ppo.style_code = s.style_code
      ${whereClause}
      ORDER BY ppo.style_code ASC, ppo.min_qty ASC
    `;

    const summarySql = `
      SELECT pt.id, pt.name, COUNT(DISTINCT ppo.style_code) as count
      FROM product_price_overrides ppo
      JOIN styles s ON ppo.style_code = s.style_code
      JOIN product_types pt ON s.product_type_id = pt.id
      GROUP BY pt.id, pt.name
      ORDER BY pt.name ASC
    `;

    const [result, summaryResult] = await Promise.all([
      queryWithTimeout(query, params, 10000),
      queryWithTimeout(summarySql, [], 10000)
    ]);

    res.json({
      items: result.rows.map(row => ({
        style_code: row.style_code,
        style_name: row.style_name || 'Unknown Style',
        image: row.image || '',
        min: parseInt(row.min),
        max: parseInt(row.max),
        percentage: parseFloat(row.percentage),
        updated_at: row.updated_at
      })),
      by_product_type: summaryResult.rows.map(r => ({
        id: r.id,
        name: r.name,
        count: parseInt(r.count)
      })),
      count: result.rows.length
    });
  } catch (error) {
    console.error('[ADMIN] Failed to list price overrides:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * POST /api/admin/products/bulk-markup-overrides/delete
 * Delete multiple markup overrides at once
 */
router.post('/products/bulk-markup-overrides/delete', async (req, res) => {
  try {
    const { style_codes } = req.body;
    if (!style_codes || !Array.isArray(style_codes) || style_codes.length === 0) {
      return res.status(400).json({ error: 'Invalid style_codes' });
    }

    const query = 'DELETE FROM product_markup_overrides WHERE style_code = ANY($1)';
    await queryWithTimeout(query, [style_codes], 10000);

    res.json({ success: true, message: `${style_codes.length} markup overrides removed` });
  } catch (error) {
    console.error('[ADMIN] Failed to bulk delete markup overrides:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * POST /api/admin/products/bulk-price-overrides/delete
 * Delete multiple price overrides at once
 */
router.post('/products/bulk-price-overrides/delete', async (req, res) => {
  try {
    const { style_codes } = req.body;
    if (!style_codes || !Array.isArray(style_codes) || style_codes.length === 0) {
      return res.status(400).json({ error: 'Invalid style_codes' });
    }

    const query = 'DELETE FROM product_price_overrides WHERE style_code = ANY($1)';
    await queryWithTimeout(query, [style_codes], 10000);

    res.json({ success: true, message: `Price overrides for ${style_codes.length} products removed` });
  } catch (error) {
    console.error('[ADMIN] Failed to bulk delete price overrides:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/bulk-status
 * Bulk update product status (activate/deactivate multiple products)
 * Body: { product_ids: [1, 2, 3], sku_status: "Live" }
 */
router.put('/products/bulk-status', async (req, res) => {
  try {
    const { product_ids, sku_status } = req.body;

    if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'product_ids array is required and must not be empty'
      });
    }

    if (!sku_status || !['Live', 'Discontinued', 'Archived'].includes(sku_status)) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'sku_status must be one of: Live, Discontinued, Archived'
      });
    }

    const query = `
      UPDATE products
      SET sku_status = $1, updated_at = NOW()
      WHERE id = ANY($2::int[])
      RETURNING id, style_code, sku_code, sku_status
    `;

    const result = await queryWithTimeout(query, [sku_status, product_ids], 30000);

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: `Updated ${result.rows.length} products`,
      updatedCount: result.rows.length,
      items: result.rows
    });
  } catch (error) {
    console.error('[ADMIN] Failed to bulk update status:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/:code/discontinue
 * Set sku_status = 'Discontinued' for ALL variants (colors, sizes) of a style_code.
 * Products with this style_code will no longer appear in listings.
 */
router.put('/products/:code/discontinue', async (req, res) => {
  try {
    const { code } = req.params;
    const styleCode = code.toUpperCase();

    const query = `
      UPDATE products
      SET sku_status = 'Discontinued', updated_at = NOW()
      WHERE style_code = $1
      RETURNING id, style_code, sku_code, sku_status
    `;

    const result = await queryWithTimeout(query, [styleCode], 30000);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No products found for style_code: ${styleCode}`
      });
    }

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: `Discontinued ${result.rows.length} product(s)`,
      style_code: styleCode,
      updatedCount: result.rows.length,
      items: result.rows
    });
  } catch (error) {
    console.error('[ADMIN] Failed to discontinue product:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/:code/activate
 * Set sku_status = 'Live' for ALL variants (colors, sizes) of a style_code.
 * Reverses a discontinue action.
 */
router.put('/products/:code/activate', async (req, res) => {
  try {
    const { code } = req.params;
    const styleCode = code.toUpperCase();

    const query = `
      UPDATE products
      SET sku_status = 'Live', updated_at = NOW()
      WHERE style_code = $1
      RETURNING id, style_code, sku_code, sku_status
    `;

    const result = await queryWithTimeout(query, [styleCode], 30000);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No products found for style_code: ${styleCode}`
      });
    }

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: `Activated ${result.rows.length} product(s)`,
      style_code: styleCode,
      updatedCount: result.rows.length,
      items: result.rows
    });
  } catch (error) {
    console.error('[ADMIN] Failed to activate product:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/bulk-activate
 * Bulk activate multiple products by style_codes
 * Body: { style_codes: ["GD067", "AD082"] }
 */
router.put('/products/bulk-activate', async (req, res) => {
  try {
    const { style_codes } = req.body;

    if (!style_codes || !Array.isArray(style_codes) || style_codes.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'style_codes array is required and must not be empty'
      });
    }

    const normalizedCodes = style_codes.map(c => c.toUpperCase());

    const query = `
      UPDATE products
      SET sku_status = 'Live', updated_at = NOW()
      WHERE style_code = ANY($1::text[])
      RETURNING id, style_code, sku_code, sku_status
    `;

    const result = await queryWithTimeout(query, [normalizedCodes], 30000);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No products found for the given style_codes'
      });
    }

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    // Group by style_code for summary
    const byStyle = {};
    result.rows.forEach(r => {
      if (!byStyle[r.style_code]) byStyle[r.style_code] = 0;
      byStyle[r.style_code]++;
    });

    res.json({
      message: `Activated ${result.rows.length} product(s) across ${Object.keys(byStyle).length} style(s)`,
      updatedCount: result.rows.length,
      stylesUpdated: Object.keys(byStyle).length,
      summary: byStyle
    });
  } catch (error) {
    console.error('[ADMIN] Failed to bulk activate products:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/bulk-discontinue
 * Bulk discontinue multiple products by style_codes
 * Body: { style_codes: ["GD067", "AD082"] }
 */
router.put('/products/bulk-discontinue', async (req, res) => {
  try {
    const { style_codes } = req.body;

    if (!style_codes || !Array.isArray(style_codes) || style_codes.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'style_codes array is required and must not be empty'
      });
    }

    const normalizedCodes = style_codes.map(c => c.toUpperCase());

    const query = `
      UPDATE products
      SET sku_status = 'Discontinued', updated_at = NOW()
      WHERE style_code = ANY($1::text[])
      RETURNING id, style_code, sku_code, sku_status
    `;

    const result = await queryWithTimeout(query, [normalizedCodes], 30000);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No products found for the given style_codes'
      });
    }

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    // Group by style_code for summary
    const byStyle = {};
    result.rows.forEach(r => {
      if (!byStyle[r.style_code]) byStyle[r.style_code] = 0;
      byStyle[r.style_code]++;
    });

    res.json({
      message: `Discontinued ${result.rows.length} product(s) across ${Object.keys(byStyle).length} style(s)`,
      updatedCount: result.rows.length,
      stylesUpdated: Object.keys(byStyle).length,
      summary: byStyle
    });
  } catch (error) {
    console.error('[ADMIN] Failed to bulk discontinue products:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ============================================================================
// PRICE BREAKS MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/price-breaks
 * List all global price break tiers
 */
router.get('/price-breaks', async (req, res) => {
  try {
    const query = `
      SELECT id, min_qty, max_qty, discount_percent, tier_name, created_at, updated_at
      FROM price_breaks
      ORDER BY min_qty ASC
    `;
    const result = await queryWithTimeout(query, [], 10000);

    res.json({
      tiers: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[ADMIN] Failed to fetch price breaks:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/price-breaks/:id
 * Update a global price break tier
 * Body: { discount_percent: 18.00 }
 */
router.put('/price-breaks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { discount_percent } = req.body;
    const numericId = parseInt(id, 10);

    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid id' });
    }

    if (discount_percent === undefined || discount_percent === null) {
      return res.status(400).json({ error: 'Bad request', message: 'discount_percent is required' });
    }

    const parsedDiscount = parseFloat(discount_percent);
    if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > 100) {
      return res.status(400).json({ error: 'Bad request', message: 'discount_percent must be between 0 and 100' });
    }

    const query = `
      UPDATE price_breaks
      SET discount_percent = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await queryWithTimeout(query, [parsedDiscount, numericId], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Price break tier not found' });
    }

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: 'Price break tier updated',
      tier: result.rows[0]
    });
  } catch (error) {
    console.error('[ADMIN] Failed to update price break:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/price-breaks
 * Get global system-wide price breaks
 */
router.get('/price-breaks', async (req, res) => {
  try {
    const query = 'SELECT min_qty, max_qty, discount_percent FROM price_breaks ORDER BY min_qty';
    const result = await queryWithTimeout(query, [], 10000);
    res.json({ items: result.rows });
  } catch (error) {
    console.error('[ADMIN] Failed to fetch global price breaks:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/price-breaks
 * Update global system-wide price breaks (Full Replace)
 */
router.put('/price-breaks', async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { tiers } = req.body;
    if (!tiers || !Array.isArray(tiers)) {
      return res.status(400).json({ error: 'Bad request', message: 'tiers array is required' });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM price_breaks');

    const results = [];
    for (const tier of tiers) {
      const { min_qty, max_qty, discount_percent } = tier;
      const query = `
        INSERT INTO price_breaks (min_qty, max_qty, discount_percent)
        VALUES ($1, $2, $3)
        RETURNING *
      `;
      const result = await client.query(query, [parseInt(min_qty), parseInt(max_qty), parseFloat(discount_percent)]);
      results.push(result.rows[0]);
    }

    await client.query('COMMIT');
    await broadcastCacheInvalidation({ refreshViews: false, reason: 'global_price_breaks_update' });

    res.json({
      message: 'Global price breaks updated successfully',
      items: results
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('[ADMIN] Failed to update global price breaks:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/admin/products/:code/price-overrides
 * Get price overrides for a specific product
 */
router.get('/products/:code/price-overrides', async (req, res) => {
  try {
    const { code } = req.params;
    const styleCode = code.toUpperCase();

    // 🚀 ENHANCED: Get custom tiers FIRST, and global tiers separately
    // This allows the UI to show precisely what is custom vs global
    const [customResult, globalResult] = await Promise.all([
      queryWithTimeout('SELECT id, min_qty, max_qty, discount_percent FROM product_price_overrides WHERE style_code = $1 ORDER BY min_qty', [styleCode], 10000),
      queryWithTimeout('SELECT min_qty, max_qty, discount_percent, tier_name FROM price_breaks ORDER BY min_qty', [], 10000)
    ]);

    const hasOverrides = customResult.rows.length > 0;

    res.json({
      style_code: styleCode,
      has_overrides: hasOverrides,
      // Custom overrides (if any)
      overrides: customResult.rows.map(row => ({
        id: row.id,
        min_qty: parseInt(row.min_qty),
        max_qty: parseInt(row.max_qty),
        discount_percent: parseFloat(row.discount_percent)
      })),
      // Global tiers (for reference)
      global_tiers: globalResult.rows.map(row => ({
        min_qty: row.min_qty,
        max_qty: row.max_qty,
        tier_name: row.tier_name,
        discount_percent: parseFloat(row.discount_percent)
      })),
      // For backward compatibility with existing UI if it expects 'tiers'
      tiers: hasOverrides
        ? customResult.rows.map(row => ({
          min_qty: row.min_qty,
          max_qty: row.max_qty,
          effective_discount: parseFloat(row.discount_percent),
          has_override: true,
          override_id: row.id
        }))
        : globalResult.rows.map(row => ({
          min_qty: row.min_qty,
          max_qty: row.max_qty,
          tier_name: row.tier_name,
          effective_discount: parseFloat(row.discount_percent),
          global_discount: parseFloat(row.discount_percent),
          has_override: false
        }))
    });
  } catch (error) {
    console.error('[ADMIN] Failed to fetch product price overrides:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/:code/price-overrides
 * Set price overrides for a specific product
 * Body: { overrides: [{ min_qty: 50, max_qty: 99, discount_percent: 20 }] }
 */
router.put('/products/:code/price-overrides', async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { code } = req.params;
    const { overrides, replaceAll = true } = req.body;
    const styleCode = code.toUpperCase();

    if (!overrides || !Array.isArray(overrides)) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'overrides array is required'
      });
    }

    await client.query('BEGIN');

    // 🚀 NEW: Ability to replace the entire set (allows removing tiers)
    if (replaceAll) {
      await client.query('DELETE FROM product_price_overrides WHERE style_code = $1', [styleCode]);
    }

    const results = [];
    for (const override of overrides) {
      const { min_qty, max_qty, discount_percent } = override;

      // Basic validation
      if (min_qty == null || max_qty == null || discount_percent == null) continue;

      const parsedMin = parseInt(min_qty);
      const parsedMax = parseInt(max_qty);
      const parsedDiscount = parseFloat(discount_percent);

      if (isNaN(parsedMin) || isNaN(parsedMax) || isNaN(parsedDiscount)) continue;

      const query = `
        INSERT INTO product_price_overrides (style_code, min_qty, max_qty, discount_percent)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (style_code, min_qty, max_qty) DO UPDATE 
        SET discount_percent = EXCLUDED.discount_percent, updated_at = NOW()
        RETURNING *
      `;

      const result = await client.query(query, [styleCode, parsedMin, parsedMax, parsedDiscount]);
      if (result.rows.length > 0) {
        results.push(result.rows[0]);
      }
    }

    await client.query('COMMIT');

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: replaceAll
        ? `Replaced all price overrides with ${results.length} new tier(s) for ${styleCode}`
        : `Updated/Added ${results.length} price override(s) for ${styleCode}`,
      style_code: styleCode,
      overrides: results
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('[ADMIN] Failed to set product price overrides:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/admin/products/:code/price-overrides
 * Remove all price overrides for a specific product
 */
router.delete('/products/:code/price-overrides', async (req, res) => {
  try {
    const { code } = req.params;
    const { min_qty, max_qty } = req.query;
    const styleCode = code.toUpperCase();

    let query;
    let params;

    if (min_qty !== undefined && max_qty !== undefined) {
      // Delete specific tier
      query = `
        DELETE FROM product_price_overrides
        WHERE style_code = $1 AND min_qty = $2 AND max_qty = $3
        RETURNING *
      `;
      params = [styleCode, parseInt(min_qty), parseInt(max_qty)];
    } else {
      // Delete all overrides for this style
      query = `
        DELETE FROM product_price_overrides
        WHERE style_code = $1
        RETURNING *
      `;
      params = [styleCode];
    }

    const result = await queryWithTimeout(query, params, 10000);

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: result.rows.length > 0
        ? `Removed ${result.rows.length} price override(s) for ${styleCode}`
        : `No matching overrides found for ${styleCode}`,
      style_code: styleCode,
      deletedCount: result.rows.length,
      deletedItems: result.rows
    });
  } catch (error) {
    console.error('[ADMIN] Failed to delete product price overrides:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/products/:code/markup-override
 * Get markup override for a specific style code
 */
router.get('/products/:code/markup-override', async (req, res) => {
  try {
    const { code } = req.params;
    const styleCode = code.toUpperCase();

    const query = `
      SELECT pmo.markup_percent,
             (SELECT MIN(markup_percent) FROM pricing_rules WHERE active = true AND 
              COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) BETWEEN from_price AND to_price) as global_markup
      FROM products p
      LEFT JOIN product_markup_overrides pmo ON pmo.style_code = p.style_code
      WHERE p.style_code = $1
      LIMIT 1
    `;

    const result = await queryWithTimeout(query, [styleCode], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Style not found' });
    }

    res.json({
      style_code: styleCode,
      markup_percent: result.rows[0].markup_percent ? parseFloat(result.rows[0].markup_percent) : null,
      global_markup: result.rows[0].global_markup ? parseFloat(result.rows[0].global_markup) : null,
      has_override: !!result.rows[0].markup_percent
    });
  } catch (error) {
    console.error('[ADMIN] Failed to fetch markup override:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/:code/markup-override
 * Set/update markup override for a specific style code
 * Body: { markup_percent: 75.00 }
 */
router.put('/products/:code/markup-override', async (req, res) => {
  try {
    const { code } = req.params;
    const { markup_percent } = req.body;
    const styleCode = code.toUpperCase();

    if (markup_percent === undefined || markup_percent === null) {
      return res.status(400).json({ error: 'Bad request', message: 'markup_percent is required' });
    }

    const parsedMarkup = parseFloat(markup_percent);
    if (!Number.isFinite(parsedMarkup) || parsedMarkup < 0) {
      return res.status(400).json({ error: 'Bad request', message: 'markup_percent must be a positive number' });
    }

    const query = `
      INSERT INTO product_markup_overrides (style_code, markup_percent, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (style_code) DO UPDATE
      SET markup_percent = EXCLUDED.markup_percent, updated_at = NOW()
      RETURNING *
    `;

    const result = await queryWithTimeout(query, [styleCode, parsedMarkup], 10000);

    // Trigger sell_price recalculation for this style
    const repriceQuery = `
      UPDATE products p
      SET 
        sell_price = ROUND(
          (COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
          * (1 + ($1::numeric / 100)))::numeric, 2
        ),
        pricing_version = 'OVERRIDE',
        last_priced_at = NOW()
      WHERE p.style_code = $2 AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) IS NOT NULL
    `;
    await queryWithTimeout(repriceQuery, [parsedMarkup, styleCode], 30000);
    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });
    res.json({
      message: 'Markup override applied and prices recalculated',
      style_code: styleCode,
      markup_percent: parsedMarkup
    });
  } catch (error) {
    console.error('[ADMIN] Failed to set markup override:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * DELETE /api/admin/products/:code/markup-override
 * Remove markup override for a specific style code
 */
router.delete('/products/:code/markup-override', async (req, res) => {
  try {
    const { code } = req.params;
    const styleCode = code.toUpperCase();

    const query = `DELETE FROM product_markup_overrides WHERE style_code = $1 RETURNING *`;
    const result = await queryWithTimeout(query, [styleCode], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'No markup override found for this style' });
    }

    // Trigger sell_price recalculation for this style to revert to global rules
    const repriceQuery = `
      UPDATE products p
      SET 
        sell_price = ROUND(
          COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
          * (1 + (
              SELECT markup_percent / 100
              FROM pricing_rules r
              WHERE r.active = true
                AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
                    BETWEEN r.from_price AND r.to_price
              ORDER BY r.from_price
              LIMIT 1
          )), 2
        ),
        pricing_version = (
          SELECT version FROM pricing_rules r WHERE r.active = true ORDER BY version DESC LIMIT 1
        ),
        last_priced_at = NOW()
      WHERE p.style_code = $1 AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) IS NOT NULL
    `;
    await queryWithTimeout(repriceQuery, [styleCode], 30000);
    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });
    res.json({
      message: 'Markup override removed and prices reverted to global rules',
      style_code: styleCode
    });
  } catch (error) {
    console.error('[ADMIN] Failed to remove markup override:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/bulk-markup-override
 * Bulk update markup overrides for multiple style codes
 * Body: { overrides: [{ style_code: "GD067", markup_percent: 75.00 }, ...] }
 */
router.put('/products/bulk-markup-override', async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { overrides } = req.body;

    if (!overrides || !Array.isArray(overrides) || overrides.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'overrides array is required and must not be empty'
      });
    }

    await client.query('BEGIN');

    const results = [];
    for (const item of overrides) {
      const { style_code, markup_percent } = item;
      if (!style_code || markup_percent == null) continue;

      const styleCode = style_code.toUpperCase();
      const parsedMarkup = parseFloat(markup_percent);

      if (Number.isFinite(parsedMarkup) && parsedMarkup >= 0) {
        // 1. Upsert override
        await client.query(`
          INSERT INTO product_markup_overrides (style_code, markup_percent, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (style_code) DO UPDATE
          SET markup_percent = EXCLUDED.markup_percent, updated_at = NOW()
        `, [styleCode, parsedMarkup]);

        // 2. Reprice products for this style
        const repriceResult = await client.query(`
          UPDATE products p
          SET 
            sell_price = ROUND(
              (COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
              * (1 + ($1::numeric / 100)))::numeric, 2
            ),
            pricing_version = 'OVERRIDE',
            last_priced_at = NOW()
          WHERE p.style_code = $2 AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) IS NOT NULL
        `, [parsedMarkup, styleCode]);

        results.push({
          style_code: styleCode,
          markup_percent: parsedMarkup,
          updated_count: repriceResult.rowCount || 0
        });
      }
    }

    await client.query('COMMIT');

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_bulk_update' });

    res.json({
      message: `Bulk markup overrides applied to ${results.length} styles`,
      results
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('[ADMIN] Failed to bulk update markup overrides:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/admin/products/bulk-featured
 * Bulk update featured flags (is_best_seller, is_recommended) for multiple styles
 * Body: { style_codes: ["GD001", "GD002"], is_best_seller?: boolean, is_recommended?: boolean }
 */
router.put('/products/bulk-featured', async (req, res) => {
  try {
    const { style_codes, is_best_seller, is_recommended } = req.body;

    if (!style_codes || !Array.isArray(style_codes) || style_codes.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'style_codes array is required and must not be empty'
      });
    }

    if (is_best_seller === undefined && is_recommended === undefined) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'At least one flag (is_best_seller or is_recommended) must be provided'
      });
    }

    const updates = [];
    const params = [];
    let idx = 1;

    if (is_best_seller !== undefined) {
      const isBestValue = is_best_seller === true || is_best_seller === 'true';
      updates.push(`is_best_seller = $${idx++}`);
      params.push(isBestValue);
      // Reset order to default when removing from best sellers
      if (!isBestValue) {
        updates.push(`best_seller_order = 999999`);
      }
    }
    if (is_recommended !== undefined) {
      const isRecValue = is_recommended === true || is_recommended === 'true';
      updates.push(`is_recommended = $${idx++}`);
      params.push(isRecValue);
      // Reset order to default when removing from recommended
      if (!isRecValue) {
        updates.push(`recommended_order = 999999`);
      }
    }

    params.push(style_codes.map(c => c.toUpperCase()));
    const styleCodesIdx = idx;

    const sql = `
      UPDATE styles 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE style_code = ANY($${styleCodesIdx})
      RETURNING style_code
    `;

    const result = await queryWithTimeout(sql, params, 15000);

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_bulk_featured' });

    res.json({
      message: `Bulk featured flags updated for ${result.rowCount} styles`,
      updated_styles: result.rows.map(r => r.style_code)
    });
  } catch (error) {
    console.error('[ADMIN] Failed to bulk update featured flags:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/order-featured
 * Bulk update ordering for best seller and/or recommended products
 * Body: { orders: [{ style_code: "GD001", best_seller_order?: 1, recommended_order?: 2 }, ...] }
 */
router.put('/products/order-featured', async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { orders } = req.body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'orders array is required and must not be empty'
      });
    }

    await client.query('BEGIN');

    const results = [];
    for (const item of orders) {
      const { style_code, best_seller_order, recommended_order } = item;
      if (!style_code) continue;

      const styleCode = style_code.toUpperCase();
      const updates = [];
      const params = [styleCode];
      let pIdx = 2;

      if (best_seller_order !== undefined) {
        const val = parseInt(best_seller_order, 10);
        updates.push(`best_seller_order = $${pIdx++}`);
        params.push(val);
        // Automatically sync the boolean flag: if order is 999999, it's not a best seller anymore
        updates.push(`is_best_seller = ${val < 999999}`);
      }
      if (recommended_order !== undefined) {
        const val = parseInt(recommended_order, 10);
        updates.push(`recommended_order = $${pIdx++}`);
        params.push(val);
        // Automatically sync the boolean flag: if order is 999999, it's not recommended anymore
        updates.push(`is_recommended = ${val < 999999}`);
      }

      if (updates.length > 0) {
        await client.query(`
          UPDATE styles 
          SET ${updates.join(', ')}, updated_at = NOW()
          WHERE style_code = $1
        `, params);
        results.push(styleCode);
      }
    }

    await client.query('COMMIT');

    // Invalidate cache but don't refresh views immediately (too slow for UX)
    // The new order will reflect in about 1-10 mins when manual sync is run
    // or if we use the materialized view concurrently.
    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_order_featured' });

    res.json({
      success: true,
      message: `Orders updated for ${results.length} styles`,
      updated_styles: results
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('[ADMIN] Failed to update featured products order:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/admin/products/bulk-carton-price
 * Bulk update carton_price for multiple style codes
 * Body: { updates: [{ style_code: "GD002", carton_price: 4.65 }, ...] }
 */
router.put('/products/bulk-carton-price', async (req, res) => {
  try {
    const { updates } = req.body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'updates array is required and must not be empty'
      });
    }

    const client = await require('../config/database').pool.connect();
    const results = [];

    try {
      await client.query('BEGIN');

      for (const update of updates) {
        const { style_code, carton_price } = update;

        if (!style_code || carton_price == null) {
          continue;
        }

        const parsedCarton = parseFloat(carton_price);
        if (!Number.isFinite(parsedCarton) || parsedCarton < 0) {
          continue;
        }

        const updateSql = `
          UPDATE products p
          SET
            carton_price = $1::numeric,
            sell_price = ROUND(
              (COALESCE(NULLIF($1::numeric, 0), NULLIF(p.single_price, 0))
              * (1 + (
                  SELECT markup_percent / 100
                  FROM pricing_rules r
                  WHERE r.active = true
                    AND COALESCE(NULLIF($1::numeric, 0), NULLIF(p.single_price, 0))
                        BETWEEN r.from_price AND r.to_price
                  ORDER BY r.from_price
                  LIMIT 1
              )))::numeric, 2
            ),
            pricing_version = (
              SELECT version
              FROM pricing_rules r
              WHERE r.active = true
              ORDER BY version DESC, from_price ASC
              LIMIT 1
            ),
            last_priced_at = NOW()
          WHERE style_code = $2
            AND sku_status = 'Live'
          RETURNING style_code, COUNT(*) as updated_count
        `;

        const result = await client.query(updateSql, [parsedCarton, style_code.toUpperCase()]);
        if (result.rows.length > 0) {
          results.push({
            style_code: style_code.toUpperCase(),
            carton_price: parsedCarton,
            updated_count: parseInt(result.rows[0].updated_count)
          });
        }
      }

      await client.query('COMMIT');

      // View refresh is now handled via manual /pricing/sync endpoint to prevent DB blocking
      console.log('[ADMIN] Pricing updated in DB. Manual sync required to reflect on public site.');

      await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

      res.json({
        message: `Updated ${results.length} style codes`,
        updatedCount: results.length,
        items: results
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[ADMIN] Failed to bulk update carton prices:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/:code
 * Update product detail for a style_code.
 * Body: { style_name?, specification?, fabric_description?, primary_image_url?, colorImages?: [{ colour_name, url }] }
 */
router.put('/products/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const styleCode = code.toUpperCase();
    const {
      style_name,
      specification,
      fabric_description,
      primary_image_url,
      colorImages,
      is_best_seller,
      is_recommended,
      best_seller_order,
      recommended_order
    } = req.body;

    // Check style exists
    const styleCheck = await queryWithTimeout(
      'SELECT style_code FROM styles WHERE style_code = $1',
      [styleCode],
      5000
    );
    if (styleCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `Product with style_code ${styleCode} not found`
      });
    }

    const updates = [];

    // Update styles table
    if (
      style_name !== undefined ||
      specification !== undefined ||
      fabric_description !== undefined ||
      is_best_seller !== undefined ||
      is_recommended !== undefined ||
      best_seller_order !== undefined ||
      recommended_order !== undefined
    ) {
      const styleFields = [];
      const styleParams = [];
      let idx = 1;
      if (style_name !== undefined) {
        styleFields.push(`style_name = $${idx++}`);
        styleParams.push(style_name);
      }
      if (specification !== undefined) {
        styleFields.push(`specification = $${idx++}`);
        styleParams.push(specification);
      }
      if (fabric_description !== undefined) {
        styleFields.push(`fabric_description = $${idx++}`);
        styleParams.push(fabric_description);
      }
      if (best_seller_order !== undefined) {
        const val = parseInt(best_seller_order, 10);
        styleFields.push(`best_seller_order = $${idx++}`);
        styleParams.push(val);
        // Sync flag if not explicitly provided: setting an order number enables the flag, setting 999999 disables it
        if (is_best_seller === undefined) {
          styleFields.push(`is_best_seller = ${val < 999999}`);
        }
      }
      if (recommended_order !== undefined) {
        const val = parseInt(recommended_order, 10);
        styleFields.push(`recommended_order = $${idx++}`);
        styleParams.push(val);
        // Sync flag if not explicitly provided
        if (is_recommended === undefined) {
          styleFields.push(`is_recommended = ${val < 999999}`);
        }
      }

      if (is_best_seller !== undefined) {
        const isBestValue = is_best_seller === true || is_best_seller === 'true';
        styleFields.push(`is_best_seller = $${idx++}`);
        styleParams.push(isBestValue);
        // Reset order if unsetting best seller and no specific order provided in request
        if (!isBestValue && best_seller_order === undefined) {
          styleFields.push(`best_seller_order = 999999`);
        }
      }
      if (is_recommended !== undefined) {
        const isRecValue = is_recommended === true || is_recommended === 'true';
        styleFields.push(`is_recommended = $${idx++}`);
        styleParams.push(isRecValue);
        // Reset order if unsetting recommended and no specific order provided in request
        if (!isRecValue && recommended_order === undefined) {
          styleFields.push(`recommended_order = 999999`);
        }
      }
      styleFields.push('updated_at = NOW()');
      styleParams.push(styleCode);

      await queryWithTimeout(
        `UPDATE styles SET ${styleFields.join(', ')} WHERE style_code = $${idx}`,
        styleParams,
        10000
      );
      updates.push('styles');
    }

    // Update primary_image_url for all products with this style_code
    if (primary_image_url !== undefined) {
      const imgResult = await queryWithTimeout(
        `UPDATE products SET primary_image_url = $1, updated_at = NOW() WHERE style_code = $2 RETURNING id`,
        [primary_image_url, styleCode],
        10000
      );
      if (imgResult.rows.length > 0) updates.push(`primary_image (${imgResult.rows.length} products)`);
    }

    // Update colour-specific images
    if (colorImages && Array.isArray(colorImages) && colorImages.length > 0) {
      for (const { colour_name, url } of colorImages) {
        if (!colour_name || !url) continue;
        const colorResult = await queryWithTimeout(
          `UPDATE products SET colour_image_url = $1, updated_at = NOW() WHERE style_code = $2 AND (colour_name = $3 OR primary_colour = $3) RETURNING id`,
          [url, styleCode, colour_name],
          10000
        );
        if (colorResult.rows.length > 0) updates.push(`colour_image (${colour_name})`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'At least one field must be provided: style_name, specification, fabric_description, primary_image_url, or colorImages'
      });
    }

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: 'Product updated successfully',
      style_code: styleCode,
      updated: updates
    });
  } catch (error) {
    console.error('[ADMIN] Failed to update product:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});


/**
 * POST /api/admin/pricing/sync
 * Manually trigger materialized view refresh to sync changes to public site
 * Body: { wait: boolean } - if true, waits for refresh to complete before responding
 */
router.post('/pricing/sync', async (req, res) => {
  try {
    const { wait = false } = req.body;
    console.log(`[ADMIN] Manual pricing sync requested (mode: ${wait ? 'blocking' : 'background'})`);

    if (wait) {
      // Set extended timeouts for this specific request
      req.setTimeout(600000);
      res.setTimeout(600000);

      // 🚀 BLOCKING MODE: Wait for refresh to complete
      const startTime = Date.now();
      console.log('[ADMIN] Starting blocking sync process...');

      // 1. Trigger cache invalidation (immediate)
      await broadcastCacheInvalidation({ refreshViews: false, reason: 'manual_sync_start' });

      // 2. Perform the actual view refresh (can take time)
      console.log('[ADMIN] Refreshing materialized views...');
      const refreshResult = await refreshMaterializedViews();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`[ADMIN] Refresh completed in ${duration}s. Success: ${refreshResult.success}`);

      if (refreshResult.success) {
        // 3. Clear caches again after successful refresh
        await broadcastCacheInvalidation({ refreshViews: false, reason: 'manual_sync_complete' });

        return res.json({
          success: true,
          message: `Synchronization complete! Public site is now up to date.`,
          duration: `${duration}s`,
          details: 'Materialized views and caches refreshed successfully.'
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Synchronization failed',
          message: refreshResult.error,
          duration: `${duration}s`
        });
      }
    } else {
      // 🚀 BACKGROUND MODE: Default behavior
      broadcastCacheInvalidation({ refreshViews: true, reason: 'manual_sync' });

      res.json({
        success: true,
        message: 'Sync process started in the background. Public site will update shortly.',
        estimated_time: '2-5 minutes'
      });
    }
  } catch (error) {
    console.error('[ADMIN] Failed to trigger sync:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * DELETE /api/admin/products/bulk
 * Bulk delete products by IDs
 * Body: { product_ids: [1, 2, 3] }
 */
router.delete('/products/bulk', async (req, res) => {
  try {
    const { product_ids } = req.body;

    if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'product_ids array is required and must not be empty'
      });
    }

    const query = `
      DELETE FROM products
      WHERE id = ANY($1::int[])
      RETURNING id, style_code, sku_code
    `;

    const result = await queryWithTimeout(query, [product_ids], 30000);

    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: `Deleted ${result.rows.length} products`,
      deletedCount: result.rows.length,
      items: result.rows
    });
  } catch (error) {
    console.error('[ADMIN] Failed to bulk delete products:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/statistics/dashboard
 * Get dashboard statistics for admin panel
 */
router.get('/statistics/dashboard', async (req, res) => {
  try {
    const queries = {
      totalProducts: 'SELECT COUNT(*) as count FROM products',
      liveProducts: 'SELECT COUNT(*) as count FROM products WHERE sku_status = \'Live\'',
      totalStyles: 'SELECT COUNT(DISTINCT style_code) as count FROM products WHERE sku_status = \'Live\'',
      totalBrands: 'SELECT COUNT(DISTINCT brand_id) as count FROM styles WHERE brand_id IS NOT NULL',
      activePricingRules: 'SELECT COUNT(*) as count FROM pricing_rules WHERE active = true',
      recentProducts: `
        SELECT COUNT(*) as count 
        FROM products 
        WHERE created_at >= NOW() - INTERVAL '7 days'
      `
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
      const result = await queryWithTimeout(query, [], 10000);
      results[key] = parseInt(result.rows[0]?.count || 0);
    }

    res.json({
      statistics: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ADMIN] Failed to get dashboard statistics:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/quotes
 * List all quote requests (paginated, with filters)
 */
router.get('/quotes', async (req, res) => {
  try {
    const {
      status,
      q,
      start_date,
      end_date,
      limit = 50,
      offset = 0
    } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (q) {
      conditions.push(`(customer_name ILIKE $${paramIndex} OR customer_email ILIKE $${paramIndex} OR quote_id ILIKE $${paramIndex})`);
      params.push(`%${q}%`);
      paramIndex++;
    }

    if (start_date) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(start_date);
    }

    if (end_date) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(end_date);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const sql = `
      SELECT id, quote_id, customer_name, customer_email, customer_phone, 
             customer_company, total_amount, status, created_at, quote_data
      FROM quote_requests
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM quote_requests
      ${whereClause}
    `;

    const queryParams = [...params, limitNum, offsetNum];
    const countParams = params;

    const [result, countResult] = await Promise.all([
      queryWithTimeout(sql, queryParams, 15000),
      queryWithTimeout(countSql, countParams, 10000)
    ]);

    res.json({
      items: result.rows,
      total: parseInt(countResult.rows[0]?.total || 0),
      limit: limitNum,
      offset: offsetNum
    });
  } catch (error) {
    console.error('[ADMIN] Failed to list quotes:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/quotes/:id
 * Get detail of a specific quote request (by ID or quote_id)
 */
router.get('/quotes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if it's an integer ID or a string quote_id
    const isNum = /^\d+$/.test(id);
    const condition = isNum ? 'id = $1' : 'quote_id = $1';

    const sql = `SELECT * FROM quote_requests WHERE ${condition}`;
    const result = await queryWithTimeout(sql, [id], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Quote request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[ADMIN] Failed to get quote details:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/quotes/:id/status
 * Update status of a quote request
 * Body: { status: "Contacted" | "Closed" | "Pending" }
 */
router.put('/quotes/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Bad request', message: 'status is required' });
    }

    const isNum = /^\d+$/.test(id);
    const condition = isNum ? 'id = $1' : 'quote_id = $1';

    const sql = `
      UPDATE quote_requests 
      SET status = $2, updated_at = NOW() 
      WHERE ${condition} 
      RETURNING id, quote_id, status
    `;

    const result = await queryWithTimeout(sql, [id, status], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Quote request not found' });
    }

    res.json({
      message: 'Quote status updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[ADMIN] Failed to update quote status:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * DELETE /api/admin/quotes/:id
 * Delete a quote request
 */
router.delete('/quotes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const isNum = /^\d+$/.test(id);
    const condition = isNum ? 'id = $1' : 'quote_id = $1';

    const sql = `DELETE FROM quote_requests WHERE ${condition} RETURNING id, quote_id`;
    const result = await queryWithTimeout(sql, [id], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Quote request not found' });
    }

    res.json({
      message: 'Quote request deleted successfully',
      deleted: result.rows[0]
    });
  } catch (error) {
    console.error('[ADMIN] Failed to delete quote:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/brands
 * List all brands with their active status and product counts
 */
router.get('/brands', async (req, res) => {
  try {
    const sql = `
      SELECT 
        b.id, 
        b.name, 
        b.slug, 
        b.is_active,
        (SELECT COUNT(*) FROM styles s JOIN products p ON s.style_code = p.style_code WHERE s.brand_id = b.id AND p.sku_status = 'Live') as product_count
      FROM brands b
      ORDER BY b.name ASC
    `;
    const result = await queryWithTimeout(sql, [], 10000);
    res.json({ brands: result.rows });
  } catch (error) {
    console.error('[ADMIN] Failed to list brands:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/brands/:id/status
 * Toggle brand active status. When is_active = false, all products of this brand 
 * will be hidden from the public site searchable views.
 * Body: { is_active: boolean }
 */
router.put('/brands/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (is_active === undefined) {
      return res.status(400).json({ error: 'is_active is required' });
    }

    const sql = 'UPDATE brands SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, is_active';
    const result = await queryWithTimeout(sql, [is_active === true || is_active === 'true', id], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // Since this affects product visibility via views, we suggest a sync
    await broadcastCacheInvalidation({ refreshViews: false, reason: 'brand_status_change' });

    res.json({
      message: `Brand '${result.rows[0].name}' is now ${result.rows[0].is_active ? 'active' : 'inactive'}. Manual sync required to update public site.`,
      brand: result.rows[0]
    });
  } catch (error) {
    console.error('[ADMIN] Failed to update brand status:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/:table
 * Generic list endpoint for any table (no auth, use carefully).
 * Supports ?limit=&offset= for basic pagination.
 */
router.get('/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!isSafeIdentifier(table)) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid table name' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `SELECT * FROM "${table}" LIMIT $1 OFFSET $2`;
    const result = await queryWithTimeout(sql, [limit, offset], 20000);

    res.json({
      items: result.rows,
      limit,
      offset
    });
  } catch (error) {
    console.error('[ADMIN] Failed to list table rows:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/:table/:id
 * Fetch a single row by numeric id (assumes an 'id' primary key column).
 */
router.get('/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    if (!isSafeIdentifier(table)) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid table name' });
    }
    const numericId = parseInt(id, 10);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid id' });
    }

    const sql = `SELECT * FROM "${table}" WHERE id = $1`;
    const result = await queryWithTimeout(sql, [numericId], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Row not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[ADMIN] Failed to fetch row by id:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * POST /api/admin/:table
 * Insert a new row into a table. Body keys are used as column names.
 */
router.post('/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!isSafeIdentifier(table)) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid table name' });
    }

    const payload = req.body || {};
    const columns = Object.keys(payload);

    if (columns.length === 0) {
      return res.status(400).json({ error: 'Bad request', message: 'Request body must have at least one field' });
    }

    for (const col of columns) {
      if (!isSafeIdentifier(col)) {
        return res.status(400).json({ error: 'Bad request', message: `Invalid column name: ${col}` });
      }
    }

    const colNames = columns.map(col => `"${col}"`).join(', ');
    const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
    const values = columns.map(col => payload[col]);

    const sql = `
      INSERT INTO "${table}" (${colNames})
      VALUES (${placeholders})
      RETURNING *
    `;

    const result = await queryWithTimeout(sql, values, 20000);
    res.status(201).json({ message: 'Row created', data: result.rows[0] });
  } catch (error) {
    console.error('[ADMIN] Failed to insert row:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/:table/:id
 * Update a row by id (assumes an 'id' primary key column).
 */
router.put('/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    if (!isSafeIdentifier(table)) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid table name' });
    }
    const numericId = parseInt(id, 10);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid id' });
    }

    const payload = req.body || {};
    const columns = Object.keys(payload);

    if (columns.length === 0) {
      return res.status(400).json({ error: 'Bad request', message: 'Request body must have at least one field' });
    }

    for (const col of columns) {
      if (!isSafeIdentifier(col)) {
        return res.status(400).json({ error: 'Bad request', message: `Invalid column name: ${col}` });
      }
    }

    const setClauses = columns.map((col, idx) => `"${col}" = $${idx + 1}`);
    const values = columns.map(col => payload[col]);
    values.push(numericId);

    const sql = `
      UPDATE "${table}"
      SET ${setClauses.join(', ')}
      WHERE id = $${columns.length + 1}
      RETURNING *
    `;

    const result = await queryWithTimeout(sql, values, 20000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Row not found' });
    }

    res.json({ message: 'Row updated', data: result.rows[0] });
  } catch (error) {
    console.error('[ADMIN] Failed to update row:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * DELETE /api/admin/:table/:id
 * Delete a row by id (assumes an 'id' primary key column).
 */
router.delete('/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    if (!isSafeIdentifier(table)) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid table name' });
    }
    const numericId = parseInt(id, 10);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid id' });
    }

    const sql = `
      DELETE FROM "${table}"
      WHERE id = $1
      RETURNING *
    `;

    const result = await queryWithTimeout(sql, [numericId], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Row not found' });
    }

    res.json({ message: 'Row deleted', data: result.rows[0] });
  } catch (error) {
    console.error('[ADMIN] Failed to delete row:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/admin/products/:code/carton-price
 * Update carton_price for all live SKUs of a style code and recalculate sell_price
 * using the current active pricing rules.
 */
router.put('/products/:code/carton-price', async (req, res) => {
  try {
    const { code } = req.params;
    const { carton_price } = req.body;

    if (carton_price == null) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'carton_price is required'
      });
    }

    const parsedCarton = parseFloat(carton_price);
    if (!Number.isFinite(parsedCarton) || parsedCarton < 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'carton_price must be a non-negative number'
      });
    }

    const params = [parsedCarton, code.toUpperCase()];

    const updateSql = `
      UPDATE products p
      SET
        carton_price = $1::numeric,
        sell_price = ROUND(
          (COALESCE(NULLIF($1::numeric, 0), NULLIF(p.single_price, 0))
          * (1 + (
              SELECT markup_percent / 100
              FROM pricing_rules r
              WHERE r.active = true
                AND COALESCE(NULLIF($1::numeric, 0), NULLIF(p.single_price, 0))
                    BETWEEN r.from_price AND r.to_price
              ORDER BY r.from_price
              LIMIT 1
          )))::numeric, 2
        ),
        pricing_version = (
          SELECT version
          FROM pricing_rules r
          WHERE r.active = true
          ORDER BY version DESC, from_price ASC
          LIMIT 1
        ),
        last_priced_at = NOW()
      WHERE style_code = $2
        AND sku_status = 'Live'
      RETURNING id, style_code, carton_price, sell_price, pricing_version, last_priced_at
    `;

    const result = await queryWithTimeout(updateSql, params, 300000);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No matching live products found for this style_code'
      });
    }

    // View refresh is now manual via /pricing/sync to prevent server locking
    await broadcastCacheInvalidation({ refreshViews: false, reason: 'admin_update' });

    res.json({
      message: 'carton_price and sell_price updated successfully in database. Manual sync required for public site.',
      updatedCount: result.rows.length,
      items: result.rows
    });
  } catch (error) {
    console.error('[ADMIN] Failed to update carton_price:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/products/:code/price-preview
 * Preview sell_price for a given carton_price using current active pricing rules.
 * Does NOT modify the database.
 *
 * Query params:
 *   - carton_price (required): proposed new carton price
 */
router.get('/products/:code/price-preview', async (req, res) => {
  try {
    const { code } = req.params;
    const { carton_price } = req.query;

    if (carton_price == null) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'carton_price query parameter is required'
      });
    }

    const parsedCarton = parseFloat(carton_price);
    if (!Number.isFinite(parsedCarton) || parsedCarton < 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'carton_price must be a non-negative number'
      });
    }

    const basePrice = parsedCarton;

    const ruleSql = `
      SELECT version, from_price, to_price, markup_percent
      FROM pricing_rules
      WHERE active = true
        AND $1 BETWEEN from_price AND to_price
      ORDER BY from_price
      LIMIT 1
    `;

    const ruleResult = await queryWithTimeout(ruleSql, [basePrice], 10000);

    let markupPercent = null;
    let pricingRule = null;
    let sellPrice = basePrice;

    if (ruleResult.rows.length > 0) {
      const row = ruleResult.rows[0];
      markupPercent = parseFloat(row.markup_percent);
      pricingRule = {
        version: row.version,
        from_price: parseFloat(row.from_price),
        to_price: parseFloat(row.to_price),
        markup_percent: markupPercent
      };
      sellPrice = Math.round(basePrice * (1 + markupPercent / 100) * 100) / 100;
    }

    res.json({
      style_code: code.toUpperCase(),
      carton_price: basePrice,
      sell_price: sellPrice,
      markup_percent: markupPercent,
      pricing_rule: pricingRule
    });
  } catch (error) {
    console.error('[ADMIN] Failed to preview price:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/:table/count
 * Get total count of rows in a table
 */
router.get('/:table/count', async (req, res) => {
  try {
    const { table } = req.params;
    if (!isSafeIdentifier(table)) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid table name' });
    }

    const sql = `SELECT COUNT(*) as total FROM "${table}"`;
    const result = await queryWithTimeout(sql, [], 10000);

    res.json({
      table,
      total: parseInt(result.rows[0]?.total || 0)
    });
  } catch (error) {
    console.error('[ADMIN] Failed to get table count:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/admin/:table/columns
 * Get column information for a table (schema)
 */
router.get('/:table/columns', async (req, res) => {
  try {
    const { table } = req.params;
    if (!isSafeIdentifier(table)) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid table name' });
    }

    const sql = `
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `;

    const result = await queryWithTimeout(sql, [table], 10000);

    res.json({
      table,
      columns: result.rows
    });
  } catch (error) {
    console.error('[ADMIN] Failed to get table columns:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * POST /api/admin/:table/search
 * Search within a table (generic search endpoint)
 * Body: { field: "column_name", value: "search_term", limit: 100, offset: 0 }
 */
router.post('/:table/search', async (req, res) => {
  try {
    const { table } = req.params;
    if (!isSafeIdentifier(table)) {
      return res.status(400).json({ error: 'Bad request', message: 'Invalid table name' });
    }

    const { field, value, limit = 100, offset = 0 } = req.body;

    if (!field || !isSafeIdentifier(field)) {
      return res.status(400).json({ error: 'Bad request', message: 'Valid field name is required' });
    }

    if (value == null || value === '') {
      return res.status(400).json({ error: 'Bad request', message: 'Search value is required' });
    }

    const limitNum = Math.min(parseInt(limit, 10) || 100, 500);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const sql = `
      SELECT *
      FROM "${table}"
      WHERE "${field}"::text ILIKE $1
      LIMIT $2 OFFSET $3
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM "${table}"
      WHERE "${field}"::text ILIKE $1
    `;

    const searchValue = `%${value}%`;

    const [result, countResult] = await Promise.all([
      queryWithTimeout(sql, [searchValue, limitNum, offsetNum], 20000),
      queryWithTimeout(countSql, [searchValue], 10000)
    ]);

    res.json({
      items: result.rows,
      total: parseInt(countResult.rows[0]?.total || 0),
      limit: limitNum,
      offset: offsetNum
    });
  } catch (error) {
    console.error('[ADMIN] Failed to search table:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;