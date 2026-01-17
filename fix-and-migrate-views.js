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

async function fixAndMigrateViews() {
  console.log('🚀 Fixing and migrating views...\n');
  
  try {
    // Get the view definition
    const viewDef = await sourcePool.query(`
      SELECT 
        pg_get_viewdef('"' || schemaname || '"."' || viewname || '"', true) as view_definition
      FROM pg_views
      WHERE schemaname = 'public' AND viewname = 'product_search_view';
    `);
    
    let viewSQL = viewDef.rows[0].view_definition;
    
    // Fix the GROUP BY clause - add s.style_name if it's missing
    // Check if s.style_name is in GROUP BY
    if (!viewSQL.match(/GROUP BY[^;]*s\.style_name/i)) {
      // Add s.style_name to GROUP BY (after s.style_code)
      viewSQL = viewSQL.replace(
        /GROUP BY([^;]*s\.style_code[^,;]*)/i,
        'GROUP BY$1, s.style_name, s.specification, s.fabric_description'
      );
    }
    
    const createViewSQL = `CREATE OR REPLACE VIEW "product_search_view" AS ${viewSQL}`;
    
    console.log('📝 Creating fixed view: product_search_view\n');
    try {
      await destPool.query(createViewSQL);
      console.log('  ✅ Created: product_search_view');
    } catch (error) {
      console.error('  ❌ Error:', error.message);
      // Try the original without fix
      console.log('  🔄 Trying original definition...');
      const originalSQL = `CREATE OR REPLACE VIEW "product_search_view" AS ${viewDef.rows[0].view_definition}`;
      try {
        await destPool.query(originalSQL);
        console.log('  ✅ Created with original definition');
      } catch (error2) {
        console.error('  ❌ Still failed:', error2.message);
        throw error2;
      }
    }
    
    // Now create materialized views
    console.log('\n📝 Creating materialized views...\n');
    
    const mvDefs = await sourcePool.query(`
      SELECT 
        matviewname,
        'CREATE MATERIALIZED VIEW "' || matviewname || '" AS ' || 
        pg_get_viewdef('"' || schemaname || '"."' || matviewname || '"', true) as create_statement
      FROM pg_matviews
      WHERE schemaname = 'public'
      ORDER BY matviewname;
    `);
    
    // Get indexes
    const mvIndexes = {};
    for (const mv of mvDefs.rows) {
      const indexes = await sourcePool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1;
      `, [mv.matviewname]);
      mvIndexes[mv.matviewname] = indexes.rows;
    }
    
    const viewSQLFile = [];
    viewSQLFile.push('-- Views and Materialized Views');
    viewSQLFile.push('-- Regular View');
    viewSQLFile.push(createViewSQL);
    viewSQLFile.push('');
    
    for (const mv of mvDefs.rows) {
      try {
        console.log(`📝 Creating: ${mv.matviewname}`);
        
        // Drop if exists
        await destPool.query(`DROP MATERIALIZED VIEW IF EXISTS "${mv.matviewname}" CASCADE`);
        
        // Create
        await destPool.query(mv.create_statement);
        console.log(`  ✅ Created: ${mv.matviewname}`);
        
        viewSQLFile.push(`-- Materialized View: ${mv.matviewname}`);
        viewSQLFile.push(mv.create_statement);
        viewSQLFile.push('');
        
        // Create indexes
        if (mvIndexes[mv.matviewname] && mvIndexes[mv.matviewname].length > 0) {
          console.log(`  📊 Creating ${mvIndexes[mv.matviewname].length} index(es)...`);
          viewSQLFile.push(`-- Indexes for ${mv.matviewname}`);
          
          for (const index of mvIndexes[mv.matviewname]) {
            try {
              let indexSQL = index.indexdef.replace(/IF NOT EXISTS /gi, '');
              await destPool.query(indexSQL);
              console.log(`    ✅ Created: ${index.indexname}`);
              viewSQLFile.push(indexSQL);
            } catch (error) {
              console.error(`    ⚠️  Error: ${index.indexname} -`, error.message);
              viewSQLFile.push(`-- ERROR: ${index.indexname} - ${error.message}`);
            }
          }
          viewSQLFile.push('');
        }
      } catch (error) {
        console.error(`  ❌ Error creating ${mv.matviewname}:`, error.message);
        viewSQLFile.push(`-- ERROR: ${mv.matviewname} - ${error.message}`);
        viewSQLFile.push('');
      }
    }
    
    // Refresh materialized views
    console.log('\n🔄 Refreshing materialized views...\n');
    viewSQLFile.push('-- Refresh Materialized Views');
    viewSQLFile.push('');
    
    for (const mv of mvDefs.rows) {
      try {
        console.log(`🔄 Refreshing: ${mv.matviewname}`);
        await destPool.query(`REFRESH MATERIALIZED VIEW "${mv.matviewname}"`);
        console.log(`  ✅ Refreshed: ${mv.matviewname}`);
        viewSQLFile.push(`REFRESH MATERIALIZED VIEW "${mv.matviewname}";`);
      } catch (error) {
        console.error(`  ❌ Error refreshing ${mv.matviewname}:`, error.message);
        viewSQLFile.push(`-- ERROR: ${error.message}`);
      }
    }
    
    // Save
    const viewsFile = path.join(__dirname, 'views.sql');
    fs.writeFileSync(viewsFile, viewSQLFile.join('\n'));
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

fixAndMigrateViews()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

