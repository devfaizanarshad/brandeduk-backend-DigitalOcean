
const { queryWithTimeout } = require('../config/database');

async function debugMV() {
    console.log('--- CHECKING MV FOR "golf polo" ---');

    const res = await queryWithTimeout(`
    SELECT style_code, style_name, brand, sport_slugs
    FROM product_search_mv
    WHERE (style_name ILIKE '%golf%' AND style_name ILIKE '%polo%')
       OR (style_name ILIKE '%polo%' AND 'golf' = ANY(sport_slugs::text[]))
    LIMIT 10
  `, []);

    console.log('Results found:', res.rows.length);
    res.rows.forEach(r => {
        console.log(` - ${r.style_name} [${r.style_code}] (Sport: ${r.sport_slugs})`);
    });

    process.exit(0);
}

debugMV().catch(err => {
    console.error(err);
    process.exit(1);
});
