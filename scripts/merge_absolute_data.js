/**
 * STEP 2: LOCAL MERGE (With Images)
 * This script runs locally. It takes the raw files (Masters, SKUs, and Images)
 * and merges them into absolute_products_clean.json.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'absolute_raw_data');
const OUTPUT_FILE = path.join(__dirname, '..', 'absolute_products_clean.json');

function main() {
    console.log('--- Merging Absolute Apparel Data (Including Images) ---');

    const mastersPath = path.join(DATA_DIR, 'raw_masters.json');
    const skusPath = path.join(DATA_DIR, 'raw_skus.json');
    const imagesPath = path.join(DATA_DIR, 'raw_images.json');

    if (!fs.existsSync(mastersPath) || !fs.existsSync(skusPath)) {
        console.error('Error: Required raw files not found. Run fetch_absolute_products.js first.');
        return;
    }

    const masters = JSON.parse(fs.readFileSync(mastersPath, 'utf8'));
    const skus = JSON.parse(fs.readFileSync(skusPath, 'utf8'));

    // Load images if they exist
    let imagesByMaster = {};
    if (fs.existsSync(imagesPath)) {
        imagesByMaster = JSON.parse(fs.readFileSync(imagesPath, 'utf8'));
        console.log(`✓ Found image data for ${Object.keys(imagesByMaster).length} products.`);
    } else {
        console.log('⚠ Warning: No raw_images.json found. Products will have empty image lists.');
    }

    console.log(`Processing ${masters.length} styles and ${skus.length} SKUs...`);

    const products = masters.map(m => {
        // Find all SKUs that belong to this style
        const childSkus = skus.filter(s => s.StockCode && s.StockCode.startsWith(m.StockCode + '-'));

        return {
            Company: 'Absolute Apparel',
            Category: m.Category,
            ProductCode: m.StockCode,
            ProductName: m.Description,
            Manufacturer: m.Manufacturer || 'Absolute Apparel',
            KeyFeatures: m.KeyFeatures || [],
            Images: (imagesByMaster[m.ID] || []).map(img => img.FullURL || img.ImageURL),
            SKUs: childSkus.map(s => ({
                SKUID: s.ID,
                StockCode: s.StockCode,
                Colour: s.ColourName,
                Size: s.SizeName,
                Price: s.Price,
                RRP: s.RRP,
                Stock: s.TotalStock,
                LocalStock: s.LocalStock,
                BarCode: s.BarCode,
                Discontinued: s.Discontinued
            }))
        };
    });

    const finalOutput = {
        _metadata: {
            generatedAt: new Date().toISOString(),
            totalProducts: products.length,
            totalSKUs: skus.length,
            withImages: Object.keys(imagesByMaster).length
        },
        products: products
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2));
    console.log(`\n✓ SUCCESS! Merged file saved to ${OUTPUT_FILE}`);
}

main();
