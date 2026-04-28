const { queryWithTimeout } = require('../config/database');
const { buildProductDetailQuery } = require('./productService');

function normalizeSiteSlug(siteSlug) {
  const normalized = String(siteSlug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeStyleCodes(styleCodes) {
  if (!Array.isArray(styleCodes)) {
    return [];
  }

  return [
    ...new Set(
      styleCodes
        .map(code => String(code || '').trim().toUpperCase())
        .filter(Boolean)
    )
  ];
}

function mapProductRow(row) {
  return {
    id: row.id,
    site_slug: row.site_slug,
    siteSlug: row.site_slug,
    code: row.code,
    style_code: row.code,
    name: row.name || '',
    brand: row.brand || '',
    product_type: row.product_type || '',
    productType: row.product_type || '',
    supplier: row.supplier || '',
    price: row.price != null ? parseFloat(row.price) : null,
    image: row.image || '',
    colourCount: parseInt(row.colour_count || 0, 10),
    sizeCount: parseInt(row.size_count || 0, 10),
    display_order: parseInt(row.display_order || 999999, 10),
    displayOrder: parseInt(row.display_order || 999999, 10),
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listSiteProducts(siteSlug, options = {}) {
  const normalizedSiteSlug = normalizeSiteSlug(siteSlug);
  if (!normalizedSiteSlug) {
    const error = new Error('Invalid site slug');
    error.status = 400;
    throw error;
  }

  const {
    activeOnly = true,
    active,
    limit = 100,
    offset = 0,
  } = options;

  const limitNum = Math.min(parseInt(limit, 10) || 100, 500);
  const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);
  const conditions = ['sp.site_slug = $1'];
  const params = [normalizedSiteSlug];

  if (active !== undefined) {
    conditions.push(`sp.active = $${params.length + 1}`);
    params.push(active === true || active === 'true');
  } else if (activeOnly) {
    conditions.push('sp.active = true');
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const sql = `
    SELECT
      sp.id,
      sp.site_slug,
      sp.style_code AS code,
      sp.display_order,
      sp.active,
      sp.created_at,
      sp.updated_at,
      s.style_name AS name,
      COALESCE(b.name, '') AS brand,
      COALESCE(pt.name, '') AS product_type,
      COALESCE(sup.slug, '') AS supplier,
      MIN(p.sell_price) AS price,
      MIN(COALESCE(NULLIF(p.primary_image_url, 'Not available'), NULLIF(p.colour_image_url, 'Not available'))) AS image,
      COUNT(DISTINCT p.colour_name) AS colour_count,
      COUNT(DISTINCT sz.name) AS size_count
    FROM site_products sp
    INNER JOIN styles s ON s.style_code = sp.style_code
    LEFT JOIN brands b ON s.brand_id = b.id
    LEFT JOIN product_types pt ON s.product_type_id = pt.id
    LEFT JOIN suppliers sup ON s.supplier_id = sup.id
    LEFT JOIN products p ON p.style_code = s.style_code AND p.sku_status = 'Live'
    LEFT JOIN sizes sz ON p.size_id = sz.id
    ${whereClause}
    GROUP BY
      sp.id,
      sp.site_slug,
      sp.style_code,
      sp.display_order,
      sp.active,
      sp.created_at,
      sp.updated_at,
      s.style_name,
      b.name,
      pt.name,
      sup.slug
    ORDER BY sp.active DESC, sp.display_order ASC, s.style_name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const countSql = `
    SELECT COUNT(*) AS total
    FROM site_products sp
    ${whereClause}
  `;

  const [result, countResult] = await Promise.all([
    queryWithTimeout(sql, [...params, limitNum, offsetNum], 15000),
    queryWithTimeout(countSql, params, 10000),
  ]);

  return {
    site_slug: normalizedSiteSlug,
    siteSlug: normalizedSiteSlug,
    items: result.rows.map(mapProductRow),
    total: parseInt(countResult.rows[0]?.total || 0, 10),
    limit: limitNum,
    offset: offsetNum,
  };
}

async function getSiteProductDetail(siteSlug, styleCode) {
  const normalizedSiteSlug = normalizeSiteSlug(siteSlug);
  const normalizedStyleCode = String(styleCode || '').trim().toUpperCase();

  if (!normalizedSiteSlug || !normalizedStyleCode) {
    const error = new Error('Invalid site slug or style code');
    error.status = 400;
    throw error;
  }

  const mappingResult = await queryWithTimeout(
    `
      SELECT site_slug, style_code, display_order, active
      FROM site_products
      WHERE site_slug = $1 AND style_code = $2 AND active = true
      LIMIT 1
    `,
    [normalizedSiteSlug, normalizedStyleCode],
    10000
  );

  if (mappingResult.rows.length === 0) {
    return null;
  }

  const product = await buildProductDetailQuery(normalizedStyleCode);
  if (!product) {
    return null;
  }

  return {
    ...product,
    site: mappingResult.rows[0],
  };
}

async function bulkSetSiteProducts(siteSlug, styleCodes, active = true) {
  const normalizedSiteSlug = normalizeSiteSlug(siteSlug);
  const normalizedStyleCodes = normalizeStyleCodes(styleCodes);
  const activeValue = active === true || active === 'true';

  if (!normalizedSiteSlug) {
    const error = new Error('Invalid site slug');
    error.status = 400;
    throw error;
  }

  if (normalizedStyleCodes.length === 0) {
    const error = new Error('style_codes array is required and must not be empty');
    error.status = 400;
    throw error;
  }

  const sql = `
    WITH input(style_code) AS (
      SELECT unnest($2::text[])
    ),
    existing AS (
      SELECT i.style_code
      FROM input i
      INNER JOIN styles s ON s.style_code = i.style_code
    ),
    upserted AS (
      INSERT INTO site_products (site_slug, style_code, active, updated_at)
      SELECT $1, style_code, $3, NOW()
      FROM existing
      ON CONFLICT (site_slug, style_code)
      DO UPDATE SET active = EXCLUDED.active, updated_at = NOW()
      RETURNING style_code, active
    )
    SELECT
      (SELECT json_agg(style_code ORDER BY style_code) FROM upserted) AS updated,
      (
        SELECT json_agg(i.style_code ORDER BY i.style_code)
        FROM input i
        LEFT JOIN existing e ON e.style_code = i.style_code
        WHERE e.style_code IS NULL
      ) AS missing
  `;

  const result = await queryWithTimeout(sql, [normalizedSiteSlug, normalizedStyleCodes, activeValue], 15000);

  return {
    site_slug: normalizedSiteSlug,
    siteSlug: normalizedSiteSlug,
    active: activeValue,
    updated_styles: result.rows[0]?.updated || [],
    missing_styles: result.rows[0]?.missing || [],
  };
}

async function orderSiteProducts(siteSlug, orders) {
  const normalizedSiteSlug = normalizeSiteSlug(siteSlug);
  if (!normalizedSiteSlug) {
    const error = new Error('Invalid site slug');
    error.status = 400;
    throw error;
  }

  if (!Array.isArray(orders) || orders.length === 0) {
    const error = new Error('orders array is required and must not be empty');
    error.status = 400;
    throw error;
  }

  const normalizedOrders = orders
    .map(item => ({
      style_code: String(item?.style_code || item?.code || '').trim().toUpperCase(),
      display_order: parseInt(item?.display_order ?? item?.displayOrder, 10),
    }))
    .filter(item => item.style_code && Number.isInteger(item.display_order));

  if (normalizedOrders.length === 0) {
    const error = new Error('orders must include style_code and display_order');
    error.status = 400;
    throw error;
  }

  const styleCodes = normalizedOrders.map(item => item.style_code);
  const displayOrders = normalizedOrders.map(item => item.display_order);

  const sql = `
    WITH input AS (
      SELECT *
      FROM unnest($2::text[], $3::int[]) AS t(style_code, display_order)
    )
    UPDATE site_products sp
    SET display_order = input.display_order, updated_at = NOW()
    FROM input
    WHERE sp.site_slug = $1 AND sp.style_code = input.style_code
    RETURNING sp.style_code, sp.display_order
  `;

  const result = await queryWithTimeout(sql, [normalizedSiteSlug, styleCodes, displayOrders], 15000);

  return {
    site_slug: normalizedSiteSlug,
    siteSlug: normalizedSiteSlug,
    updated_orders: result.rows,
  };
}

async function removeSiteProduct(siteSlug, styleCode) {
  const normalizedSiteSlug = normalizeSiteSlug(siteSlug);
  const normalizedStyleCode = String(styleCode || '').trim().toUpperCase();

  if (!normalizedSiteSlug || !normalizedStyleCode) {
    const error = new Error('Invalid site slug or style code');
    error.status = 400;
    throw error;
  }

  const result = await queryWithTimeout(
    `
      UPDATE site_products
      SET active = false, updated_at = NOW()
      WHERE site_slug = $1 AND style_code = $2
      RETURNING style_code, active
    `,
    [normalizedSiteSlug, normalizedStyleCode],
    10000
  );

  return result.rows[0] || null;
}

module.exports = {
  bulkSetSiteProducts,
  getSiteProductDetail,
  listSiteProducts,
  normalizeSiteSlug,
  orderSiteProducts,
  removeSiteProduct,
};
