const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// PRODUCTION DATABASE CREDENTIALS
const pool = new Pool({
    host: '206.189.119.150',
    port: 5432,
    database: 'brandeduk_prod',
    user: 'brandeduk',
    password: 'omglol123',
    ssl: { rejectUnauthorized: false }
});

async function runDiagnostic() {
    const reportPath = path.join(__dirname, 'prod_price_diagnostic_report.md');
    let report = '# PRODUCTION Pricing Diagnostic Report\n\n';
    report += `Run at: ${new Date().toLocaleString()}\n`;
    report += `Target Database: brandeduk_prod\n\n`;

    try {
        console.log('--- Starting PRODUCTION Deep Pricing Diagnostic ---');

        // 1. Check for Style Price Inconsistency (sell_price)
        console.log('[PROD] Checking for sell_price variations within styles...');
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
        console.log('[PROD] Checking for carton_price variations within styles...');
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
        console.log('[PROD] Checking pricing calculation accuracy...');
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
            report += '✅ sell_price matches calculated markup for all checked Live SKUs.\n\n';
        } else {
            report += `❌ Found ${calcDiscrepancy.rows.length} products where the sell_price is NOT calculated correctly based on your rules/overrides.\n`;
            report += '*(This usually means the markup rules were updated but the products weren\'t repriced)*\n\n';
            report += '| SKU | Style | DB Sell | Expected | Markup % |\n|---|---|---|---|---|\n';
            calcDiscrepancy.rows.slice(0, 20).forEach(r => {
                report += `| ${r.sku_code} | ${r.style_code} | ${r.db_sell} | ${r.expected_sell} | ${r.markup}% |\n`;
            });
            report += '\n';
        }

        // 4. Stale Materialized View Check
        console.log('[PROD] Checking for stale data in materialized view...');
        const staleView = await pool.query(`
      SELECT p.style_code, p.sell_price as db_price, mv.sell_price as mv_price
      FROM (SELECT style_code, MIN(sell_price) as sell_price FROM products WHERE sku_status = 'Live' GROUP BY style_code) p
      JOIN product_search_mv mv ON p.style_code = mv.style_code
      WHERE ABS(p.sell_price - mv.sell_price) > 0.01
      LIMIT 100;
    `);

        report += '## 4. Materialized View Consistency (Stale Cache)\n';
        if (staleView.rows.length === 0) {
            report += '✅ Search View (product_search_mv) is perfectly in sync with the live products table.\n\n';
        } else {
            report += `❌ Found ${staleView.rows.length} styles where the Keyword Search price is STALE (wrong) compared to the actual database price.\n\n`;
            report += '| Style | Database Price | Search View Price |\n|---|---|---|\n';
            staleView.rows.slice(0, 20).forEach(r => {
                report += `| ${r.style_code} | ${r.db_price} | ${r.mv_price} |\n`;
            });
            report += '\n';
        }

        // 5. Missing or Zero Prices
        console.log('[PROD] Checking for missing or zero prices...');
        const missingPrices = await pool.query(`
      SELECT count(*) as count
      FROM products
      WHERE sku_status = 'Live' AND (sell_price <= 0 OR sell_price IS NULL OR carton_price <= 0 OR carton_price IS NULL);
    `);

        report += '## 5. Critical Price Issues (Zeros/Missing)\n';
        if (parseInt(missingPrices.rows[0].count) === 0) {
            report += '✅ All Live products have valid prices.\n\n';
        } else {
            report += `❌ Found **${missingPrices.rows[0].count} Live products** that have £0.00 or NULL prices. This is a critical issue causing free items on the store.\n\n`;
        }

        fs.writeFileSync(reportPath, report);
        console.log(`[PROD] Diagnostic complete. Report saved to ${reportPath}`);

    } catch (err) {
        console.error('[PROD] Diagnostic failed:', err);
    } finally {
        await pool.end();
    }
}

runDiagnostic();
