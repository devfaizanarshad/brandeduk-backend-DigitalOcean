console.error("DEPRECATED: This script flattens variant pricing. Do not use.");
process.exit(1);

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// FORCE LOCAL CREDENTIALS AS REQUESTED BY USER
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'brandeduk_ralawise_backup',
    user: 'postgres',
    password: '1234',
    ssl: false // User specified SSL=false
});

async function unifyPricing() {
    const reportPath = path.join(__dirname, 'pricing_unification_report.md');
    let report = '# Comprehensive Pricing Unification Report (LOCAL DB)\n\n';
    report += `Generated on: ${new Date().toLocaleString()}\n`;
    report += `Targeting: ALL SKU statuses (Live, Draft, Inactive, etc.)\n\n`;

    try {
        console.log('--- Starting Comprehensive Pricing Unification on LOCAL ---');
        console.log('DB: brandeduk_ralawise_backup @ localhost');

        // 1. Identify styles with ANY price variations across any status
        console.log('Step 1: Identifying styles with price variations...');
        const variationQuery = `
      SELECT style_code, 
             COUNT(DISTINCT sell_price) as price_count,
             MIN(sell_price) as min_price,
             MAX(sell_price) as max_price,
             COUNT(*) as total_skus
      FROM products
      GROUP BY style_code
      HAVING COUNT(DISTINCT sell_price) > 1;
    `;

        const variations = await pool.query(variationQuery);

        if (variations.rows.length === 0) {
            console.log('No inconsistent styles found in local DB.');
            report += '## Result: Local database is already fully consistent.\n';
            fs.writeFileSync(reportPath, report);
            return;
        }

        console.log(`Found ${variations.rows.length} styles with multiple prices. Unifying...`);
        report += `## Summary: Found ${variations.rows.length} styles requiring unification.\n\n`;
        report += '| Style Code | Old Min | Old Max | New Unified Price | Total SKUs |\n';
        report += '| :--- | :--- | :--- | :--- | :--- |\n';

        for (const row of variations.rows) {
            const { style_code, min_price, max_price, total_skus } = row;

            // 2. Determine canonical price (Most frequent, then lowest if tie)
            const modeQuery = `
        SELECT sell_price, COUNT(*) as frequency
        FROM products
        WHERE style_code = $1
        GROUP BY sell_price
        ORDER BY frequency DESC, sell_price ASC
        LIMIT 1;
      `;
            const modeResult = await pool.query(modeQuery, [style_code]);
            const canonicalPrice = modeResult.rows[0].sell_price;

            // 3. Update ALL SKUs for this style
            const updateQuery = `
        UPDATE products
        SET sell_price = $1, 
            pricing_version = 'UNIFIED', 
            last_priced_at = NOW()
        WHERE style_code = $2;
      `;
            await pool.query(updateQuery, [canonicalPrice, style_code]);

            report += `| ${style_code} | ${min_price} | ${max_price} | **${canonicalPrice}** | ${total_skus} |\n`;

            if (variations.rows.length < 50) {
                console.log(`Unified ${style_code} to ${canonicalPrice}`);
            } else if (variations.rows.indexOf(row) % 100 === 0) {
                console.log(`Progress: ${variations.rows.indexOf(row)}/${variations.rows.length} styles processed...`);
            }
        }

        // 4. Refresh Materialized View
        console.log('Step 2: Refreshing materialized view (product_search_mv)...');
        try {
            await pool.query('REFRESH MATERIALIZED VIEW product_search_mv;');
            console.log('Materialized view refreshed successfully.');
            report += '\n\n**Note:** Materialized view `product_search_mv` was successfully refreshed.';
        } catch (viewErr) {
            console.warn('Warning: Could not refresh materialized view:', viewErr.message);
            report += `\n\n**Warning:** Materialized view refresh failed: ${viewErr.message}`;
        }

        // 5. Final Verification Query
        console.log('Step 3: Running final verification...');
        const verifyResult = await pool.query(variationQuery);
        if (verifyResult.rows.length === 0) {
            console.log('SUCCESS: All SKUs are fully unified (0 inconsistencies).');
            report += '\n\n## Final Status: SUCCESS\nVerification query returned 0 rows with multiple prices.';
        } else {
            console.warn(`FAILURE: ${verifyResult.rows.length} styles still inconsistent.`);
            report += `\n\n## Final Status: FAILED\n${verifyResult.rows.length} styles still inconsistent.`;
        }

        fs.writeFileSync(reportPath, report);
        console.log(`\nProcess Complete. Report saved to: ${reportPath}`);

    } catch (err) {
        console.error('CRITICAL ERROR:', err);
    } finally {
        await pool.end();
    }
}

unifyPricing();
