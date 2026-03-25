const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});
async function check() {
    const styles = ['UC901', 'UC902', 'UC903', 'UC904', 'UC906'];
    const res = await pool.query(`
    SELECT 
      p.sku_code, 
      p.style_code, 
      pt.name as product_type,
      sup.name as supplier_name
    FROM products p
    JOIN styles s ON p.style_code = s.style_code
    LEFT JOIN product_types pt ON s.product_type_id = pt.id
    LEFT JOIN suppliers sup ON s.supplier_id = sup.id
    WHERE p.style_code = ANY($1)
    ORDER BY p.style_code, p.sku_code;
  `, [styles]);

    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
}
check();
