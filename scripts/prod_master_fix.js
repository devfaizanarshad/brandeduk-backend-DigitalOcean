console.error("DEPRECATED: This script flattens variant pricing. Do not use.");
process.exit(1);

const { Pool } = require('pg');

const pool = new Pool({
    host: '206.189.119.150',
    port: 5432,
    database: 'brandeduk_prod',
    user: 'brandeduk',
    password: 'omglol123',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 10000,
    max: 10
});

const recoveredPrices = {
    "UC901": { carton: 6.70, single: 7.70, pack: 7.15 },
    "UC902": { carton: 7.20, single: 8.20, pack: 7.65 },
    "UC903": { carton: 9.35, single: 10.65, pack: 9.95 },
    "UC904": { carton: 7.95, single: 9.05, pack: 8.45 },
    "UC906": { carton: 13.85, single: 15.75, pack: 14.7 }
};

async function runProductionUnification() {
    try {
        console.log('--- STARTING PRODUCTION PRICE UNIFICATION & RECOVERY ---');

        // 1. Recover known missing prices first
        console.log('[PROD] Recovering known zero-prices for UC90x series...');
        for (const [styleCode, prices] of Object.entries(recoveredPrices)) {
            await pool.query(`
        UPDATE products 
        SET carton_price = $1, single_price = $2, pack_price = $3, pricing_version = 'RECOVERED'
        WHERE style_code = $4 AND (carton_price IS NULL OR carton_price = 0)
      `, [prices.carton, prices.single, prices.pack, styleCode]);
        }

        // 2. Unify carton_price across ALL styles based on most frequent value
        console.log('[PROD] Identifying styles with inconsistent carton prices...');
        const inconsistentStyles = await pool.query(`
      SELECT style_code 
      FROM products 
      GROUP BY style_code 
      HAVING COUNT(DISTINCT carton_price) > 1;
    `);

        console.log(`[PROD] Found ${inconsistentStyles.rows.length} styles to unify.`);

        for (const row of inconsistentStyles.rows) {
            const style_code = row.style_code;

            const canonicalRes = await pool.query(`
        SELECT carton_price, COUNT(*) as freq
        FROM products
        WHERE style_code = $1 AND carton_price > 0
        GROUP BY carton_price
        ORDER BY freq DESC, carton_price ASC
        LIMIT 1
      `, [style_code]);

            const canonicalPrice = canonicalRes.rows[0]?.carton_price;
            if (canonicalPrice) {
                await pool.query(`
          UPDATE products 
          SET carton_price = $1, pricing_version = 'UNIFIED_PROD'
          WHERE style_code = $2
        `, [canonicalPrice, style_code]);
            }
        }

        // 3. Global Reprice based on Unified Carton Prices & Rules
        console.log('[PROD] Running Global Reprice to calculate sell_price for all products...');
        const repriceQuery = `
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
      WHERE COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) IS NOT NULL;
    `;

        const repriceRes = await pool.query(repriceQuery);
        console.log(`[PROD] Successfully calculated sell_price for ${repriceRes.rowCount} products.`);

        // 4. Final Refresh of Materialized View
        console.log('[PROD] Refreshing Search Index (Materialized View)... This may take 10+ mins.');
        await pool.query('REFRESH MATERIALIZED VIEW product_search_mv;');

        console.log('--- PRODUCTION FIX COMPLETE ---');

    } catch (err) {
        console.error('[PROD] Process failed:', err);
    } finally {
        await pool.end();
    }
}

runProductionUnification();
