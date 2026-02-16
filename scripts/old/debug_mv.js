const { pool } = require('../config/database');

async function debugMV() {
    try {
        const styleCode = 'CW035';
        console.log(`Checking MV for style ${styleCode}...`);

        const res = await pool.query(
            "SELECT style_code, style_name, product_type, sport_slugs FROM product_search_materialized WHERE style_code = $1",
            [styleCode]
        );

        if (res.rows.length === 0) {
            console.log('Style not found in MV!');
        } else {
            console.log('Row:', res.rows[0]);
        }

        // Check if 'golf' works in any sport_slugs
        const golfCount = await pool.query("SELECT COUNT(*) FROM product_search_materialized WHERE 'golf' = ANY(sport_slugs)");
        console.log("Total rows with 'golf' in sport_slugs:", golfCount.rows[0].count);

        // Check distinct sport_slugs values
        const distinctSports = await pool.query("SELECT DISTINCT unnest(sport_slugs) as sport FROM product_search_materialized ORDER BY sport");
        console.log("Distinct sports in MV:", distinctSports.rows.map(r => r.sport));

        pool.end();
    } catch (e) {
        console.error(e.message);
        pool.end();
    }
}

debugMV();
