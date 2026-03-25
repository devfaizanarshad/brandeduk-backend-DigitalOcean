const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});

const pricingMap = {
    "UC901": { carton: 6.70, single: 7.70, pack: 7.15 },
    "UC902": { carton: 7.20, single: 8.20, pack: 7.65 },
    "UC903": { carton: 9.35, single: 10.65, pack: 9.95 },
    "UC904": { carton: 7.95, single: 9.05, pack: 8.45 },
    "UC906": { carton: 13.85, single: 15.75, pack: 14.7 }
};

async function applyFix() {
    try {
        console.log('--- Applying Related Style Prices for UC90x Series ---');

        for (const [styleCode, prices] of Object.entries(pricingMap)) {
            console.log(`Processing Style: ${styleCode} with base carton price: £${prices.carton}`);

            // Update base prices first
            await pool.query(`
        UPDATE products 
        SET 
          carton_price = $1, 
          single_price = $2, 
          pack_price = $3,
          pricing_version = 'RECOVERED_FROM_VARIANTS',
          last_priced_at = NOW()
        WHERE style_code = $4 
        AND (carton_price IS NULL OR carton_price = 0)
      `, [prices.carton, prices.single, prices.pack, styleCode]);

            // Now trigger reprice for these products to set sell_price correctly
            const updateSellPriceQuery = `
        UPDATE products p
        SET 
          sell_price = ROUND(
            p.carton_price * (1 + (
                COALESCE(
                  (SELECT markup_percent / 100 FROM product_markup_overrides pmo WHERE pmo.style_code = p.style_code),
                  (
                    SELECT markup_percent / 100
                    FROM pricing_rules r
                    WHERE r.active = true
                      AND p.carton_price BETWEEN r.from_price AND r.to_price
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
          )
        WHERE p.style_code = $1
      `;

            const res = await pool.query(updateSellPriceQuery, [styleCode]);
            console.log(`Updated ${res.rowCount} variants for ${styleCode}`);
        }

        console.log('Refreshing Materialized View...');
        await pool.query('REFRESH MATERIALIZED VIEW product_search_mv;');
        console.log('--- Fix Complete ---');

    } catch (err) {
        console.error('Fix failed:', err);
    } finally {
        await pool.end();
    }
}

applyFix();
