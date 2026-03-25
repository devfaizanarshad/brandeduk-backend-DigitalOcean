const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});
async function check() {
    const res = await pool.query("SELECT pid, state, query, now() - query_start as duration FROM pg_stat_activity WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%';");
    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
}
check();
