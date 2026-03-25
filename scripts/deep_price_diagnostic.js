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

async function runDiagnostic() {
    const reportPath = path.join(__dirname, 'deep_price_diagnostic_report.md');
    let report = '# Deep Pricing Diagnostic Report\n\n';
    report += `Run at: ${new Date().toLocaleString()}\n\n`;

    try {
        console.log('--- Starting Deep Pricing Diagnostic ---');

        // 1. Check for Style Price Inconsistency (sell_price)
        console.log('Checking for sell_price variations within styles...');
        const sellPriceInconsistency = await pool.query(`
      SELECT style_code, COUNT(DISTINCT sell_price) as price_count, MIN(sell_price) as min_p, MAX(sell_price) as max_p
      FROM products
      WHERE sku_status = 'Live'
      GROUP BY style_code
      HAVING COUNT(DISTINCT sell_price) > 1
      LIMIT 100;
    `);

        report += '## 1. Style Inconsistency (sell_price)\n';
        if (sellPriceInconsistency.rows.length === 0) {
            report += '✅ All Live SKUs in each style have unified sell prices.\n\n';
        } else {
            report += `❌ Found ${sellPriceInconsistency.rows.length} styles with multiple sell prices.\n`;
            report += '| Style | Price Count | Min | Max |\n|---|---|---|---|\n';
            sellPriceInconsistency.rows.slice(0, 20).forEach(r => {
                report += `| ${r.style_code} | ${r.price_count} | ${r.min_p} | ${r.max_p} |\n`;
            });
            report += '\n';
        }

        // 2. Check for Style Inconsistency (carton_price)
        console.log('Checking for carton_price variations within styles...');
        const cartonPriceInconsistency = await pool.query(`
      SELECT style_code, COUNT(DISTINCT carton_price) as count, MIN(carton_price) as min_c, MAX(carton_price) as max_c
      FROM products
      WHERE sku_status = 'Live'
      GROUP BY style_code
      HAVING COUNT(DISTINCT carton_price) > 1
      LIMIT 100;
    `);

        report += '## 2. Style Inconsistency (carton_price)\n';
        if (cartonPriceInconsistency.rows.length === 0) {
            report += '✅ All Live SKUs in each style have unified carton prices.\n\n';
        } else {
            report += `❌ Found ${cartonPriceInconsistency.rows.length} styles with multiple carton prices.\n`;
            report += '| Style | Carton Count | Min | Max |\n|---|---|---|---|\n';
            cartonPriceInconsistency.rows.slice(0, 20).forEach(r => {
                report += `| ${r.style_code} | ${r.count} | ${r.min_c} | ${r.max_c} |\n`;
            });
            report += '\n';
        }

        // 3. Price Calculation Accuracy Check
        console.log('Checking pricing calculation accuracy...');
        const calcDiscrepancy = await pool.query(`
      WITH calculated AS (
        SELECT 
          p.sku_code, 
          p.style_code,
          p.sell_price as db_sell,
          p.carton_price,
          COALESCE(
            (SELECT markup_percent FROM product_markup_overrides pmo WHERE pmo.style_code = p.style_code),
            (SELECT markup_percent FROM pricing_rules pr WHERE pr.active = true AND p.carton_price BETWEEN pr.from_price AND pr.to_price ORDER BY from_price LIMIT 1)
          ) as markup
        FROM products p
        WHERE p.sku_status = 'Live' AND p.carton_price > 0
      )
      SELECT *, ROUND((carton_price * (1 + COALESCE(markup,0)/100))::numeric, 2) as expected_sell
      FROM calculated
      WHERE ABS(db_sell - ROUND((carton_price * (1 + COALESCE(markup,0)/100))::numeric, 2)) > 0.01
      LIMIT 100;
    `);

        report += '## 3. Pricing Calculation Accuracy\n';
        if (calcDiscrepancy.rows.length === 0) {
            report += '✅ db_sell matches calculated markup for all checked Live SKUs.\n\n';
        } else {
            report += `❌ Found ${calcDiscrepancy.rows.length} products where db_sell does not match markup rules.\n`;
            report += '| SKU | Style | DB Sell | Expected | Markup % |\n|---|---|---|---|---|\n';
            calcDiscrepancy.rows.slice(0, 20).forEach(r => {
                report += `| ${r.sku_code} | ${r.style_code} | ${r.db_sell} | ${r.expected_sell} | ${r.markup}% |\n`;
            });
            report += '\n';
        }

        // 4. Stale Materialized View Check
        console.log('Checking for stale data in materialized view...');
        const staleView = await pool.query(`
      SELECT p.style_code, p.sell_price as db_price, mv.sell_price as mv_price
      FROM (SELECT style_code, MIN(sell_price) as sell_price FROM products WHERE sku_status = 'Live' GROUP BY style_code) p
      JOIN product_search_mv mv ON p.style_code = mv.style_code
      WHERE ABS(p.sell_price - mv.sell_price) > 0.01
      LIMIT 100;
    `);

        report += '## 4. Materialized View Consistency\n';
        if (staleView.rows.length === 0) {
            report += '✅ product_search_mv is in sync with the products table.\n\n';
        } else {
            report += `❌ Found ${staleView.rows.length} styles where the search view price doesn't match the products table.\n`;
            report += '| Style | Table Price | View Price |\n|---|---|---|\n';
            staleView.rows.slice(0, 20).forEach(r => {
                report += `| ${r.style_code} | ${r.db_price} | ${r.mv_price} |\n`;
            });
            report += '\n';
        }

        // 5. Missing or Zero Prices
        console.log('Checking for missing or zero prices...');
        const missingPrices = await pool.query(`
      SELECT count(*) as count
      FROM products
      WHERE sku_status = 'Live' AND (sell_price <= 0 OR sell_price IS NULL OR carton_price <= 0 OR carton_price IS NULL);
    `);

        report += '## 5. Critical Price Issues\n';
        if (parseInt(missingPrices.rows[0].count) === 0) {
            report += '✅ No Live products have zero or missing prices.\n\n';
        } else {
            report += `❌ Found ${missingPrices.rows[0].count} Live products with zero or missing prices.\n\n`;
        }

        fs.writeFileSync(reportPath, report);
        console.log(`Diagnostic complete. Report saved to ${reportPath}`);

    } catch (err) {
        console.error('Diagnostic failed:', err);
    } finally {
        await pool.end();
    }
}

runDiagnostic();
