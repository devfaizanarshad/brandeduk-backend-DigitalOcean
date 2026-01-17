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

async function verifyMigration() {
  console.log('🔍 Verifying database migration...\n');
  
  try {
    // Get all tables
    const sourceTables = await sourcePool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    
    const destTables = await destPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    
    console.log(`📊 Tables: Source: ${sourceTables.rows.length}, Destination: ${destTables.rows.length}\n`);
    
    if (sourceTables.rows.length !== destTables.rows.length) {
      console.log('⚠️  Table count mismatch!\n');
    } else {
      console.log('✅ Table count matches!\n');
    }
    
    // Compare row counts
    console.log('📊 Comparing row counts:\n');
    let allMatch = true;
    let totalSourceRows = 0;
    let totalDestRows = 0;
    
    for (const table of sourceTables.rows) {
      const tableName = table.table_name;
      
      try {
        const sourceCount = await sourcePool.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
        const destCount = await destPool.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
        
        const sourceRows = parseInt(sourceCount.rows[0].count);
        const destRows = parseInt(destCount.rows[0].count);
        
        totalSourceRows += sourceRows;
        totalDestRows += destRows;
        
        const match = sourceRows === destRows ? '✅' : '❌';
        if (sourceRows !== destRows) allMatch = false;
        
        console.log(`  ${match} ${tableName}: Source: ${sourceRows}, Destination: ${destRows}`);
      } catch (error) {
        console.log(`  ⚠️  ${tableName}: Error - ${error.message}`);
        allMatch = false;
      }
    }
    
    console.log(`\n📊 Total Rows: Source: ${totalSourceRows.toLocaleString()}, Destination: ${totalDestRows.toLocaleString()}`);
    
    if (allMatch && totalSourceRows === totalDestRows) {
      console.log('\n✅ Migration verification: SUCCESS! All data migrated correctly.\n');
    } else {
      console.log('\n⚠️  Migration verification: Some discrepancies found.\n');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  } finally {
    await sourcePool.end();
    await destPool.end();
    console.log('🔌 Connections closed');
  }
}

verifyMigration()
  .then(() => {
    console.log('\n🎉 Verification complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

