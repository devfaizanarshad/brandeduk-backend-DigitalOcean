const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'brandeduk_ralawise_backup',
  user: 'postgres',
  password: '1234',
  ssl: false
});
async function verify() {
  const products = await pool.query("SELECT style_code, sku_code, carton_price, sell_price, pricing_version FROM products WHERE style_code = 'BC045' LIMIT 5;");
  console.log(JSON.stringify(products.rows, null, 2));
  await pool.end();
}
verify();
