const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});
async function check() {
    const res = await pool.query("SELECT sku_code, style_code, carton_price, sell_price, pricing_version, sku_status FROM products WHERE style_code IN ('UC630', 'UC713', 'UC924') ORDER BY style_code, sku_code;");
    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
}
check();
