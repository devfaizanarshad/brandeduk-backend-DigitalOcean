const { pool } = require('../config/database');

async function main() {
    for (const view of ['product_search_materialized', 'product_search_mv']) {
        const r = await pool.query(`
      SELECT a.attname AS column_name, 
             pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
      JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
      WHERE c.relname = $1 AND n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `, [view]);
        console.log(`\n=== ${view} (${r.rows.length} columns) ===`);
        r.rows.forEach(x => console.log(`  ${x.column_name.padEnd(28)} ${x.data_type}`));
    }
    pool.end();
}
main().catch(e => { console.error(e); pool.end(); });
