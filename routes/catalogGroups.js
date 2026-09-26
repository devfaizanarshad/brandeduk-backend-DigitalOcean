const express = require('express');
const { queryWithTimeout } = require('../config/database');

const router = express.Router();
const VALID_TYPES = new Set(['sector', 'collection']);

router.get('/', async (req, res) => {
  try {
    const { type, slug } = req.query;

    if (!type && !slug) {
      const result = await queryWithTimeout(`
        SELECT
          cg.group_type AS type,
          cg.name,
          cg.slug,
          cg.display_order,
          COUNT(DISTINCT p.style_code)::integer AS product_count
        FROM catalog_groups cg
        LEFT JOIN product_catalog_groups pcg ON pcg.catalog_group_id = cg.id
        LEFT JOIN products p ON p.id = pcg.product_id AND p.sku_status = 'Live'
        GROUP BY cg.id
        ORDER BY cg.group_type DESC, cg.display_order, cg.name
      `, [], 20000);

      return res.json({
        sectors: result.rows.filter(row => row.type === 'sector'),
        collections: result.rows.filter(row => row.type === 'collection')
      });
    }

    if (!VALID_TYPES.has(type) || !slug) {
      return res.status(400).json({
        error: 'Both type and slug are required',
        allowedTypes: [...VALID_TYPES]
      });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 24));
    const offset = (page - 1) * limit;

    const groupResult = await queryWithTimeout(`
      SELECT id, group_type AS type, name, slug
      FROM catalog_groups
      WHERE group_type = $1 AND slug = $2
    `, [type, String(slug).toLowerCase()], 10000);

    if (!groupResult.rows.length) {
      return res.status(404).json({ error: 'Catalog group not found' });
    }

    const group = groupResult.rows[0];
    const [countResult, productsResult] = await Promise.all([
      queryWithTimeout(`
        SELECT COUNT(DISTINCT p.style_code)::integer AS total
        FROM product_catalog_groups pcg
        JOIN products p ON p.id = pcg.product_id
        WHERE pcg.catalog_group_id = $1 AND p.sku_status = 'Live'
      `, [group.id], 15000),
      queryWithTimeout(`
        SELECT
          p.style_code AS code,
          MAX(s.style_name) AS name,
          MAX(b.name) AS brand,
          MIN(COALESCE(p.sell_price, p.single_price, p.pack_price, p.carton_price))::numeric(10,2) AS price,
          (ARRAY_AGG(COALESCE(NULLIF(p.colour_image_url, ''), p.primary_image_url)
            ORDER BY p.id) FILTER (WHERE COALESCE(NULLIF(p.colour_image_url, ''), p.primary_image_url) IS NOT NULL))[1] AS image
        FROM product_catalog_groups pcg
        JOIN products p ON p.id = pcg.product_id
        JOIN styles s ON s.style_code = p.style_code
        LEFT JOIN brands b ON b.id = s.brand_id
        WHERE pcg.catalog_group_id = $1 AND p.sku_status = 'Live'
        GROUP BY p.style_code
        ORDER BY MAX(s.style_name), p.style_code
        LIMIT $2 OFFSET $3
      `, [group.id, limit, offset], 20000)
    ]);

    const total = countResult.rows[0].total;
    return res.json({
      group: { type: group.type, name: group.name, slug: group.slug },
      products: productsResult.rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('[CATALOG GROUPS] Request failed:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
