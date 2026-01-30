const express = require('express');
const router = express.Router();
const { pool, queryWithTimeout } = require('../config/database');
const { clearCache } = require('../services/productService');

/**
 * GET /api/display-order
 * List all display order entries with optional filters
 * Query params: brand_id, product_type_id, style_code, page, limit
 */
router.get('/', async (req, res) => {
  try {
    const {
      brand_id,
      product_type_id,
      style_code,
      page = 1,
      limit = 50
    } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (brand_id) {
      conditions.push(`pdo.brand_id = $${paramIndex}`);
      params.push(parseInt(brand_id));
      paramIndex++;
    }

    if (product_type_id) {
      conditions.push(`pdo.product_type_id = $${paramIndex}`);
      params.push(parseInt(product_type_id));
      paramIndex++;
    }

    if (style_code) {
      conditions.push(`pdo.style_code ILIKE $${paramIndex}`);
      params.push(`%${style_code}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT 
        pdo.id,
        pdo.style_code,
        pdo.brand_id,
        b.name as brand_name,
        pdo.product_type_id,
        pt.name as product_type_name,
        pdo.display_order,
        pdo.created_at,
        pdo.updated_at,
        s.style_name as product_name
      FROM product_display_order pdo
      LEFT JOIN brands b ON pdo.brand_id = b.id
      LEFT JOIN product_types pt ON pdo.product_type_id = pt.id
      LEFT JOIN styles s ON pdo.style_code = s.style_code
      ${whereClause}
      ORDER BY pdo.display_order ASC, pdo.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM product_display_order pdo
      ${whereClause}
    `;

    params.push(parseInt(limit), offset);

    const [result, countResult] = await Promise.all([
      queryWithTimeout(query, params, 10000),
      queryWithTimeout(countQuery, params.slice(0, -2), 10000)
    ]);

    res.json({
      items: result.rows,
      total: parseInt(countResult.rows[0]?.total || 0),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch display orders:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/display-order/products
 * Get products with display order info for admin panel
 * Shows all products for a brand/product_type with their display orders
 */
router.get('/products', async (req, res) => {
  try {
    const {
      brand_id,
      product_type_id,
      page = 1,
      limit = 50
    } = req.query;

    if (!brand_id && !product_type_id) {
      return res.status(400).json({ 
        error: 'Bad request', 
        message: 'At least one of brand_id or product_type_id is required' 
      });
    }

    const conditions = [`p.sku_status = 'Live'`];
    const params = [];
    let paramIndex = 1;

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

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build the display order lookup condition
    let pdoConditions = [];
    if (brand_id) pdoConditions.push(`pdo.brand_id = ${parseInt(brand_id)}`);
    if (product_type_id) pdoConditions.push(`pdo.product_type_id = ${parseInt(product_type_id)}`);
    const pdoJoinCondition = pdoConditions.length > 0 
      ? `AND ${pdoConditions.join(' AND ')}` 
      : '';

    const query = `
      SELECT DISTINCT ON (s.style_code)
        s.style_code,
        s.style_name as product_name,
        b.id as brand_id,
        b.name as brand_name,
        pt.id as product_type_id,
        pt.name as product_type_name,
        pdo.id as display_order_id,
        COALESCE(pdo.display_order, 999999) as display_order,
        pdo.created_at as display_order_created_at,
        p.primary_image_url as image
      FROM styles s
      INNER JOIN products p ON s.style_code = p.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN product_types pt ON s.product_type_id = pt.id
      LEFT JOIN product_display_order pdo ON s.style_code = pdo.style_code ${pdoJoinCondition}
      ${whereClause}
      ORDER BY s.style_code, COALESCE(pdo.display_order, 999999) ASC
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT s.style_code) as total
      FROM styles s
      INNER JOIN products p ON s.style_code = p.style_code
      ${whereClause}
    `;

    // Get all products first, then sort and paginate
    const [allResult, countResult] = await Promise.all([
      queryWithTimeout(query, params, 15000),
      queryWithTimeout(countQuery, params, 10000)
    ]);

    // Sort by display_order and paginate
    const sortedProducts = allResult.rows.sort((a, b) => a.display_order - b.display_order);
    const paginatedProducts = sortedProducts.slice(offset, offset + parseInt(limit));

    res.json({
      items: paginatedProducts,
      total: parseInt(countResult.rows[0]?.total || 0),
      page: parseInt(page),
      limit: parseInt(limit),
      filters: {
        brand_id: brand_id ? parseInt(brand_id) : null,
        product_type_id: product_type_id ? parseInt(product_type_id) : null
      }
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch products with display order:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/display-order/brands
 * Get all brands with product counts for admin dropdown
 */
router.get('/brands', async (req, res) => {
  try {
    const query = `
      SELECT 
        b.id,
        b.name,
        b.slug,
        b.display_order,
        COUNT(DISTINCT s.style_code) as product_count
      FROM brands b
      INNER JOIN styles s ON b.id = s.brand_id
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY b.id, b.name, b.slug, b.display_order
      HAVING COUNT(DISTINCT s.style_code) > 0
      ORDER BY b.display_order ASC, b.name ASC
    `;

    const result = await queryWithTimeout(query, [], 10000);

    res.json({
      items: result.rows
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch brands:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/display-order/product-types
 * Get all product types with product counts for admin dropdown
 */
router.get('/product-types', async (req, res) => {
  try {
    const query = `
      SELECT 
        pt.id,
        pt.name,
        pt.slug,
        pt.display_order,
        COUNT(DISTINCT s.style_code) as product_count
      FROM product_types pt
      INNER JOIN styles s ON pt.id = s.product_type_id
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY pt.id, pt.name, pt.slug, pt.display_order
      HAVING COUNT(DISTINCT s.style_code) > 0
      ORDER BY pt.display_order ASC, pt.name ASC
    `;

    const result = await queryWithTimeout(query, [], 10000);

    res.json({
      items: result.rows
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch product types:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * POST /api/display-order
 * Create a new display order entry
 * Body: { style_code, brand_id?, product_type_id?, display_order }
 */
router.post('/', async (req, res) => {
  try {
    const { style_code, brand_id, product_type_id, display_order } = req.body;

    if (!style_code) {
      return res.status(400).json({ error: 'Bad request', message: 'style_code is required' });
    }

    if (display_order === undefined || display_order === null) {
      return res.status(400).json({ error: 'Bad request', message: 'display_order is required' });
    }

    // Check if style_code exists
    const styleCheck = await queryWithTimeout(
      'SELECT style_code FROM styles WHERE style_code = $1',
      [style_code.toUpperCase()],
      5000
    );

    if (styleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: `Product with style_code ${style_code} not found` });
    }

    // Insert or update (upsert)
    const query = `
      INSERT INTO product_display_order (style_code, brand_id, product_type_id, display_order, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (style_code, brand_id, product_type_id) 
      DO UPDATE SET display_order = $4, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await queryWithTimeout(
      query,
      [style_code.toUpperCase(), brand_id || null, product_type_id || null, parseInt(display_order)],
      10000
    );

    // Clear product list cache so new display order is applied immediately
    clearCache();

    res.status(201).json({
      message: 'Display order saved successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[ERROR] Failed to create display order:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * POST /api/display-order/bulk
 * Bulk update display orders
 * Body: { brand_id?, product_type_id?, orders: [{ style_code, display_order }] }
 */
router.post('/bulk', async (req, res) => {
  try {
    const { brand_id, product_type_id, orders } = req.body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ 
        error: 'Bad request', 
        message: 'orders array is required and must not be empty' 
      });
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const results = [];
      
      for (const order of orders) {
        const { style_code, display_order } = order;
        
        if (!style_code || display_order === undefined) {
          continue; // Skip invalid entries
        }

        const query = `
          INSERT INTO product_display_order (style_code, brand_id, product_type_id, display_order, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (style_code, brand_id, product_type_id) 
          DO UPDATE SET display_order = $4, updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `;

        const result = await client.query(query, [
          style_code.toUpperCase(),
          brand_id || null,
          product_type_id || null,
          parseInt(display_order)
        ]);

        results.push(result.rows[0]);
      }

      await client.query('COMMIT');

      // Clear product list cache so new display order is applied immediately
      clearCache();

      res.json({
        message: `Successfully updated ${results.length} display orders`,
        updated: results.length,
        data: results
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[ERROR] Failed to bulk update display orders:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/display-order/:id
 * Update a display order entry
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { display_order } = req.body;

    if (display_order === undefined || display_order === null) {
      return res.status(400).json({ error: 'Bad request', message: 'display_order is required' });
    }

    const query = `
      UPDATE product_display_order 
      SET display_order = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await queryWithTimeout(query, [parseInt(display_order), parseInt(id)], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Display order entry not found' });
    }

    // Clear product list cache so updated display order is applied immediately
    clearCache();

    res.json({
      message: 'Display order updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[ERROR] Failed to update display order:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * DELETE /api/display-order/:id
 * Delete a display order entry
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const query = 'DELETE FROM product_display_order WHERE id = $1 RETURNING *';
    const result = await queryWithTimeout(query, [parseInt(id)], 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Display order entry not found' });
    }

    // Clear product list cache so removal is applied immediately
    clearCache();

    res.json({
      message: 'Display order deleted successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[ERROR] Failed to delete display order:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * DELETE /api/display-order/by-context
 * Delete display order by context (brand_id and/or product_type_id)
 * Body: { style_code, brand_id?, product_type_id? }
 */
router.delete('/by-context', async (req, res) => {
  try {
    const { style_code, brand_id, product_type_id } = req.body;

    if (!style_code) {
      return res.status(400).json({ error: 'Bad request', message: 'style_code is required' });
    }

    let query;
    let params;

    if (brand_id && product_type_id) {
      query = 'DELETE FROM product_display_order WHERE style_code = $1 AND brand_id = $2 AND product_type_id = $3 RETURNING *';
      params = [style_code.toUpperCase(), parseInt(brand_id), parseInt(product_type_id)];
    } else if (brand_id) {
      query = 'DELETE FROM product_display_order WHERE style_code = $1 AND brand_id = $2 AND product_type_id IS NULL RETURNING *';
      params = [style_code.toUpperCase(), parseInt(brand_id)];
    } else if (product_type_id) {
      query = 'DELETE FROM product_display_order WHERE style_code = $1 AND brand_id IS NULL AND product_type_id = $2 RETURNING *';
      params = [style_code.toUpperCase(), parseInt(product_type_id)];
    } else {
      query = 'DELETE FROM product_display_order WHERE style_code = $1 AND brand_id IS NULL AND product_type_id IS NULL RETURNING *';
      params = [style_code.toUpperCase()];
    }

    const result = await queryWithTimeout(query, params, 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Display order entry not found for this context' });
    }

    // Clear product list cache so context deletion is applied immediately
    clearCache();

    res.json({
      message: 'Display order deleted successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[ERROR] Failed to delete display order by context:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
