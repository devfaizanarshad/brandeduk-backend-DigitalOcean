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
    const res = await pool.query("SELECT COUNT(DISTINCT style_code) as count FROM products WHERE pricing_version = 'UNIFIED_PROD';");
    console.log(`Styles Unified so far: ${res.rows[0].count} / 1953`);
    await pool.end();
}
check();
