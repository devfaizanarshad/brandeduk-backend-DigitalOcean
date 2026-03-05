/**
 * STEP 1.5: PERSISTENT IMAGE FETCH
 * Fetches images for all master products one by one safely.
 * Saves progress to raw_images.json so it can be resumed.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.absoluteapparel.co.uk/api/v2/';
const API_KEY = '1166.cf81901776df49efb39a84cd63f04dea';
const RAW_DIR = path.join(__dirname, '..', 'absolute_raw_data');
const IMAGES_FILE = path.join(RAW_DIR, 'raw_images.json');
const MASTERS_FILE = path.join(RAW_DIR, 'raw_masters.json');

// Delay between calls (2 seconds is very safe)
const DELAY_MS = 2000;

async function apiCall(endpoint) {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
    });

    if (response.status === 474 || response.status === 481) {
        throw new Error('IP_BLOCKED');
    }

    if (!response.ok) return [];
    return response.json();
}

async function main() {
    if (!fs.existsSync(MASTERS_FILE)) {
        console.error('Run fetch_absolute_products.js first!');
        return;
    }

    const masters = JSON.parse(fs.readFileSync(MASTERS_FILE, 'utf8'));
    let imageData = {};

    // Load existing progress if any
    if (fs.existsSync(IMAGES_FILE)) {
        imageData = JSON.parse(fs.readFileSync(IMAGES_FILE, 'utf8'));
        console.log(`Resuming... already have images for ${Object.keys(imageData).length} styles.`);
    }

    console.log(`Starting image fetch for ${masters.length} products...`);
    console.log('Press Ctrl+C at any time to stop. Progress is saved every 5 styles.');

    let count = 0;
    for (const m of masters) {
        if (imageData[m.ID]) continue; // Skip already fetched

        count++;
        process.stdout.write(`[${count}] Fetching images for ${m.StockCode} (ID: ${m.ID})...\r`);

        try {
            const images = await apiCall(`GetMasterImages/${m.ID}`);
            imageData[m.ID] = images.map(img => {
                let fullUrl = img.ImageURL || '';
                if (fullUrl && !fullUrl.startsWith('http')) {
                    fullUrl = `https://www.absoluteapparel.co.uk${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
                }
                return {
                    ...img,
                    FullURL: fullUrl
                };
            });

            // Non-blocking sleep
            await new Promise(r => setTimeout(r, DELAY_MS));

            // Save every 5 successful fetches
            if (count % 5 === 0) {
                fs.writeFileSync(IMAGES_FILE, JSON.stringify(imageData, null, 2));
            }
        } catch (err) {
            if (err.message === 'IP_BLOCKED') {
                console.error('\n\n--- IP BLOCKED AGAIN ---');
                console.log('Progress has been saved. Please change IP and run again later.');
                break;
            }
            console.warn(`\nError fetching ${m.StockCode}: ${err.message}`);
        }
    }

    fs.writeFileSync(IMAGES_FILE, JSON.stringify(imageData, null, 2));
    console.log(`\n\n✓ Process finished. Images stored for ${Object.keys(imageData).length} products.`);
}

main();
