const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});
async function cleanup() {
    console.log('--- Cleaning up hung refresh processes ---');
    const res = await pool.query("SELECT pid FROM pg_stat_activity WHERE query LIKE 'REFRESH MATERIALIZED VIEW%';");
    for (const row of res.rows) {
        console.log(`Killing process ${row.pid}...`);
        await pool.query("SELECT pg_terminate_backend($1);", [row.pid]);
    }

    console.log('Wait 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));

    console.log('Starting ONE clean refresh and waiting...');
    const start = Date.now();
    await pool.query('REFRESH MATERIALIZED VIEW product_search_mv;');
    console.log(`Refresh finished in ${(Date.now() - start) / 1000}s`);

    await pool.end();
}
cleanup();
