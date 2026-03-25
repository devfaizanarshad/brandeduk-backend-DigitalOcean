const { Pool } = require('pg');

const pool = new Pool({
    host: '206.189.119.150',
    port: 5432,
    database: 'brandeduk_prod',
    user: 'brandeduk',
    password: 'omglol123',
    ssl: { rejectUnauthorized: false }
});

async function check() {
    const res = await pool.query(`
    SELECT 
      sku_code, 
      style_code, 
      carton_price, 
      single_price, 
      sell_price, 
      sku_status
    FROM products 
    WHERE sku_status = 'Live' 
    AND (sell_price <= 0 OR sell_price IS NULL OR carton_price <= 0 OR carton_price IS NULL)
    ORDER BY style_code, sku_code;
  `);
    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
}
check();
