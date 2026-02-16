const { Pool } = require('pg');
require('dotenv').config();

console.log('=== Environment Variables ===');
console.log('DB_HOST:', process.env.DB_HOST || 'localhost (default)');
console.log('DB_PORT:', process.env.DB_PORT || '5432 (default)');
console.log('DB_NAME:', process.env.DB_NAME || 'Branded_UK (default)');
console.log('DB_USER:', process.env.DB_USER || 'postgres (default)');
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '***' : '1234 (default)');
console.log('DB_SSL:', process.env.DB_SSL || 'false (default)');
console.log('');

// Create pool with same config as server
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'Branded_UK',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
  ssl: false, // Force SSL off for localhost check
});

async function checkDatabase() {
  const client = await pool.connect();
  try {
    // Check current database
    const dbInfo = await client.query('SELECT current_database() as db, inet_server_addr() as host, inet_server_port() as port');
    console.log('=== Connected Database Info ===');
    console.log('Database:', dbInfo.rows[0].db);
    console.log('Host:', dbInfo.rows[0].host || 'localhost (local connection)');
    console.log('Port:', dbInfo.rows[0].port || '5432');
    console.log('');

    // Check if products table has sell_price
    const productsCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'products' 
        AND column_name = 'sell_price'
    `);
    console.log('=== Products Table ===');
    console.log('sell_price column exists:', productsCols.rows.length > 0);
    if (productsCols.rows.length > 0) {
      console.log('  Type:', productsCols.rows[0].data_type);
    }
    console.log('');

    // Check if materialized view exists
    const viewExists = await client.query(`
      SELECT EXISTS(
        SELECT 1 FROM pg_matviews 
        WHERE matviewname = 'product_search_materialized'
      ) as exists
    `);
    console.log('=== Materialized View ===');
    console.log('product_search_materialized exists:', viewExists.rows[0].exists);
    
    if (viewExists.rows[0].exists) {
      const viewCols = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'product_search_materialized' 
          AND column_name = 'sell_price'
      `);
      console.log('sell_price column in view:', viewCols.rows.length > 0);
      if (viewCols.rows.length > 0) {
        console.log('  Type:', viewCols.rows[0].data_type);
      }
      
      // Check row count
      const count = await client.query('SELECT COUNT(*) as cnt FROM product_search_materialized');
      console.log('Row count:', count.rows[0].cnt);
    }
    console.log('');

    // Sample data check
    const sample = await client.query(`
      SELECT p.id, p.style_code, p.sell_price 
      FROM products p 
      WHERE p.sell_price IS NOT NULL 
      LIMIT 1
    `);
    console.log('=== Sample Data ===');
    if (sample.rows.length > 0) {
      console.log('Sample product:', sample.rows[0]);
    } else {
      console.log('No products with sell_price found');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

checkDatabase();

