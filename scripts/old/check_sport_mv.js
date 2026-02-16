/**
 * Verify product_search_mv sport_slugs vs product_search_materialized sport_slugs
 */
const { pool } = require('../config/database');

async function check() {
    // product_search_mv sport_slugs
    const mv2Sports = await pool.query("SELECT COUNT(*) as c FROM product_search_mv WHERE sport_slugs IS NOT NULL AND array_length(sport_slugs, 1) > 0");
    console.log('product_search_mv rows with sport_slugs:', mv2Sports.rows[0].c);

    // product_search_materialized sport_slugs
    const psmSports = await pool.query("SELECT COUNT(*) as c FROM product_search_materialized WHERE sport_slugs IS NOT NULL AND array_length(sport_slugs, 1) > 0");
    console.log('product_search_materialized rows with sport_slugs:', psmSports.rows[0].c);

    // Sample from mv2
    const sample = await pool.query("SELECT DISTINCT unnest(sport_slugs) as sport FROM product_search_mv WHERE sport_slugs IS NOT NULL LIMIT 20");
    console.log('Sport slugs values in MV2:', sample.rows.map(r => r.sport));

    // Check what productService.js actually references
    // The viewAlias 'psm' could reference either MV depending on FROM clause
    // Let's check the actual query
    console.log('\nproductService sport filter uses:');
    console.log('  psm.sport_slugs && $N::text[]');
    console.log('  If psm = product_search_mv → WORKS (has sport data)');
    console.log('  If psm = product_search_materialized → BROKEN (sport_slugs always NULL)');

    pool.end();
}
check().catch(e => { console.error(e.message); pool.end(); });
