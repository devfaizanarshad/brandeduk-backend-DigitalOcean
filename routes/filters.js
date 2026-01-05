const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../config/database');

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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.gender_slug = $1 AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE gender_slug = $1 AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.age_group_slug = $1 AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE age_group_slug = $1 AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.sleeve_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE sleeve_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.neckline_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE neckline_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.fabric_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE fabric_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.size_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE size_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.colour_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE colour_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE LOWER(psm.primary_colour) = $1 AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE LOWER(primary_colour) = $1 AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.style_keyword_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE style_keyword_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE LOWER(psm.tag_slug) = $1 AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE LOWER(tag_slug) = $1 AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.weight_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE weight_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE LOWER(psm.fit_slug) = $1 AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE LOWER(fit_slug) = $1 AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.sector_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE sector_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.sport_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE sport_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.effects_arr && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE effects_arr && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const { page = 1, limit = 24 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.accreditation_slugs && ARRAY[$1]::text[] AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE accreditation_slugs && ARRAY[$1]::text[] AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE LOWER(psm.colour_shade) = $1 AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE LOWER(colour_shade) = $1 AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
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

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [slug.toLowerCase(), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [slug.toLowerCase()], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
    const query = `
      SELECT 
        pt.id,
        pt.name,
        LOWER(REPLACE(pt.name, ' ', '-')) as slug,
        pt.display_order,
        COUNT(DISTINCT s.style_code) as product_count
      FROM product_types pt
      LEFT JOIN styles s ON pt.id = s.product_type_id
      LEFT JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY pt.id, pt.name, pt.display_order
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
    const { page = 1, limit = 24 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Convert slug back to name format for matching
    const searchTerm = slug.toLowerCase().replace(/-/g, ' ');

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      INNER JOIN styles s ON psm.style_code = s.style_code
      INNER JOIN product_types pt ON s.product_type_id = pt.id
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE LOWER(pt.name) = $1 AND psm.sku_status = 'Live'
      ORDER BY psm.style_code
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT psm.style_code) as total
      FROM product_search_materialized psm
      INNER JOIN styles s ON psm.style_code = s.style_code
      INNER JOIN product_types pt ON s.product_type_id = pt.id
      WHERE LOWER(pt.name) = $1 AND psm.sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [searchTerm, parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [searchTerm], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
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
 * Returns min and max prices across all products
 */
router.get('/price-range', async (req, res) => {
  try {
    const query = `
      SELECT 
        MIN(single_price) as min_price,
        MAX(single_price) as max_price
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND single_price IS NOT NULL AND single_price > 0
    `;
    const result = await queryWithTimeout(query, [], 10000);
    const row = result.rows[0];
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

    const query = `
      SELECT DISTINCT
        psm.style_code as code,
        psm.style_name as name,
        psm.single_price as price,
        psm.primary_image_url as image,
        b.name as brand
      FROM product_search_materialized psm
      LEFT JOIN styles s ON psm.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE psm.single_price >= $1 AND psm.single_price <= $2 AND psm.sku_status = 'Live'
      ORDER BY psm.single_price ASC, psm.style_code
      LIMIT $3 OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT style_code) as total
      FROM product_search_materialized
      WHERE single_price >= $1 AND single_price <= $2 AND sku_status = 'Live'
    `;

    const [productsResult, countResult] = await Promise.all([
      queryWithTimeout(query, [parseFloat(min), parseFloat(max), parseInt(limit), offset], 15000),
      queryWithTimeout(countQuery, [parseFloat(min), parseFloat(max)], 10000)
    ]);

    res.json({
      items: productsResult.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0]?.total || 0)
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch products by price range:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
