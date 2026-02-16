const { pool } = require('../config/database');
async function main() {
    // Check product_search_mv columns
    const cols = await pool.query("SELECT attname, format_type(atttypid, atttypmod) as type FROM pg_attribute WHERE attrelid = 'product_search_mv'::regclass AND attnum > 0 ORDER BY attnum");
    console.log('=== product_search_mv COLUMNS ===');
    cols.rows.forEach(c => console.log(`  ${c.attname}: ${c.type}`));
    console.log('\nTotal columns:', cols.rows.length);

    // Check product_search_view_type
    try {
        const view = await pool.query("SELECT attname, format_type(atttypid, atttypmod) as type FROM pg_attribute WHERE attrelid = 'product_search_view_type'::regclass AND attnum > 0 ORDER BY attnum");
        console.log('\n=== product_search_view_type COLUMNS ===');
        view.rows.forEach(c => console.log(`  ${c.attname}: ${c.type}`));
        console.log('\nTotal columns:', view.rows.length);
    } catch (e) {
        console.log('product_search_view_type not a table/view');
    }

    pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
