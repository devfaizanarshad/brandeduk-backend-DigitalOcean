const { pool } = require('../config/database');

async function main() {
    try {
        // All product-related tables
        const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%product%' ORDER BY table_name");
        console.log('Product-related tables:');
        tables.rows.forEach(c => console.log('  ', c.table_name));

        // Also check styles table (might be the product-level table)
        const styleTables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%style%' OR table_name LIKE '%filter%' OR table_name LIKE '%categor%' OR table_name LIKE '%type%') ORDER BY table_name");
        console.log('\nOther relevant tables:');
        styleTables.rows.forEach(c => console.log('  ', c.table_name));

        // Check product_search_materialized (check definition)
        const mvDef = await pool.query("SELECT definition FROM pg_matviews WHERE matviewname = 'product_search_materialized'");
        if (mvDef.rows.length > 0) {
            console.log('\nproduct_search_materialized definition:');
            console.log(mvDef.rows[0].definition.substring(0, 2000));
        }

        // Check product_search_mv
        const mvDef2 = await pool.query("SELECT definition FROM pg_matviews WHERE matviewname = 'product_search_mv'");
        if (mvDef2.rows.length > 0) {
            console.log('\nproduct_search_mv definition:');
            console.log(mvDef2.rows[0].definition.substring(0, 2000));
        }

        // Check all tables
        const allTables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
        console.log('\n=== ALL TABLES ===');
        allTables.rows.forEach(c => console.log('  ', c.table_name));

        pool.end();
    } catch (e) {
        console.error(e.message);
        pool.end();
    }
}
main();
