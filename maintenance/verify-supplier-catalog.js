#!/usr/bin/env node
'use strict';

function parseArgs(argv) {
  const supplierIndex = argv.indexOf('--supplier');
  return { supplier: supplierIndex >= 0 ? String(argv[supplierIndex + 1] || '').toLowerCase() : 'ralawise' };
}

async function main() {
  const { supplier } = parseArgs(process.argv.slice(2));
  const { pool } = require('../config/database');
  try {
    const summary = await pool.query(`
      WITH supplier_styles AS (
        SELECT s.style_code FROM styles s JOIN suppliers sup ON sup.id = s.supplier_id WHERE sup.slug = $1
      ), live_products AS (
        SELECT p.* FROM products p JOIN supplier_styles s USING (style_code) WHERE p.sku_status = 'Live'
      )
      SELECT
        (SELECT COUNT(DISTINCT style_code) FROM live_products)::int live_styles,
        (SELECT COUNT(*) FROM live_products)::int live_skus,
        (SELECT COUNT(*) FROM product_search_mv mv JOIN supplier_styles s USING (style_code) WHERE mv.sku_status = 'Live')::int search_view_skus,
        (SELECT COUNT(*) FROM live_products WHERE sell_price IS NULL OR sell_price <= 0)::int missing_sell_price,
        (SELECT COUNT(*) FROM live_products WHERE COALESCE(NULLIF(primary_image_url, ''), NULLIF(colour_image_url, '')) IS NULL)::int missing_image,
        (SELECT COUNT(DISTINCT p.style_code) FROM live_products p WHERE EXISTS (SELECT 1 FROM product_fabrics pf WHERE pf.product_id = p.id))::int styles_with_fabric,
        (SELECT COUNT(DISTINCT p.style_code) FROM live_products p WHERE EXISTS (SELECT 1 FROM product_weight_ranges pw WHERE pw.product_id = p.id))::int styles_with_weight
    `, [supplier]);

    const combination = await pool.query(`
      SELECT COUNT(DISTINCT mv.style_code)::int count,
        ARRAY_AGG(DISTINCT mv.style_code ORDER BY mv.style_code) FILTER (WHERE mv.style_code IS NOT NULL) AS sample_codes
      FROM product_search_mv mv
      JOIN styles s ON s.style_code = mv.style_code
      JOIN suppliers sup ON sup.id = s.supplier_id
      JOIN product_types pt ON pt.id = s.product_type_id
      WHERE sup.slug = $1 AND mv.sku_status = 'Live'
        AND LOWER(REGEXP_REPLACE(pt.name, '[^a-zA-Z0-9]', '', 'g')) = 'tshirts'
        AND mv.fabric_slugs::text[] && ARRAY['cotton-100']::text[]
        AND LOWER(mv.colour_shade) = 'red - burgundy'
        AND mv.weight_slugs::text[] && ARRAY['151-200gsm']::text[]
    `, [supplier]);

    const lastRun = await pool.query(`
      SELECT id, status, source_rows, source_styles, retire_missing, started_at, completed_at
      FROM catalog_sync_runs WHERE supplier_slug = $1 ORDER BY id DESC LIMIT 1
    `, [supplier]);

    const data = {
      supplier,
      ...summary.rows[0],
      cottonBurgundy151To200: {
        count: combination.rows[0].count,
        sampleCodes: (combination.rows[0].sample_codes || []).slice(0, 20)
      },
      lastSync: lastRun.rows[0] || null
    };
    console.log(JSON.stringify(data, null, 2));

    const failures = [];
    if (data.live_skus !== data.search_view_skus) failures.push('materialized view row count does not match live products');
    if (data.missing_sell_price) failures.push(`${data.missing_sell_price} live SKUs have no sell price`);
    if (data.missing_image) failures.push(`${data.missing_image} live SKUs have no image`);
    if (data.lastSync && data.lastSync.status !== 'complete') failures.push(`last sync status is ${data.lastSync.status}`);
    if (failures.length) throw new Error(failures.join('; '));
    console.log('CATALOG_VERIFY_OK');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`CATALOG_VERIFY_FAILED ${error.message}`);
  process.exit(1);
});
