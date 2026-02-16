const { pool } = require('../config/database');

async function checkGolf() {
    try {
        const res = await pool.query("SELECT * FROM style_keywords WHERE name ILIKE '%golf%'");
        console.log('Results for "golf" in style_keywords:', res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}
checkGolf();
