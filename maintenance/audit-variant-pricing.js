// Read-only. Run against the production database using its normal environment.
require('dotenv').config();
const { pool } = require('../config/database');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      WITH prices AS (
        SELECT p.style_code, p.sku_code, p.colour_name, p.sell_price,
          COALESCE(NULLIF(p.carton_price,0), NULLIF(p.single_price,0)) AS cost,
          COALESCE(o.markup_percent, r.markup_percent) AS markup,
          ROUND(COALESCE(NULLIF(p.carton_price,0), NULLIF(p.single_price,0)) *
            (1 + COALESCE(o.markup_percent, r.markup_percent)/100), 2) AS expected
        FROM products p
        LEFT JOIN product_markup_overrides o ON o.style_code=p.style_code
        LEFT JOIN LATERAL (
          SELECT markup_percent FROM pricing_rules
          WHERE active=true AND COALESCE(NULLIF(p.carton_price,0),NULLIF(p.single_price,0)) BETWEEN from_price AND to_price
          ORDER BY from_price DESC LIMIT 1
        ) r ON true
        WHERE p.sku_status='Live'
      )
      SELECT COUNT(*)::int AS live_skus,
        COUNT(*) FILTER (WHERE cost IS NULL OR cost<=0 OR cost>=999.99)::int AS invalid_cost,
        COUNT(*) FILTER (WHERE markup IS NULL)::int AS missing_markup,
        COUNT(*) FILTER (WHERE cost>0 AND cost<999.99 AND markup IS NOT NULL AND sell_price IS DISTINCT FROM expected)::int AS stale_sell_prices,
        COUNT(*) FILTER (WHERE cost>0 AND sell_price<cost)::int AS stored_below_cost,
        COUNT(DISTINCT style_code)::int AS styles
      FROM prices
    `);
    const rules = await client.query('SELECT version,from_price,to_price,markup_percent FROM pricing_rules WHERE active=true ORDER BY from_price');
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), summary: rows[0], activeRules: rules.rows }, null, 2));
    await client.query('ROLLBACK');
  } finally { client.release(); await pool.end(); }
})().catch(error => { console.error(error.message); process.exitCode=1; });
