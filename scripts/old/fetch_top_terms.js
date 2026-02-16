
const { queryWithTimeout } = require('../config/database');

async function getTopTerms() {
    console.log('--- Fetching Top Data for Cache Warming ---');

    // Top 20 Brands by product count
    const brandsRes = await queryWithTimeout(`
    SELECT b.name, COUNT(s.id) as count 
    FROM brands b
    JOIN styles s ON b.id = s.brand_id
    GROUP BY b.id
    ORDER BY count DESC
    LIMIT 20
  `, []);

    // Top 20 Product Types by product count
    const typesRes = await queryWithTimeout(`
    SELECT pt.name, COUNT(s.id) as count 
    FROM product_types pt
    JOIN styles s ON pt.id = s.product_type_id
    GROUP BY pt.id
    ORDER BY count DESC
    LIMIT 20
  `, []);

    console.log('\nTop Brands:', brandsRes.rows.map(r => r.name).join(', '));
    console.log('\nTop Product Types:', typesRes.rows.map(r => r.name).join(', '));

    process.exit(0);
}

getTopTerms().catch(err => console.error(err));
