// Preserve supplier costs and configured markups; repair stored sell prices per SKU.
// Dry run by default. --apply creates a rollback table before any product update.
require('dotenv').config();
const { pool } = require('../config/database');
const { refreshMaterializedViews } = require('../utils/refreshViews');
(async () => {
  const client = await pool.connect();
  const apply = process.argv.includes('--apply');
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE pricing_rules, product_markup_overrides IN SHARE MODE');
    await client.query(`CREATE TEMP TABLE expected_variant_prices ON COMMIT DROP AS
      SELECT p.id, CASE WHEN cost.value > 0 AND cost.value < 999.99 AND COALESCE(o.markup_percent,r.markup_percent) IS NOT NULL
        THEN ROUND(cost.value * (1+COALESCE(o.markup_percent,r.markup_percent)/100),2) ELSE NULL END AS expected,
        CASE WHEN o.markup_percent IS NOT NULL THEN 'OVERRIDE' ELSE r.version END AS version
      FROM products p
      CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(p.carton_price,0),NULLIF(p.single_price,0)) AS value) cost
      LEFT JOIN product_markup_overrides o ON o.style_code=p.style_code
      LEFT JOIN LATERAL (SELECT version,markup_percent FROM pricing_rules WHERE active=true
        AND cost.value BETWEEN from_price AND to_price ORDER BY from_price DESC LIMIT 1) r ON true
      WHERE p.sku_status='Live'`);
    const counts = await client.query(`SELECT COUNT(*)::int affected,
      COUNT(*) FILTER(WHERE e.expected IS NULL)::int unavailable,
      COUNT(*) FILTER(WHERE p.sell_price<e.expected)::int increases,
      COUNT(*) FILTER(WHERE p.sell_price>e.expected)::int decreases
      FROM products p JOIN expected_variant_prices e ON e.id=p.id WHERE p.sell_price IS DISTINCT FROM e.expected`);
    console.log(JSON.stringify({ apply, ...counts.rows[0] }));
    if (!apply) { await client.query('ROLLBACK'); return; }
    const backup = 'pricing_backup_' + new Date().toISOString().replace(/\D/g,'');
    await client.query(`CREATE TABLE ${backup} AS SELECT p.id,p.sku_code,p.sell_price,p.pricing_version,p.last_priced_at
      FROM products p JOIN expected_variant_prices e ON e.id=p.id WHERE p.sell_price IS DISTINCT FROM e.expected`);
    const changed = await client.query(`UPDATE products p SET sell_price=e.expected,pricing_version=e.version,last_priced_at=NOW()
      FROM expected_variant_prices e WHERE p.id=e.id AND p.sell_price IS DISTINCT FROM e.expected`);
    const check = await client.query(`SELECT COUNT(*)::int mismatches FROM products p JOIN expected_variant_prices e ON p.id=e.id WHERE p.sell_price IS DISTINCT FROM e.expected`);
    if(check.rows[0].mismatches) throw Error('Post-update verification failed; rolling back');
    await client.query('COMMIT');
    console.log(JSON.stringify({ updated:changed.rowCount,backup,mismatches:0 }));
    const views = await refreshMaterializedViews();
    console.log(JSON.stringify({views}));
    if(!views.success)process.exitCode=1;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
