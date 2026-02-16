/**
 * Verification script for Custom Price Break Ranges
 * Tests the ability to replace global tiers with entirely custom quantity ranges for specific products.
 */
const http = require('http');

const BASE = 'http://localhost:3004';

function api(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE);
        const options = {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {}
        };
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTest() {
    console.log('--- CUSTOM PRICE BREAK RANGE VERIFICATION ---\n');

    // 1. Get a product to test with (e.g., GD001 or find one)
    console.log('1. Fetching a product to test...');
    const searchRes = await api('GET', '/api/products?limit=1');
    if (!searchRes.body.items || searchRes.body.items.length === 0) {
        console.error('No products found in database to test.');
        return;
    }
    const product = searchRes.body.items[0];
    const styleCode = product.code;
    console.log(`Testing with product: ${styleCode} (Current price: £${product.price})`);
    console.log(`Default Price Breaks count: ${product.priceBreaks.length}`);

    // 2. Fetch current overrides (should be empty if new)
    console.log(`\n2. Fetching current overrides for ${styleCode}...`);
    const currentRes = await api('GET', `/api/admin/products/${styleCode}/price-overrides`);
    console.log(`Has overrides: ${currentRes.body.has_overrides}`);
    console.log(`Global tiers count: ${currentRes.body.global_tiers.length}`);

    // 3. Set custom ranges (ranges that DON'T match global ones)
    // Global: 1-9, 10-24, 25-49, 50-99, 100-249, 250+
    // Custom: 1-15 (0%), 15-55 (25%)
    console.log('\n3. Setting CUSTOM ranges: 1-15 (0%) and 15-55 (25%)...');
    const customTiers = [
        { min_qty: 1, max_qty: 15, discount_percent: 0 },
        { min_qty: 15, max_qty: 55, discount_percent: 25 }
    ];

    const updateRes = await api('PUT', `/api/admin/products/${styleCode}/price-overrides`, {
        overrides: customTiers,
        replaceAll: true
    });
    console.log(`Update response: ${updateRes.body.message}`);

    // 4. Verify in Product Details API
    console.log('\n4. Verifying effective price breaks in search results...');
    // We search specifically for this product
    const verifyRes = await api('GET', `/api/products?q=${styleCode}`);
    const updatedProduct = verifyRes.body.items.find(i => i.code === styleCode);

    if (updatedProduct) {
        console.log(`Updated Price Breaks count: ${updatedProduct.priceBreaks.length}`);
        updatedProduct.priceBreaks.forEach((pb, i) => {
            console.log(`Tier ${i + 1}: ${pb.min}-${pb.max} @ £${pb.price} (${pb.percentage}%)`);
        });

        const match = updatedProduct.priceBreaks.length === 2 &&
            updatedProduct.priceBreaks[1].min === 15 &&
            updatedProduct.priceBreaks[1].max === 55;

        if (match) {
            console.log('\n✅ SUCCESS: Custom ranges applied and completely replaced global tiers.');
        } else {
            console.log('\n❌ FAILED: Price breaks do not match custom structure.');
        }
    } else {
        console.log('\n❌ FAILED: Could not find product in search results.');
    }

    // 5. Cleanup (optional - remove overrides)
    console.log('\n5. Cleaning up (removing overrides)...');
    await api('DELETE', `/api/admin/products/${styleCode}/price-overrides`);
    console.log('Overrides removed.');
}

runTest().catch(console.error);
