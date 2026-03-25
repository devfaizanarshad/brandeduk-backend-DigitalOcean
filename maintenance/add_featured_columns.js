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
        console.log('Adding featured columns to styles table...');
        await client.query('ALTER TABLE styles ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false');
        await client.query('ALTER TABLE styles ADD COLUMN IF NOT EXISTS featured_order INTEGER DEFAULT 999999');
        
        console.log('Updating product_flags table if necessary...');
        // In case they want to use flags instead of columns in the future, 
        // but currently the system uses columns in 'styles' table for best_seller and recommended.
        
        console.log('Success.');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
