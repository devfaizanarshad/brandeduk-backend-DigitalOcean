const { pool } = require('./config/database');

async function checkFlags() {
    try {
        const res = await pool.query('SELECT * FROM special_flags');
        console.log('Special Flags:', res.rows);
        const res2 = await pool.query('SELECT * FROM product_flags LIMIT 5');
        console.log('Product Flags Sample:', res2.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

checkFlags();
