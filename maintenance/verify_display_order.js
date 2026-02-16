const API_URL = 'http://localhost:3004/api';

async function runTest() {
    try {
        console.log('Starting verification...');

        // Helper for API calls
        const apiCall = async (method, path, body = null, params = null) => {
            let url = `${API_URL}${path}`;
            if (params) {
                url += '?' + new URLSearchParams(params).toString();
            }

            const options = {
                method,
                headers: { 'Content-Type': 'application/json' }
            };

            if (body) options.body = JSON.stringify(body);

            const res = await fetch(url, options);
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`API Error ${res.status}: ${text}`);
            }
            return res.json();
        };

        // 1. Clear existing orders
        try { await apiCall('DELETE', '/display-order/by-context', { style_code: 'YP047', brand_id: 28 }); } catch (e) { }
        try { await apiCall('DELETE', '/display-order/by-context', { style_code: 'YP049', brand_id: 28 }); } catch (e) { }

        // 2. Set Display Order: YP047 -> 1, YP049 -> 2 (Context: Brand 28)
        console.log('Setting display order for Brand 28...');
        await apiCall('POST', '/display-order', {
            style_code: 'YP047',
            brand_id: 28,
            display_order: 1
        });

        await apiCall('POST', '/display-order', {
            style_code: 'YP049',
            brand_id: 28,
            display_order: 2
        });

        // 3. Verify Brand Search
        console.log('Verifying Brand Search (Flexfit)...');
        const brandResponse = await apiCall('GET', '/products', null, { brand: 'flexfit-by-yupoong', limit: 5 });

        const items = brandResponse.items;
        const codes = items.map(i => i.code);
        console.log('Returned codes:', codes);

        if (codes[0] === 'YP047' && codes[1] === 'YP049') {
            console.log('SUCCESS: Brand order verified.');
        } else {
            console.error('FAILURE: Brand order incorrect.');
        }

        // 4. Set Product Type Order: YP049 -> 1 (Context: Type 21 Caps)
        console.log('Setting display order for Type 21...');
        await apiCall('POST', '/display-order', {
            style_code: 'YP049',
            product_type_id: 21,
            display_order: 1
        });
        await apiCall('POST', '/display-order', {
            style_code: 'YP047',
            product_type_id: 21,
            display_order: 2
        });

        // 5. Verify Type Search
        console.log('Verifying Type Search (Caps)...');
        const typeResponse = await apiCall('GET', '/products', null, { productType: 'caps', limit: 5 });

        const typeCodes = typeResponse.items.map(i => i.code);
        console.log('Returned codes:', typeCodes);

        if (typeCodes[0] === 'YP049' && typeCodes[1] === 'YP047') {
            console.log('SUCCESS: Type order verified.');
        } else {
            console.error('FAILURE: Type order incorrect.');
        }

        console.log('Verification Complete.');

    } catch (error) {
        console.error('Test Failed:', error.message);
    }
}

runTest();
