const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'brandeduk_ralawise_backup',
  user: 'postgres',
  password: '1234',
  ssl: false
});

async function runGlobalReprice() {
  try {
    console.log('--- Triggering Global Reprice based on Unified Carton Prices ---');

    const query = `
      UPDATE products p
      SET 
        sell_price = ROUND(
          COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
          * (1 + (
              COALESCE(
                (SELECT markup_percent / 100 FROM product_markup_overrides pmo WHERE pmo.style_code = p.style_code),
                (
                  SELECT markup_percent / 100
                  FROM pricing_rules r
                  WHERE r.active = true
                    AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
                        BETWEEN r.from_price AND r.to_price
                  ORDER BY r.from_price
                  LIMIT 1
                )
              )
          )), 2
        ),
        pricing_version = COALESCE(
          (SELECT 'OVERRIDE' FROM product_markup_overrides pmo WHERE pmo.style_code = p.style_code),
          (
            SELECT version 
            FROM pricing_rules r 
            WHERE r.active = true 
            ORDER BY version DESC, from_price ASC
            LIMIT 1
          )
        ),
        last_priced_at = NOW()
      WHERE COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) IS NOT NULL
    `;

    console.log('Executing update query...');
    const result = await pool.query(query);
    console.log(`Successfully repriced ${result.rowCount} products.`);

    console.log('Refreshing materialized view...');
    await pool.query('REFRESH MATERIALIZED VIEW product_search_mv;');
    console.log('Materialized view refreshed.');

    console.log('--- Job Complete ---');

  } catch (err) {
    console.error('Repricing failed:', err);
  } finally {
    await pool.end();
  }
}

runGlobalReprice();
