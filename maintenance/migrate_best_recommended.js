const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Adding is_best_seller and is_recommended to styles table...');
        await client.query(`
      ALTER TABLE styles 
      ADD COLUMN IF NOT EXISTS is_best_seller BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT false;
    `);
        console.log('Columns added successfully.');

        console.log('Creating indexes for best and recommended styles...');
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_styles_best_seller ON styles(is_best_seller) WHERE is_best_seller = true;
      CREATE INDEX IF NOT EXISTS idx_styles_recommended ON styles(is_recommended) WHERE is_recommended = true;
    `);
        console.log('Indexes created successfully.');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
