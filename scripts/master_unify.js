console.error("DEPRECATED: This script flattens variant pricing. Do not use.");
process.exit(1);

const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});

async function masterUnify() {
    try {
        console.log('--- Starting Master Pricing Unification ---');

        // 1. Get all styles that have ANY inconsistency or missing data
        // We'll just process ALL styles that have variations or zeros to be safe.
        const problematicStylesQuery = `
      SELECT style_code 
      FROM products 
      GROUP BY style_code 
      HAVING COUNT(DISTINCT carton_price) > 1 
         OR COUNT(DISTINCT sell_price) > 1
         OR MIN(COALESCE(carton_price, 0)) = 0
         OR MIN(COALESCE(sell_price, 0)) = 0;
    `;

        const styleRes = await pool.query(problematicStylesQuery);
        console.log(`Found ${styleRes.rows.length} styles with inconsistencies or zero prices.`);

        for (const style of styleRes.rows) {
            const { style_code } = style;

            // Find the best carton_price (most common non-zero)
            const bestCartonRes = await pool.query(`
        SELECT carton_price, COUNT(*) as freq
        FROM products
        WHERE style_code = $1 AND carton_price > 0 AND carton_price IS NOT NULL
        GROUP BY carton_price
        ORDER BY freq DESC, carton_price ASC
        LIMIT 1
      `, [style_code]);

            // Find the best sell_price (most common non-zero)
            const bestSellRes = await pool.query(`
        SELECT sell_price, COUNT(*) as freq
        FROM products
        WHERE style_code = $1 AND sell_price > 0 AND sell_price IS NOT NULL
        GROUP BY sell_price
        ORDER BY freq DESC, sell_price ASC
        LIMIT 1
      `, [style_code]);

            const bestCarton = bestCartonRes.rows[0]?.carton_price;
            const bestSell = bestSellRes.rows[0]?.sell_price;

            if (bestCarton || bestSell) {
                // Update all variants of this style
                const updateFields = [];
                const params = [];
                if (bestCarton) {
                    updateFields.push(`carton_price = $${updateFields.length + 1}`);
                    params.push(bestCarton);
                }
                if (bestSell) {
                    updateFields.push(`sell_price = $${updateFields.length + 1}`);
                    params.push(bestSell);
                }

                params.push(style_code);
                await pool.query(`
          UPDATE products 
          SET ${updateFields.join(', ')}, pricing_version = 'UNIFIED_FINAL', last_priced_at = NOW()
          WHERE style_code = $${params.length}
        `, params);
            }
        }

        console.log('Unification complete. Refreshing Materialized View...');
        // We'll use a direct query with a long timeout for the refresh
        await pool.query('REFRESH MATERIALIZED VIEW product_search_mv;');
        console.log('Materialized view refreshed.');

        console.log('--- Master Unification Finished ---');

    } catch (err) {
        console.error('Master Unification failed:', err);
    } finally {
        await pool.end();
    }
}

masterUnify();
