const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function checkIndexes() {
    try {
        const res = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename = 'product_search_mv'");
        console.log('Indexes on product_search_mv:', res.rows.map(r => r.indexname));

        const res2 = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename = 'product_search_materialized'");
        console.log('Indexes on product_search_materialized:', res2.rows.map(r => r.indexname));
    } catch (err) {
        console.error(err.message);
    } finally {
        await pool.end();
    }
}

checkIndexes();
