const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});
async function check() {
    const res = await pool.query("SELECT sku_code, style_code, carton_price, single_price, sell_price, sku_status FROM products WHERE sku_status = 'Live' AND (sell_price <= 0 OR sell_price IS NULL OR carton_price <= 0 OR carton_price IS NULL);");
    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
}
check();
