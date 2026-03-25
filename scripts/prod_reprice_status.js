const { Pool } = require('pg');

const pool = new Pool({
    host: '206.189.119.150',
    port: 5432,
    database: 'brandeduk_prod',
    user: 'brandeduk',
    password: 'omglol123',
    ssl: { rejectUnauthorized: false }
});

async function check() {
    const res = await pool.query("SELECT COUNT(*) as count FROM products WHERE last_priced_at > NOW() - INTERVAL '30 minutes';");
    console.log(`Products repriced in last 30 mins: ${res.rows[0].count} / 135637`);

    const queryCheck = await pool.query("SELECT pid, state, query, now() - query_start as duration FROM pg_stat_activity WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%';");
    console.log("Current DB Query:", JSON.stringify(queryCheck.rows, null, 2));

    await pool.end();
}
check();
