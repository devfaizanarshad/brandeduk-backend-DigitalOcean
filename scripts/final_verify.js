const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'brandeduk_ralawise_backup',
    user: 'postgres',
    password: '1234',
    ssl: false
});

async function finalFixAndVerify() {
    try {
        console.log('--- FINAL FIX FOR BC045 & VERIFICATION ---');

        // 1. Specifically fix BC045 to 2.90
        console.log('Step 1: Fixing BC045 override and product prices to 2.90...');

        // Update or insert the override
        await pool.query(`
      INSERT INTO product_markup_overrides (style_code, markup_percent, updated_at)
      VALUES ('BC045', 94.63, NOW())
      ON CONFLICT (style_code) 
      DO UPDATE SET markup_percent = 94.63, updated_at = NOW();
    `);

        // Update the product table for BC045 (including discontinued)
        await pool.query(`
      UPDATE products 
      SET sell_price = 2.90, 
          pricing_version = 'OVERRIDE', 
          last_priced_at = NOW() 
      WHERE style_code = 'BC045';
    `);
        console.log('BC045 successfully unified to 2.90.');

        // 2. Refresh the view again just in case
        console.log('Step 2: Refreshing view...');
        await pool.query('REFRESH MATERIALIZED VIEW product_search_mv;');

        // 3. Final verification query for ALL styles
        console.log('Step 3: Running final database-wide verification...');
        const verifyQuery = `
      SELECT style_code, 
             COUNT(DISTINCT sell_price) AS price_count,
             MIN(sell_price) AS min_price,
             MAX(sell_price) AS max_price,
             COUNT(*) AS total_skus
      FROM products
      GROUP BY style_code
      HAVING COUNT(DISTINCT sell_price) > 1;
    `;

        const result = await pool.query(verifyQuery);

        if (result.rows.length === 0) {
            console.log('RESULT: 0 inconsistent styles found. SUCCESS!');
        } else {
            console.log(`RESULT: ${result.rows.length} styles STILL have variations.`);
            console.table(result.rows.slice(0, 10)); // Show top 10 if failed
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

finalFixAndVerify();
