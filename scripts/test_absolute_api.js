/**
 * Test Absolute Apparel API connectivity and auth
 */

const API_KEY = '1166.cf81901776df49efb39a84cd63f04dea';

async function testEndpoint(baseUrl, endpoint) {
    const url = `${baseUrl}${endpoint}`;
    console.log(`\nTesting: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
        });

        console.log(`  Status: ${response.status} ${response.statusText}`);
        console.log(`  Headers:`, Object.fromEntries(response.headers.entries()));

        const text = await response.text();
        console.log(`  Body (first 1000 chars): ${text.substring(0, 1000)}`);

        return { status: response.status, body: text };
    } catch (err) {
        console.log(`  Error: ${err.message}`);
        return null;
    }
}

async function main() {
    console.log('=== Absolute Apparel API Test ===\n');

    // Test different base URLs - the docs show two different ones
    // In the guide: https://www.absoluteapparel.co.uk/api/v2/
    // In the sample code: https://www.absoluteapparel.co.uk/aaapi/

    const baseUrls = [
        'https://www.absoluteapparel.co.uk/api/v2/',
        'https://www.absoluteapparel.co.uk/aaapi/',
    ];

    for (const baseUrl of baseUrls) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Base URL: ${baseUrl}`);
        console.log('='.repeat(60));

        await testEndpoint(baseUrl, 'GetDate');
        await testEndpoint(baseUrl, 'getdate');
    }
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
