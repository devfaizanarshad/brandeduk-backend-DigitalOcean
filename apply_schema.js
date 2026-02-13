const { pool } = require('./config/database');
const fs = require('fs');
const path = require('path');

async function runSql() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'CREATE_MARKUP_OVERRIDES.sql'), 'utf8');
        await pool.query(sql);
        console.log('Successfully created product_markup_overrides table');
    } catch (err) {
        console.error('Failed to create table:', err.message);
    } finally {
        process.exit(0);
    }
}

runSql();
