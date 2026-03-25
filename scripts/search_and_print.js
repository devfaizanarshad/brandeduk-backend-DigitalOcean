const fs = require('fs');
const file = 'e:\\Branded_Uk_E-commerce_Backend_API\\uneek_products_clean.json';
const targetCodes = ['UC901', 'UC902', 'UC903', 'UC904', 'UC906', '901', '902', '903', '904', '906'];

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const found = data.filter(item => {
    return targetCodes.includes(item.ProductCode) || targetCodes.includes(item.ProductCode?.replace('UC', ''));
});

found.forEach(item => {
    console.log(`Style: ${item.ProductCode} | SKU: ${item.ShortCode} | Single: ${item.PriceSingle} | Pack: ${item.PricePack} | Carton: ${item.PriceCaton}`);
});
