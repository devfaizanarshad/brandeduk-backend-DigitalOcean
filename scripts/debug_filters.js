const { pool } = require('../config/database');
async function run() {
    const r = await pool.query("SELECT name FROM brands WHERE name ILIKE '%adidas%'");
    console.log('Adidas matches:', r.rows);
    const r2 = await pool.query("SELECT name FROM brands WHERE name ILIKE '%under%'");
    console.log('Under matches:', r2.rows);
    pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
