const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});
async function check() {
    const styles = await pool.query("SELECT * FROM styles LIMIT 1;");
    const products = await pool.query("SELECT * FROM products LIMIT 1;");
    console.log("Styles columns:", Object.keys(styles.rows[0] || {}));
    console.log("Products columns:", Object.keys(products.rows[0] || {}));
    await pool.end();
}
check();
