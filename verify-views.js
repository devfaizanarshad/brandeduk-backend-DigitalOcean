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

async function verifyViews() {
  console.log('🔍 Verifying views and materialized views migration...\n');
  
  try {
    // Check source
    const sourceViews = await sourcePool.query(`
      SELECT table_name FROM information_schema.views
      WHERE table_schema = 'public' ORDER BY table_name;
    `);
    
    const sourceMVs = await sourcePool.query(`
      SELECT matviewname FROM pg_matviews
      WHERE schemaname = 'public' ORDER BY matviewname;
    `);
    
    // Check destination
    const destViews = await destPool.query(`
      SELECT table_name FROM information_schema.views
      WHERE table_schema = 'public' ORDER BY table_name;
    `);
    
    const destMVs = await destPool.query(`
      SELECT matviewname FROM pg_matviews
      WHERE schemaname = 'public' ORDER BY matviewname;
    `);
    
    console.log('📊 Source Database:');
    console.log(`   Regular Views: ${sourceViews.rows.length}`);
    sourceViews.rows.forEach(v => console.log(`     - ${v.table_name}`));
    console.log(`   Materialized Views: ${sourceMVs.rows.length}`);
    sourceMVs.rows.forEach(mv => console.log(`     - ${mv.matviewname}`));
    
    console.log('\n📊 Destination Database:');
    console.log(`   Regular Views: ${destViews.rows.length}`);
    destViews.rows.forEach(v => console.log(`     - ${v.table_name}`));
    console.log(`   Materialized Views: ${destMVs.rows.length}`);
    destMVs.rows.forEach(mv => console.log(`     - ${mv.matviewname}`));
    
    // Compare
    console.log('\n📊 Comparison:');
    const viewsMatch = sourceViews.rows.length === destViews.rows.length;
    const mvsMatch = sourceMVs.rows.length === destMVs.rows.length;
    
    if (viewsMatch && mvsMatch) {
      console.log('   ✅ View counts match!');
      
      // Check if all views exist
      const sourceViewNames = sourceViews.rows.map(v => v.table_name).sort();
      const destViewNames = destViews.rows.map(v => v.table_name).sort();
      const sourceMVNames = sourceMVs.rows.map(mv => mv.matviewname).sort();
      const destMVNames = destMVs.rows.map(mv => mv.matviewname).sort();
      
      const viewsAllMatch = JSON.stringify(sourceViewNames) === JSON.stringify(destViewNames);
      const mvsAllMatch = JSON.stringify(sourceMVNames) === JSON.stringify(destMVNames);
      
      if (viewsAllMatch && mvsAllMatch) {
        console.log('   ✅ All views and materialized views migrated!');
        console.log('\n✅ Migration Status: COMPLETE');
      } else {
        console.log('   ⚠️  Some views may be missing');
        if (!viewsAllMatch) {
          console.log('   Missing views:', sourceViewNames.filter(v => !destViewNames.includes(v)));
        }
        if (!mvsAllMatch) {
          console.log('   Missing materialized views:', sourceMVNames.filter(mv => !destMVNames.includes(mv)));
        }
      }
    } else {
      console.log('   ⚠️  View counts do not match');
      if (!viewsMatch) {
        console.log(`   Regular views: Source ${sourceViews.rows.length} vs Destination ${destViews.rows.length}`);
      }
      if (!mvsMatch) {
        console.log(`   Materialized views: Source ${sourceMVs.rows.length} vs Destination ${destMVs.rows.length}`);
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

verifyViews()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });

