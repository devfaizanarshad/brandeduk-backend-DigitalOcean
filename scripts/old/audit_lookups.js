const { pool, queryWithTimeout } = require('../config/database');

async function auditLookups() {
    try {
        console.log('🔍 Auditing Lookup Sets...');

        const [brands, types, sk] = await Promise.all([
            queryWithTimeout('SELECT name FROM brands', []),
            queryWithTimeout('SELECT name FROM product_types', []),
            queryWithTimeout('SELECT name, keyword_type FROM style_keywords', [])
        ]);

        const normalize = (rows) => new Set(rows.map(r => r.name.toLowerCase().trim()));

        const brandsSet = normalize(brands.rows);
        const typesSet = normalize(types.rows);
        const sportsSet = new Set(sk.rows.filter(r => r.keyword_type === 'sport').map(r => r.name.toLowerCase().trim()));

        console.log('\n📌 Total Brands:', brandsSet.size);
        console.log('📌 Total Types:', typesSet.size);
        console.log('📌 Total Sports:', sportsSet.size);

        console.log('\n❓ Is "golf" in Sports?', sportsSet.has('golf'));
        console.log('❓ Is "polo" in Types?', typesSet.has('polo'));
        console.log('❓ Is "polo shirts" in Types?', typesSet.has('polo shirts'));
        console.log('❓ Is "polos" in Types?', typesSet.has('polos'));

        if (typesSet.size > 0) {
            console.log('\n📋 Sample Types (first 10):', Array.from(typesSet).slice(0, 10));
        }

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        pool.end();
    }
}

auditLookups();
