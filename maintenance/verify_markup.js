const http = require('http');
const { pool } = require('./config/database');

const BASE_URL = 'http://localhost:3004';
const STYLE_CODE = 'GD067';

function request(options, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        data: data ? JSON.parse(data) : {}
                    });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function verify() {
    try {
        console.log(`--- Verifying Markup Overrides for ${STYLE_CODE} ---`);

        // 1. Get initial state
        console.log('Fetching initial state...');
        const initialRes = await request({
            hostname: 'localhost',
            port: 3004,
            path: `/api/admin/products/${STYLE_CODE}/markup-override`,
            method: 'GET'
        });
        console.log('Initial State:', initialRes.data);

        // 2. Apply markup override (75%)
        console.log('\nApplying 75% markup override...');
        const applyRes = await request({
            hostname: 'localhost',
            port: 3004,
            path: `/api/admin/products/${STYLE_CODE}/markup-override`,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        }, { markup_percent: 75.00 });
        console.log('Apply Result:', applyRes.data);

        // 3. Verify sell_price in DB
        const dbRes = await pool.query(`
      SELECT p.style_code, p.carton_price, p.sell_price, p.pricing_version
      FROM products p
      WHERE p.style_code = $1 AND p.sku_status = 'Live'
      LIMIT 1
    `, [STYLE_CODE]);

        if (dbRes.rows.length > 0) {
            const row = dbRes.rows[0];
            const carton = parseFloat(row.carton_price);
            const sell = parseFloat(row.sell_price);
            const expectedSell = Math.round(carton * 1.75 * 100) / 100;
            console.log(`\nDB Check: Carton=${carton}, Sell=${sell}, Version=${row.pricing_version}`);
            console.log(`Expected Sell: ${expectedSell}`);
            if (sell === expectedSell && row.pricing_version === 'OVERRIDE') {
                console.log('✅ Sell price and version are CORRECT');
            } else {
                console.log('❌ Sell price or version is INCORRECT');
            }
        }

        // 4. Test Bulk Update
        console.log('\nTesting Bulk Update for GD067 (set to 80%)...');
        const bulkRes = await request({
            hostname: 'localhost',
            port: 3004,
            path: '/api/admin/products/bulk-markup-override',
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        }, {
            overrides: [{ style_code: STYLE_CODE, markup_percent: 80.00 }]
        });
        console.log('Bulk Result:', bulkRes.data);

        // 5. Re-verify DB
        const dbRes2 = await pool.query('SELECT sell_price FROM products WHERE style_code = $1 LIMIT 1', [STYLE_CODE]);
        console.log('New Sell Price (Bulk):', dbRes2.rows[0].sell_price);

        // 6. Clean up (Remove override)
        console.log('\nRemoving markup override...');
        const deleteRes = await request({
            hostname: 'localhost',
            port: 3004,
            path: `/api/admin/products/${STYLE_CODE}/markup-override`,
            method: 'DELETE'
        });
        console.log('Delete Result:', deleteRes.data);

        // 7. Final DB check (should revert to global)
        const dbRes3 = await pool.query('SELECT pricing_version FROM products WHERE style_code = $1 LIMIT 1', [STYLE_CODE]);
        console.log('Final Version (should not be OVERRIDE):', dbRes3.rows[0].pricing_version);

    } catch (err) {
        console.error('Verification failed:', err.message);
    } finally {
        process.exit(0);
    }
}

verify();
