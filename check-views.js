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

async function checkViews() {
  console.log('🔍 Checking for views and materialized views...\n');
  
  try {
    // Check for regular views
    const views = await sourcePool.query(`
      SELECT 
        table_name,
        view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    // Check for materialized views
    const materializedViews = await sourcePool.query(`
      SELECT 
        schemaname,
        matviewname as view_name,
        pg_get_viewdef('"' || schemaname || '"."' || matviewname || '"', true) as view_definition
      FROM pg_matviews
      WHERE schemaname = 'public'
      ORDER BY matviewname;
    `);
    
    console.log(`📊 Found ${views.rows.length} regular view(s)`);
    if (views.rows.length > 0) {
      console.log('\nRegular Views:');
      views.rows.forEach(v => {
        console.log(`  - ${v.table_name}`);
      });
    }
    
    console.log(`\n📊 Found ${materializedViews.rows.length} materialized view(s)`);
    if (materializedViews.rows.length > 0) {
      console.log('\nMaterialized Views:');
      materializedViews.rows.forEach(v => {
        console.log(`  - ${v.view_name}`);
      });
    }
    
    // Check destination
    console.log('\n🔍 Checking destination database...\n');
    
    const destViews = await destPool.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    const destMaterializedViews = await destPool.query(`
      SELECT matviewname as view_name
      FROM pg_matviews
      WHERE schemaname = 'public'
      ORDER BY matviewname;
    `);
    
    console.log(`📊 Destination has ${destViews.rows.length} regular view(s) and ${destMaterializedViews.rows.length} materialized view(s)`);
    
    if (views.rows.length > 0 || materializedViews.rows.length > 0) {
      console.log('\n💡 Views found! Need to migrate them.');
      return { views: views.rows, materializedViews: materializedViews.rows };
    } else {
      console.log('\n✅ No views or materialized views found in source database.');
      return { views: [], materializedViews: [] };
    }
    
  } catch (error) {
    console.error('❌ Error checking views:', error);
    throw error;
  } finally {
    await sourcePool.end();
    await destPool.end();
    console.log('\n🔌 Connections closed');
  }
}

checkViews()
  .then((result) => {
    if (result.views.length > 0 || result.materializedViews.length > 0) {
      console.log('\n📝 Views need to be migrated. Run migrate-views.js to migrate them.');
    } else {
      console.log('\n✅ No views to migrate.');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

