/**
 * STEP 1: RAW DATA FETCH
 * This script only makes 3 API calls to get the complete raw data.
 * It saves them as separate files to minimize API interaction.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.absoluteapparel.co.uk/api/v2/';
const API_KEY = '1166.cf81901776df49efb39a84cd63f04dea';
const DATA_DIR = path.join(__dirname, '..', 'absolute_raw_data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

async function apiCall(endpoint) {
    console.log(`  → GET ${endpoint}...`);
    const response = await fetch(`${BASE_URL}${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
    });

    if (!response.ok) throw new Error(`API Error [${response.status}] for ${endpoint}`);
    return response.json();
}

async function main() {
    console.log('--- Fetching Raw Absolute Apparel Data ---');

    try {
        // 1. Categories
        const categories = await apiCall('GetCategories');
        fs.writeFileSync(path.join(DATA_DIR, 'raw_categories.json'), JSON.stringify(categories, null, 2));

        // 2. Master Products (The Style headers)
        const masters = await apiCall('GetMasterProducts');
        fs.writeFileSync(path.join(DATA_DIR, 'raw_masters.json'), JSON.stringify(masters, null, 2));

        // 3. SKUs (The individual variants + stock + price)
        // This is one big call that returns ALL skus
        const skus = await apiCall('GetSKUs');
        fs.writeFileSync(path.join(DATA_DIR, 'raw_skus.json'), JSON.stringify(skus, null, 2));

        console.log(`\n✓ SUCCESS! Raw data saved to ${DATA_DIR}`);
        console.log(`   - Masters: ${masters.length} styles`);
        console.log(`   - SKUs:    ${skus.length} variations`);
        console.log('\nRun "node scripts/merge_absolute_data.js" to combine them.');

    } catch (err) {
        console.error('\n✗ Error:', err.message);
        console.log('If you see 474/481, please wait 30-60 mins for unblock.');
    }
}

main();
