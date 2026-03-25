const fs = require('fs');
const file = 'e:\\Branded_Uk_E-commerce_Backend_API\\uneek_products_clean.json';
const baseCodes = ['UC901', 'UC902', 'UC903', 'UC904', 'UC906'];

const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const relatedResults = data.filter(item => {
    return baseCodes.some(base => item.ProductCode && item.ProductCode.startsWith(base));
});

const pricingMap = {};

relatedResults.forEach(item => {
    if (item.PriceCaton > 0 || item.PriceSingle > 0) {
        const base = baseCodes.find(b => item.ProductCode.startsWith(b));
        if (!pricingMap[base]) {
            pricingMap[base] = {
                carton: item.PriceCaton,
                single: item.PriceSingle,
                pack: item.PricePack,
                sourceCode: item.ProductCode
            };
        }
    }
    console.log(`Matched Style: ${item.ProductCode} | SKU: ${item.ShortCode} | Carton: ${item.PriceCaton} | Single: ${item.PriceSingle}`);
});

console.log("\n--- Suggested Pricing Map ---");
console.log(JSON.stringify(pricingMap, null, 2));
