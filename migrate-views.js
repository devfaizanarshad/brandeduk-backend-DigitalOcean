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

async function getViewDefinitions() {
  console.log('📋 Getting view definitions from source...\n');
  
  // Get regular views
  const views = await sourcePool.query(`
    SELECT 
      table_name,
      view_definition
    FROM information_schema.views
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);
  
  // Get materialized views with full CREATE statement
  const materializedViews = await sourcePool.query(`
    SELECT 
      matviewname as view_name,
      pg_get_viewdef('"' || schemaname || '"."' || matviewname || '"', true) as view_definition,
      hasindexes
    FROM pg_matviews
    WHERE schemaname = 'public'
    ORDER BY matviewname;
  `);
  
  // Get full CREATE MATERIALIZED VIEW statements
  const fullMaterializedViews = [];
  for (const mv of materializedViews.rows) {
    try {
      // Try to get the full CREATE statement including indexes
      const createQuery = await sourcePool.query(`
        SELECT 
          'CREATE MATERIALIZED VIEW IF NOT EXISTS "' || matviewname || '" AS ' || 
          pg_get_viewdef('"' || schemaname || '"."' || matviewname || '"', true) as create_statement
        FROM pg_matviews
        WHERE schemaname = 'public' AND matviewname = $1;
      `, [mv.view_name]);
      
      if (createQuery.rows[0]?.create_statement) {
        fullMaterializedViews.push({
          name: mv.view_name,
          definition: createQuery.rows[0].create_statement,
          hasIndexes: mv.hasindexes
        });
      } else {
        // Fallback
        fullMaterializedViews.push({
          name: mv.view_name,
          definition: `CREATE MATERIALIZED VIEW IF NOT EXISTS "${mv.view_name}" AS ${mv.view_definition}`,
          hasIndexes: mv.hasindexes
        });
      }
    } catch (error) {
      console.error(`  ⚠️  Error getting full definition for ${mv.view_name}:`, error.message);
      fullMaterializedViews.push({
        name: mv.view_name,
        definition: `CREATE MATERIALIZED VIEW IF NOT EXISTS "${mv.view_name}" AS ${mv.view_definition}`,
        hasIndexes: mv.hasindexes
      });
    }
  }
  
  // Get indexes on materialized views
  const materializedViewIndexes = [];
  for (const mv of materializedViews.rows) {
    try {
      const indexes = await sourcePool.query(`
        SELECT 
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' 
        AND tablename = $1;
      `, [mv.view_name]);
      
      if (indexes.rows.length > 0) {
        materializedViewIndexes.push({
          viewName: mv.view_name,
          indexes: indexes.rows
        });
      }
    } catch (error) {
      console.error(`  ⚠️  Error getting indexes for ${mv.view_name}:`, error.message);
    }
  }
  
  return {
    views: views.rows,
    materializedViews: fullMaterializedViews,
    materializedViewIndexes
  };
}

async function migrateViews() {
  console.log('🚀 Migrating views and materialized views...\n');
  
  try {
    // Get view definitions
    const { views, materializedViews, materializedViewIndexes } = await getViewDefinitions();
    
    console.log(`📊 Found ${views.length} regular view(s) and ${materializedViews.length} materialized view(s)\n`);
    
    const viewSQL = [];
    viewSQL.push('-- Views and Materialized Views Migration');
    viewSQL.push('-- Generated automatically');
    viewSQL.push('');
    
    // Migrate regular views
    if (views.length > 0) {
      console.log('📝 Migrating regular views...\n');
      viewSQL.push('-- Regular Views');
      viewSQL.push('');
      
      for (const view of views) {
        try {
          console.log(`📝 Creating view: ${view.table_name}`);
          const createViewSQL = `CREATE OR REPLACE VIEW "${view.table_name}" AS ${view.view_definition}`;
          
          viewSQL.push(`-- View: ${view.table_name}`);
          viewSQL.push(createViewSQL);
          viewSQL.push('');
          
          await destPool.query(createViewSQL);
          console.log(`  ✅ Created: ${view.table_name}`);
        } catch (error) {
          console.error(`  ❌ Error creating view ${view.table_name}:`, error.message);
          viewSQL.push(`-- ERROR: ${view.table_name} - ${error.message}`);
          viewSQL.push('');
        }
      }
    }
    
    // Migrate materialized views
    if (materializedViews.length > 0) {
      console.log('\n📝 Migrating materialized views...\n');
      viewSQL.push('-- Materialized Views');
      viewSQL.push('');
      
      for (const mv of materializedViews) {
        try {
          console.log(`📝 Creating materialized view: ${mv.name}`);
          
          // Drop if exists first
          await destPool.query(`DROP MATERIALIZED VIEW IF EXISTS "${mv.name}" CASCADE`);
          
          // Create materialized view
          await destPool.query(mv.definition);
          console.log(`  ✅ Created: ${mv.name}`);
          
          viewSQL.push(`-- Materialized View: ${mv.name}`);
          viewSQL.push(mv.definition);
          viewSQL.push('');
          
          // Create indexes if they exist
          const viewIndexes = materializedViewIndexes.find(vi => vi.viewName === mv.name);
          if (viewIndexes && viewIndexes.indexes.length > 0) {
            console.log(`  📊 Creating ${viewIndexes.indexes.length} index(es) for ${mv.name}...`);
            viewSQL.push(`-- Indexes for ${mv.name}`);
            
            for (const index of viewIndexes.indexes) {
              try {
                // Remove IF NOT EXISTS if present, as it's not always supported
                let indexSQL = index.indexdef;
                indexSQL = indexSQL.replace(/IF NOT EXISTS /gi, '');
                
                await destPool.query(indexSQL);
                console.log(`    ✅ Created index: ${index.indexname}`);
                viewSQL.push(indexSQL);
              } catch (error) {
                console.error(`    ⚠️  Error creating index ${index.indexname}:`, error.message);
                viewSQL.push(`-- ERROR: ${index.indexname} - ${error.message}`);
              }
            }
            viewSQL.push('');
          }
        } catch (error) {
          console.error(`  ❌ Error creating materialized view ${mv.name}:`, error.message);
          viewSQL.push(`-- ERROR: ${mv.name} - ${error.message}`);
          viewSQL.push('');
        }
      }
      
      // Refresh materialized views
      console.log('\n🔄 Refreshing materialized views...\n');
      viewSQL.push('-- Refresh Materialized Views');
      viewSQL.push('');
      
      for (const mv of materializedViews) {
        try {
          console.log(`🔄 Refreshing: ${mv.name}`);
          await destPool.query(`REFRESH MATERIALIZED VIEW "${mv.name}"`);
          console.log(`  ✅ Refreshed: ${mv.name}`);
          viewSQL.push(`REFRESH MATERIALIZED VIEW "${mv.name}";`);
        } catch (error) {
          console.error(`  ❌ Error refreshing ${mv.name}:`, error.message);
          viewSQL.push(`-- ERROR refreshing ${mv.name}: ${error.message}`);
        }
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

migrateViews()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

