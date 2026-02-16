
const productService = require('../services/productService');

async function debug() {
    console.log('--- DEBUG: Price Filter with Q ---');

    const filters = {
        q: 'polo',
        priceMin: 4,
        priceMax: 14,
        // Add defaults
        page: 1,
        limit: 24,
        sort: 'newest',
        order: 'DESC'
    };

    try {
        const { items, total, priceRange } = await productService.buildProductListQuery(filters, 1, 24);

        console.log(`Total Found: ${total}`);
        console.log(`Price Range detected: ${JSON.stringify(priceRange)}`);
        console.log(`Items returned: ${items.length}`);
        items.forEach(i => {
            console.log(` - [${i.code}] ${i.name} £${i.price}`);
        });

    } catch (err) {
        console.error('Error:', err);
    }
    process.exit(0);
}

debug();
