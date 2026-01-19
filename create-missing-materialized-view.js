const { Pool } = require('pg');
require('dotenv').config();

// Source database
const sourceConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'Branded_UK',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

// Destination database
const destConfig = {
  host: '206.189.119.150',
  port: 5432,
  database: 'brandeduk_prod',
  user: 'brandeduk',
  password: 'omglol123',
  ssl: { rejectUnauthorized: false },
};

const sourcePool = new Pool(sourceConfig);
const destPool = new Pool(destConfig);

async function createMissingView() {
  console.log('🚀 Creating missing materialized view...\n');
  
  try {
    // Get the definition from source
    const mvDef = await sourcePool.query(`
      SELECT 
        'CREATE MATERIALIZED VIEW "' || matviewname || '" AS ' || 
        pg_get_viewdef('"' || schemaname || '"."' || matviewname || '"', true) as create_statement
      FROM pg_matviews
      WHERE schemaname = 'public' AND matviewname = 'product_search_materialized';
    `);
    
    if (mvDef.rows.length === 0) {
      console.log('❌ View definition not found in source');
      return;
    }
    
    console.log('📝 Creating: product_search_materialized\n');
    
    // Drop if exists
    await destPool.query(`DROP MATERIALIZED VIEW IF EXISTS "product_search_materialized" CASCADE`);
    
    // Create
    try {
      await destPool.query(mvDef.rows[0].create_statement);
      console.log('  ✅ Created: product_search_materialized');
      
      // Refresh it
      console.log('\n🔄 Refreshing materialized view...');
      await destPool.query(`REFRESH MATERIALIZED VIEW "product_search_materialized"`);
      console.log('  ✅ Refreshed: product_search_materialized');
      
      console.log('\n✅ All views migrated successfully!');
    } catch (error) {
      console.error('  ❌ Error:', error.message);
      console.log('\n💡 This view depends on product_search_view. Checking if view exists...');
      
      // Check if the view exists
      const viewCheck = await destPool.query(`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.views 
          WHERE table_schema = 'public' AND table_name = 'product_search_view'
        );
      `);
      
      if (viewCheck.rows[0].exists) {
        console.log('  ✅ product_search_view exists');
        console.log('  ⚠️  The materialized view creation failed for another reason.');
        console.log('  💡 You may need to create it manually or check the SQL definition.');
      } else {
        console.log('  ❌ product_search_view does not exist - this is the problem!');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
    await destPool.end();
    console.log('\n🔌 Connections closed');
  }
}

createMissingView()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });


