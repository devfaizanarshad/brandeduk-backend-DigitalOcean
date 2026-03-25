const fs = require('fs');
const file = 'e:\\Branded_Uk_E-commerce_Backend_API\\uneek_products_clean.json';

const targetCodes = ['UC901', 'UC902', 'UC903', 'UC904', 'UC906', '901', '902', '903', '904', '906'];

async function search() {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const found = data.filter(item => {
        return targetCodes.includes(item.ProductCode) || targetCodes.includes(item.ProductCode?.replace('UC', ''));
    });
    console.log(JSON.stringify(found, null, 2));
}

search().catch(err => console.error(err));
