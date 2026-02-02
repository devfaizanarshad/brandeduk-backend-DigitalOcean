const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../config/database');
const { clearCache } = require('../services/productService');

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
      brand_id,
      product_type_id,
      sku_status,
      price_min,
      price_max,
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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const query = `
      SELECT 
        p.id,
        p.style_code,
        p.sku_code,
        s.style_name,
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
        p.last_priced_at
      FROM products p
      LEFT JOIN styles s ON p.style_code = s.style_code
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
        t.name as tag_name
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

    clearCache();

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

    clearCache();

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

    clearCache();

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
 * PUT /api/admin/products/:code
 * Update product detail for a style_code.
 * Body: { style_name?, specification?, fabric_description?, primary_image_url?, colorImages?: [{ colour_name, url }] }
 */
router.put('/products/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const styleCode = code.toUpperCase();
    const { style_name, specification, fabric_description, primary_image_url, colorImages } = req.body;

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
    if (style_name !== undefined || specification !== undefined || fabric_description !== undefined) {
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

    clearCache();

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

      // Refresh materialized view once after all updates
      try {
        await queryWithTimeout('REFRESH MATERIALIZED VIEW CONCURRENTLY product_search_materialized;', [], 600000);
      } catch (err) {
        console.error('[ADMIN] View refresh failed:', err.message);
        try {
          await queryWithTimeout('REFRESH MATERIALIZED VIEW product_search_materialized;', [], 600000);
        } catch (err2) {
          console.error('[ADMIN] Non-concurrent refresh also failed:', err2.message);
        }
      }

      clearCache();

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

    clearCache();

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

    // Refresh materialized view so search and filters see new prices
    let viewRefreshed = false;
    let refreshError = null;

    try {
      await queryWithTimeout('REFRESH MATERIALIZED VIEW CONCURRENTLY product_search_materialized;', [], 600000);
      viewRefreshed = true;
    } catch (err) {
      refreshError = err.message;
      console.error('[ADMIN] CONCURRENTLY refresh failed, falling back to non-concurrent refresh:', err.message);
      try {
        await queryWithTimeout('REFRESH MATERIALIZED VIEW product_search_materialized;', [], 600000);
        viewRefreshed = true;
      } catch (err2) {
        refreshError = err2.message;
        console.error('[ADMIN] Failed to refresh materialized view:', err2.message);
      }
    }

    clearCache();

    res.json({
      message: 'carton_price and sell_price updated successfully',
      updatedCount: result.rows.length,
      materializedViewRefreshed: viewRefreshed,
      refreshError: viewRefreshed ? null : refreshError,
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