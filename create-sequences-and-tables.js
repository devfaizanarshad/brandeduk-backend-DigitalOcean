const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Destination database
const destConfig = {
  host: '206.189.119.150',
  port: 5432,
  database: 'brandeduk_prod',
  user: 'brandeduk',
  password: 'omglol123',
  ssl: { rejectUnauthorized: false },
};

const destPool = new Pool(destConfig);

// Tables that need sequences
const tablesWithSequences = [
  'accreditations',
  'age_groups',
  'brand_collections',
  'brands',
  'button_counts',
  'categories',
  'colours',
  'effects',
  'fabrics',
  'genders',
  'product_types',
  'products',
  'related_sectors',
  'related_sports',
  'sizes',
  'special_flags',
  'style_keywords',
  'tags',
  'weight_ranges'
];

async function createSequences() {
  console.log('🔢 Creating sequences...\n');
  
  const client = await destPool.connect();
  try {
    for (const tableName of tablesWithSequences) {
      const seqName = `${tableName}_id_seq`;
      try {
        // Check if sequence exists
        const checkResult = await client.query(
          `SELECT EXISTS(SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = $1)`,
          [seqName]
        );
        
        if (!checkResult.rows[0].exists) {
          // Get the current max ID from source to set sequence start
          await client.query(`CREATE SEQUENCE IF NOT EXISTS "${seqName}"`);
          console.log(`  ✅ Created: ${seqName}`);
        } else {
          console.log(`  ⏭️  Already exists: ${seqName}`);
        }
      } catch (error) {
        console.error(`  ❌ Error creating ${seqName}:`, error.message);
      }
    }
  } finally {
    client.release();
  }
}

async function createRemainingTables() {
  console.log('\n📦 Creating remaining tables...\n');
  
  const schemaFile = path.join(__dirname, 'schema.sql');
  const schemaContent = fs.readFileSync(schemaFile, 'utf8');
  
  // Split by table comments
  const tables = schemaContent.split('-- Table:').filter(s => s.trim().length > 0);
  
  const client = await destPool.connect();
  try {
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const tableSQL of tables) {
      const lines = tableSQL.split('\n');
      const tableNameMatch = lines[0].match(/"(\w+)"/);
      if (!tableNameMatch) continue;
      
      const tableName = tableNameMatch[1];
      const createStatement = '-- Table:' + tableSQL.trim();
      
      // Check if table already exists
      const existsResult = await client.query(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
        [tableName]
      );
      
      if (existsResult.rows[0].exists) {
        console.log(`  ⏭️  Already exists: ${tableName}`);
        skipped++;
        continue;
      }
      
      try {
        // Extract just the CREATE TABLE statement
        const createMatch = createStatement.match(/CREATE TABLE[^;]+;/s);
        if (createMatch) {
          await client.query(createMatch[0]);
          console.log(`  ✅ Created: ${tableName}`);
          created++;
        }
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`  ⏭️  Already exists: ${tableName}`);
          skipped++;
        } else {
          console.error(`  ❌ Error creating ${tableName}:`, error.message.substring(0, 100));
          errors++;
        }
      }
    }
    
    console.log(`\n📊 Table Creation: ${created} created, ${skipped} skipped, ${errors} errors\n`);
  } finally {
    client.release();
  }
}

async function migrateRemainingData() {
  console.log('📥 Migrating remaining data...\n');
  
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
  
  // Tables that failed to migrate
  const failedTables = [
    'accreditations',
    'age_groups',
    'brand_collections',
    'brands',
    'button_counts',
    'categories',
    'colours',
    'effects',
    'fabrics',
    'genders',
    'related_sectors',
    'related_sports',
    'special_flags',
    'style_keywords'
  ];
  
  try {
    let migrated = 0;
    let failed = 0;
    
    for (const tableName of failedTables) {
      try {
        console.log(`📥 Migrating: ${tableName}`);
        
        // Check if table exists
        const checkResult = await destPool.query(
          `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
          [tableName]
        );
        
        if (!checkResult.rows[0].exists) {
          console.log(`  ⏭️  Table doesn't exist yet: ${tableName}`);
          failed++;
          continue;
        }
        
        // Get data from source
        const sourceData = await sourcePool.query(`SELECT * FROM "${tableName}"`);
        const rows = sourceData.rows;
        console.log(`  📊 Exported ${rows.length} rows`);
        
        if (rows.length === 0) {
          console.log(`  ⏭️  Skipping - no data`);
          continue;
        }
        
        // Insert into destination
        const destClient = await destPool.connect();
        try {
          await destClient.query('BEGIN');
          await destClient.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
          
          const columns = Object.keys(rows[0]);
          const columnNames = columns.map(c => `"${c}"`).join(', ');
          
          // Insert in batches
          const batchSize = 1000;
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const values = batch.map((row, batchIdx) => {
              const placeholders = columns.map((_, colIdx) => 
                `$${batchIdx * columns.length + colIdx + 1}`
              ).join(', ');
              return `(${placeholders})`;
            }).join(', ');
            
            const allValues = batch.flatMap(row => columns.map(col => row[col]));
            await destClient.query(
              `INSERT INTO "${tableName}" (${columnNames}) VALUES ${values}`,
              allValues
            );
          }
          
          await destClient.query('COMMIT');
          console.log(`  ✅ Imported ${rows.length} rows`);
          migrated++;
        } catch (error) {
          await destClient.query('ROLLBACK');
          console.error(`  ❌ Error:`, error.message);
          failed++;
        } finally {
          destClient.release();
        }
      } catch (error) {
        console.error(`  ❌ Error:`, error.message);
        failed++;
      }
    }
    
    console.log(`\n📊 Data Migration: ${migrated} succeeded, ${failed} failed\n`);
    
    await sourcePool.end();
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function main() {
  console.log('🚀 Completing database migration...\n');
  
  try {
    // Step 1: Create sequences
    await createSequences();
    
    // Step 2: Create remaining tables
    await createRemainingTables();
    
    // Step 3: Migrate remaining data
    await migrateRemainingData();
    
    console.log('✅ Migration completed!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await destPool.end();
    console.log('\n🔌 Connections closed');
  }
}

main()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

