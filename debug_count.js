const { pool } = require('./config/database');
async function test() {
  try {
    const result = await pool.query(`
      SELECT DISTINCT s.style_code, s.style_name
      FROM products p
      INNER JOIN styles s ON p.style_code = s.style_code
      INNER JOIN product_types pt ON s.product_type_id = pt.id
      WHERE p.sku_status = 'Discontinued'
      AND LOWER(REPLACE(REPLACE(pt.name, '-', ''), ' ', '')) = 'caps'
      ORDER BY s.style_code
    `);
    console.log(`There are ${result.rows.length} style codes in 'caps' category:`);
    result.rows.forEach(r => console.log(`- ${r.style_code}: ${r.style_name}`));

    const skuCount = await pool.query(`
      SELECT COUNT(*)
      FROM products p
      INNER JOIN styles s ON p.style_code = s.style_code
      INNER JOIN product_types pt ON s.product_type_id = pt.id
      WHERE p.sku_status = 'Discontinued'
      AND LOWER(REPLACE(REPLACE(pt.name, '-', ''), ' ', '')) = 'caps'
    `);
    console.log(`Total individual discontinued SKUs in 'caps' category: ${skuCount.rows[0].count}`);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
test();
