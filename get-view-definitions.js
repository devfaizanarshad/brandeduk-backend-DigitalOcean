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

const sourcePool = new Pool(sourceConfig);

async function getFullViewDefinitions() {
  console.log('📋 Getting full view definitions...\n');
  
  try {
    // Get regular view using pg_get_viewdef
    const viewDef = await sourcePool.query(`
      SELECT 
        'CREATE OR REPLACE VIEW "' || viewname || '" AS ' || 
        pg_get_viewdef('"' || schemaname || '"."' || viewname || '"', true) as create_statement
      FROM pg_views
      WHERE schemaname = 'public' AND viewname = 'product_search_view';
    `);
    
    if (viewDef.rows.length > 0) {
      console.log('Regular View Definition:');
      console.log(viewDef.rows[0].create_statement);
      console.log('\n');
    }
    
    // Get materialized views
    const mvDefs = await sourcePool.query(`
      SELECT 
        matviewname,
        'CREATE MATERIALIZED VIEW "' || matviewname || '" AS ' || 
        pg_get_viewdef('"' || schemaname || '"."' || matviewname || '"', true) as create_statement
      FROM pg_matviews
      WHERE schemaname = 'public'
      ORDER BY matviewname;
    `);
    
    console.log('Materialized View Definitions:');
    mvDefs.rows.forEach(mv => {
      console.log(`\n${mv.matviewname}:`);
      console.log(mv.create_statement);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourcePool.end();
  }
}

getFullViewDefinitions()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });

