const fs = require('fs');
const results = JSON.parse(fs.readFileSync('e:\\Branded_Uk_E-commerce_Backend_API\\search_results.json', 'utf8'));
results.forEach(item => {
    console.log(`Style: ${item.ProductCode} | SKU: ${item.ShortCode} | Single: ${item.PriceSingle} | Pack: ${item.PricePack} | Carton: ${item.PriceCaton}`);
});
