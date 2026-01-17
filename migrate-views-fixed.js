const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
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

async function migrateViewsFixed() {
  console.log('🚀 Migrating views and materialized views (fixed)...\n');
  
  try {
    // Get the actual CREATE statement for the view using pg_get_viewdef
    const viewDef = await sourcePool.query(`
      SELECT 
        'CREATE OR REPLACE VIEW "' || viewname || '" AS ' || 
        pg_get_viewdef('"' || schemaname || '"."' || viewname || '"', true) as create_statement
      FROM pg_views
      WHERE schemaname = 'public' AND viewname = 'product_search_view';
    `);
    
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
    
    // Get indexes for materialized views
    const mvIndexes = {};
    for (const mv of mvDefs.rows) {
      const indexes = await sourcePool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1;
      `, [mv.matviewname]);
      mvIndexes[mv.matviewname] = indexes.rows;
    }
    
    const viewSQL = [];
    viewSQL.push('-- Views and Materialized Views Migration');
    viewSQL.push('-- Generated automatically');
    viewSQL.push('');
    
    // Create regular view first
    if (viewDef.rows.length > 0) {
      console.log('📝 Creating regular view: product_search_view\n');
      try {
        await destPool.query(viewDef.rows[0].create_statement);
        console.log('  ✅ Created: product_search_view');
        viewSQL.push('-- Regular View: product_search_view');
        viewSQL.push(viewDef.rows[0].create_statement);
        viewSQL.push('');
      } catch (error) {
        console.error('  ❌ Error:', error.message);
        viewSQL.push('-- ERROR: product_search_view');
        viewSQL.push(`-- ${error.message}`);
        viewSQL.push('');
      }
    }
    
    // Create materialized views
    console.log('\n📝 Creating materialized views...\n');
    
    for (const mv of mvDefs.rows) {
      try {
        console.log(`📝 Creating: ${mv.matviewname}`);
        
        // Drop if exists
        await destPool.query(`DROP MATERIALIZED VIEW IF EXISTS "${mv.matviewname}" CASCADE`);
        
        // Create materialized view
        await destPool.query(mv.create_statement);
        console.log(`  ✅ Created: ${mv.matviewname}`);
        
        viewSQL.push(`-- Materialized View: ${mv.matviewname}`);
        viewSQL.push(mv.create_statement);
        viewSQL.push('');
        
        // Create indexes
        if (mvIndexes[mv.matviewname] && mvIndexes[mv.matviewname].length > 0) {
          console.log(`  📊 Creating ${mvIndexes[mv.matviewname].length} index(es)...`);
          viewSQL.push(`-- Indexes for ${mv.matviewname}`);
          
          for (const index of mvIndexes[mv.matviewname]) {
            try {
              // Remove IF NOT EXISTS as it's not always supported
              let indexSQL = index.indexdef.replace(/IF NOT EXISTS /gi, '');
              await destPool.query(indexSQL);
              console.log(`    ✅ Created: ${index.indexname}`);
              viewSQL.push(indexSQL);
            } catch (error) {
              console.error(`    ⚠️  Error creating ${index.indexname}:`, error.message);
              viewSQL.push(`-- ERROR: ${index.indexname} - ${error.message}`);
            }
          }
          viewSQL.push('');
        }
      } catch (error) {
        console.error(`  ❌ Error creating ${mv.matviewname}:`, error.message);
        viewSQL.push(`-- ERROR: ${mv.matviewname}`);
        viewSQL.push(`-- ${error.message}`);
        viewSQL.push('');
      }
    }
    
    // Refresh materialized views
    console.log('\n🔄 Refreshing materialized views...\n');
    viewSQL.push('-- Refresh Materialized Views');
    viewSQL.push('');
    
    for (const mv of mvDefs.rows) {
      try {
        console.log(`🔄 Refreshing: ${mv.matviewname}`);
        await destPool.query(`REFRESH MATERIALIZED VIEW "${mv.matviewname}"`);
        console.log(`  ✅ Refreshed: ${mv.matviewname}`);
        viewSQL.push(`REFRESH MATERIALIZED VIEW "${mv.matviewname}";`);
      } catch (error) {
        console.error(`  ❌ Error refreshing ${mv.matviewname}:`, error.message);
        viewSQL.push(`-- ERROR refreshing ${mv.matviewname}: ${error.message}`);
      }
    }
    
    // Save to file
    const viewsFile = path.join(__dirname, 'views.sql');
    fs.writeFileSync(viewsFile, viewSQL.join('\n'));
    console.log(`\n📄 Views SQL saved to: ${viewsFile}`);
    
    console.log('\n✅ Views migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourcePool.end();
    await destPool.end();
    console.log('\n🔌 Connections closed');
  }
}

migrateViewsFixed()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

