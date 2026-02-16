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

async function run() {
    const client = await pool.connect();
    try {
        console.log('Adding order columns to styles table...');
        await client.query('ALTER TABLE styles ADD COLUMN IF NOT EXISTS best_seller_order INTEGER DEFAULT 999999');
        await client.query('ALTER TABLE styles ADD COLUMN IF NOT EXISTS recommended_order INTEGER DEFAULT 999999');
        console.log('Success.');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
