const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigration() {
    const migrationPath = path.join(__dirname, '..', 'SEARCH_MIGRATION.sql');

    console.log('📖 Reading migration file...');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    try {
        console.log('🔌 Connecting to database...');
        const client = await pool.connect();

        try {
            console.log('🚀 Executing migration...');
            await client.query('BEGIN');

            // Split by semicolon to handle multiple statements if necessary, 
            // but pg driver can often handle scripts if they don't have complex procedural logic issues.
            // Given the file content, sending it as one block is usually fine for DDL.
            await client.query(sql);

            await client.query('COMMIT');
            console.log('✅ Migration completed successfully!');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('❌ Migration failed:', e);
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('❌ Database connection error:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
