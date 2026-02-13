const { pool } = require('../config/database');

async function fixSynonyms() {
    try {
        console.log('Fixing synonyms...');

        // 1. "polo" should map to "polos" (the valid product type), not "polo shirt"
        await pool.query("UPDATE search_synonyms SET canonical = 'polos' WHERE term = 'polo' AND synonym_type = 'product_type'");
        await pool.query("UPDATE search_synonyms SET canonical = 'polos' WHERE term = 'polo shirt' AND synonym_type = 'product_type'");
        await pool.query("UPDATE search_synonyms SET canonical = 'polos' WHERE term = 'polo shirts' AND synonym_type = 'product_type'");

        // 2. Ensure "tshirt" maps to "t-shirts" or "tshirts" (checking DB value "T-shirts")
        // Note: normalize() in parser lowercases everything, so "t-shirts" is fine.
        // Let's check what product_types has exactly for T-shirts
        const ts = await pool.query("SELECT name FROM product_types WHERE name LIKE '%shirt%'");
        console.log('Shirt types:', ts.rows.map(r => r.name));

        // If it's "T-shirts", then normalized is "t-shirts".
        // Check current synonyms
        const currentT = await pool.query("SELECT term, canonical FROM search_synonyms WHERE term LIKE 'tshirt%'");
        console.log('Current tshirt synonyms:', currentT.rows);

        console.log('Done.');
        process.exit(0);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}

fixSynonyms();
