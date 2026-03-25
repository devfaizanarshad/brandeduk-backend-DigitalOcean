const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection for local DB
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'brandeduk_ralawise_backup',
  user: 'postgres',
  password: '1234',
  ssl: false
});

async function unifyCartonPrices() {
  const reportPath = path.join(__dirname, 'carton_price_unification_report.md');
  let report = '# Carton Price Unification Report\n\n';
  report += `Generated on: ${new Date().toLocaleString()}\n`;
  report += `Target: Unifying source CARTON_PRICE across all SKUs\n\n`;

  try {
    console.log('--- Starting Carton Price Unification ---');

    // 1. Identify styles with carton_price variations
    const variationQuery = `
      SELECT style_code, 
             COUNT(DISTINCT carton_price) as price_count,
             MIN(carton_price) as min_carton,
             MAX(carton_price) as max_carton,
             COUNT(*) as total_skus
      FROM products
      GROUP BY style_code
      HAVING COUNT(DISTINCT carton_price) > 1;
    `;
    
    const variations = await pool.query(variationQuery);
    
    if (variations.rows.length === 0) {
      console.log('No styles found with carton_price variations. Base costs are already consistent.');
      report += '## Result: Database is already consistent for carton_price.\n';
      fs.writeFileSync(reportPath, report);
      return;
    }

    console.log(`Found ${variations.rows.length} styles with multiple carton prices. Unifying...`);
    report += `## Summary: Found ${variations.rows.length} styles requiring carton_price unification.\n\n`;
    report += '| Style Code | Old Min Carton | Old Max Carton | New Unified Carton | Total SKUs |\n';
    report += '| :--- | :--- | :--- | :--- | :--- |\n';

    for (const row of variations.rows) {
      const { style_code, min_carton, max_carton, total_skus } = row;

      // 2. Determine canonical carton_price (Most frequent)
      const modeQuery = `
        SELECT carton_price, COUNT(*) as frequency
        FROM products
        WHERE style_code = $1
        GROUP BY carton_price
        ORDER BY frequency DESC, carton_price ASC
        LIMIT 1;
      `;
      const modeResult = await pool.query(modeQuery, [style_code]);
      const canonicalCarton = modeResult.rows[0].carton_price;

      // 3. Update ALL SKUs for this style (Carton Price Only)
      const updateQuery = `
        UPDATE products
        SET carton_price = $1,
            updated_at = NOW()
        WHERE style_code = $2;
      `;
      await pool.query(updateQuery, [canonicalCarton, style_code]);

      report += `| ${style_code} | ${min_carton} | ${max_carton} | **${canonicalCarton}** | ${total_skus} |\n`;
      
      if (variations.rows.indexOf(row) % 100 === 0) {
         console.log(`Progress: ${variations.rows.indexOf(row)}/${variations.rows.length} styles processed...`);
      }
    }

    // Refresh view for API consistency
    console.log('Refreshing view...');
    await pool.query('REFRESH MATERIALIZED VIEW product_search_mv;');

    fs.writeFileSync(reportPath, report);
    console.log(`\nProcess Complete. Detailed report at: ${reportPath}`);

  } catch (err) {
    console.error('Error during carton price unification:', err);
  } finally {
    await pool.end();
  }
}

unifyCartonPrices();
