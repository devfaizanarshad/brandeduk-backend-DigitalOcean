const http = require('http');

const PORT = 3004;

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: `/api/pricing${path}`,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 60000 // 60s timeout
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log(`--- Testing Pricing Endpoints on port ${PORT} ---`);

    // 1. Test Calculate
    console.log('\n1. Testing Calculate Endpoint...');
    try {
        const calcRes = await request('POST', '/calculate', { carton_price: 30.00 });
        console.log('Status:', calcRes.status);
        console.log('Response:', JSON.stringify(calcRes.data, null, 2));
    } catch (err) {
        console.error(`Calculate failed: ${err.code || err.message}`);
    }

    // 2. Test Update (using TS005)
    const TEST_STYLE = 'TS005';
    const NEW_PRICE = 30.00;
    const OLD_PRICE = 23.00;

    console.log(`\n2. Testing Update Endpoint for ${TEST_STYLE} to ${NEW_PRICE}...`);
    try {
        const updateRes = await request('PUT', `/products/${TEST_STYLE}/carton-price`, { carton_price: NEW_PRICE });
        console.log('Status:', updateRes.status);
        console.log('Response:', JSON.stringify(updateRes.data, null, 2));
    } catch (err) {
        console.error(`Update failed: ${err.code || err.message}`);
    }

    // 3. Revert
    console.log(`\n3. Reverting ${TEST_STYLE} to ${OLD_PRICE}...`);
    try {
        const revertRes = await request('PUT', `/products/${TEST_STYLE}/carton-price`, { carton_price: OLD_PRICE });
        console.log('Status:', revertRes.status);
        console.log('Response:', JSON.stringify(revertRes.data, null, 2));
    } catch (err) {
        console.error(`Revert failed: ${err.code || err.message}`);
    }
}

runTests();
