// Quick check: What database is the server actually connecting to?
const { pool } = require('./config/database');

async function check() {
  const client = await pool.connect();
  try {
    const info = await client.query(`
      SELECT 
        current_database() as db,
        inet_server_addr() as host,
        inet_server_port() as port,
        current_user as user
    `);
    console.log('=== Server Database Connection ===');
    console.log('Database:', info.rows[0].db);
    console.log('Host:', info.rows[0].host || 'localhost (local connection)');
    console.log('Port:', info.rows[0].port || '5432');
    console.log('User:', info.rows[0].user);
    console.log('');
    
    // Check if sell_price exists
    const hasSellPrice = await client.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'products' 
          AND column_name = 'sell_price'
      ) as exists
    `);
    console.log('Products table has sell_price:', hasSellPrice.rows[0].exists);
    
    const hasView = await client.query(`
      SELECT EXISTS(
        SELECT 1 FROM pg_matviews 
        WHERE matviewname = 'product_search_materialized'
      ) as exists
    `);
    console.log('Materialized view exists:', hasView.rows[0].exists);
    
    if (hasView.rows[0].exists) {
      const sample = await client.query(`
        SELECT style_code, sell_price 
        FROM product_search_materialized 
        WHERE sell_price IS NOT NULL 
        LIMIT 1
      `);
      console.log('Can query sell_price from view:', sample.rows.length > 0);
      if (sample.rows.length > 0) {
        console.log('Sample:', sample.rows[0]);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

check();

