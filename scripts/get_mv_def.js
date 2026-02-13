const { pool } = require('../config/database');
const fs = require('fs');
async function main() {
    const r = await pool.query("SELECT pg_get_viewdef('product_search_materialized', true) as def");
    fs.writeFileSync('current_mv_def.txt', r.rows[0].def);
    console.log('Written to current_mv_def.txt');

    // Also get product_search_mv definition
    const r2 = await pool.query("SELECT pg_get_viewdef('product_search_mv', true) as def");
    fs.writeFileSync('current_mv2_def.txt', r2.rows[0].def);
    console.log('Written to current_mv2_def.txt');

    pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
