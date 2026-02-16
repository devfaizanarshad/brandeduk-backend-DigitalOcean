const { pool } = require('./config/database');
async function test() {
    try {
        // Find a product type with discontinued products
        const sample = await pool.query(`
      SELECT pt.name as type_name, COUNT(*) 
      FROM products p
      INNER JOIN styles s ON p.style_code = s.style_code
      INNER JOIN product_types pt ON s.product_type_id = pt.id
      WHERE p.sku_status = 'Discontinued'
      GROUP BY pt.name
      LIMIT 1
    `);

        if (sample.rows.length === 0) {
            console.log('No discontinued products found with a product type.');
            return;
        }

        const typeName = sample.rows[0].type_name;
        console.log(`Testing with productType: ${typeName}`);

        // Test the endpoint (simulated via query)
        const normalizedType = typeName.trim().toLowerCase().replace(/[- ]/g, '');
        const testQuery = `
      SELECT p.style_code, pt.name as product_type
      FROM products p
      INNER JOIN styles s ON p.style_code = s.style_code
      INNER JOIN product_types pt ON s.product_type_id = pt.id
      WHERE p.sku_status = 'Discontinued'
      AND LOWER(REPLACE(REPLACE(pt.name, '-', ''), ' ', '')) = $1
      LIMIT 5
    `;

        const result = await pool.query(testQuery, [normalizedType]);
        console.log('Results with filter:');
        console.table(result.rows);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
test();
