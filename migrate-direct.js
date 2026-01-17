const { Pool } = require('pg');
require('dotenv').config();

// Source database (current - from .env)
const sourceConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'Branded_UK',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

// Destination database (Digital Ocean)
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

// Get table creation SQL from source database
async function getTableDDL(pool, tableName) {
  const query = `
    SELECT 
      'CREATE TABLE IF NOT EXISTS ' || quote_ident(schemaname) || '.' || quote_ident(tablename) || ' (' ||
      string_agg(
        quote_ident(attname) || ' ' ||
        pg_catalog.format_type(atttypid, atttypmod) ||
        CASE WHEN attnotnull THEN ' NOT NULL' ELSE '' END ||
        CASE 
          WHEN atthasdef THEN ' DEFAULT ' || pg_get_expr(adbin, adrelid)
          ELSE ''
        END,
        ', '
        ORDER BY attnum
      ) || ');' as ddl
    FROM pg_attribute
    LEFT JOIN pg_attrdef ON pg_attribute.attrelid = pg_attrdef.adrelid 
      AND pg_attribute.attnum = pg_attrdef.adnum
    WHERE pg_attribute.attrelid = quote_ident($1)::regclass
      AND pg_attribute.attnum > 0
      AND NOT pg_attribute.attisdropped
    GROUP BY schemaname, tablename;
  `;
  
  try {
    // Try simpler approach - get from information_schema
    const simpleQuery = `
      SELECT 
        'CREATE TABLE IF NOT EXISTS "' || table_name || '" (' ||
        string_agg(
          '"' || column_name || '" ' ||
          CASE 
            WHEN data_type = 'ARRAY' THEN 
              (SELECT 'ARRAY(' || udt_name || ')' 
               FROM information_schema.element_types 
               WHERE object_schema = 'public' 
               AND object_name = $1 
               LIMIT 1)
            WHEN data_type = 'character varying' THEN 
              'VARCHAR(' || COALESCE(character_maximum_length::text, '') || ')'
            WHEN data_type = 'character' THEN 
              'CHAR(' || COALESCE(character_maximum_length::text, '') || ')'
            WHEN data_type = 'numeric' THEN 
              'NUMERIC' || 
              CASE 
                WHEN numeric_precision IS NOT NULL AND numeric_scale IS NOT NULL
                THEN '(' || numeric_precision || ',' || numeric_scale || ')'
                WHEN numeric_precision IS NOT NULL
                THEN '(' || numeric_precision || ')'
                ELSE ''
              END
            ELSE UPPER(REPLACE(data_type, ' ', '_'))
          END ||
          CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
          CASE 
            WHEN column_default IS NOT NULL 
            THEN ' DEFAULT ' || column_default 
            ELSE '' 
          END,
          ', '
          ORDER BY ordinal_position
        ) || ');' as ddl
      FROM information_schema.columns
      WHERE table_schema = 'public' 
      AND table_name = $1;
    `;
    
    const result = await pool.query(simpleQuery, [tableName]);
    return result.rows[0]?.ddl;
  } catch (error) {
    console.error(`  ⚠️  Could not get DDL for ${tableName}, will try to create manually`);
    return null;
  }
}

// Get all tables
async function getAllTables(pool) {
  const result = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  return result.rows.map(r => r.table_name);
}

// Copy data directly from source to destination
async function copyTableData(sourcePool, destPool, tableName) {
  console.log(`📥 Migrating: ${tableName}`);
  
  const sourceClient = await sourcePool.connect();
  const destClient = await destPool.connect();
  
  try {
    // Get data from source
    const sourceResult = await sourceClient.query(`SELECT * FROM "${tableName}"`);
    const rows = sourceResult.rows;
    console.log(`  📊 Exported ${rows.length} rows`);
    
    if (rows.length === 0) {
      console.log(`  ⏭️  Skipping - no data`);
      return;
    }
    
    // Insert into destination
    await destClient.query('BEGIN');
    
    try {
      // Truncate first
      await destClient.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
      
      // Get column names
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
        const query = `INSERT INTO "${tableName}" (${columnNames}) VALUES ${values}`;
        
        await destClient.query(query, allValues);
      }
      
      await destClient.query('COMMIT');
      console.log(`  ✅ Imported ${rows.length} rows`);
    } catch (error) {
      await destClient.query('ROLLBACK');
      throw error;
    }
  } finally {
    sourceClient.release();
    destClient.release();
  }
}

// Main migration
async function migrateDatabase() {
  console.log('🚀 Starting direct database migration...\n');
  
  try {
    // Test connections
    console.log('📡 Testing connections...');
    await sourcePool.query('SELECT NOW()');
    console.log('  ✅ Source connected');
    
    await destPool.query('SELECT NOW()');
    console.log('  ✅ Destination connected\n');
    
    // Get tables
    console.log('📋 Getting table list...');
    const tables = await getAllTables(sourcePool);
    console.log(`  ✅ Found ${tables.length} tables\n`);
    
    // Create tables first
    console.log('📦 Creating tables...\n');
    let createdCount = 0;
    let skippedCount = 0;
    
    for (const tableName of tables) {
      try {
        console.log(`📝 Creating: ${tableName}`);
        const ddl = await getTableDDL(sourcePool, tableName);
        
        if (ddl) {
          try {
            await destPool.query(ddl);
            console.log(`  ✅ Created: ${tableName}`);
            createdCount++;
          } catch (error) {
            if (error.message.includes('already exists') || error.message.includes('duplicate')) {
              console.log(`  ⚠️  Already exists: ${tableName}`);
              skippedCount++;
            } else if (error.message.includes('permission denied')) {
              console.log(`  ❌ Permission denied: ${tableName}`);
              console.log(`  💡 Will try to insert data anyway...`);
              skippedCount++;
            } else {
              console.log(`  ⚠️  Error creating (will try data migration): ${error.message}`);
              skippedCount++;
            }
          }
        } else {
          console.log(`  ⚠️  Could not get DDL, skipping table creation`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        skippedCount++;
      }
    }
    
    console.log(`\n📊 Created: ${createdCount}, Skipped/Exists: ${skippedCount}\n`);
    
    // Migrate data
    console.log('📥 Migrating data...\n');
    let dataMigrated = 0;
    let dataFailed = 0;
    
    for (const tableName of tables) {
      try {
        await copyTableData(sourcePool, destPool, tableName);
        dataMigrated++;
      } catch (error) {
        if (error.message.includes('does not exist')) {
          console.log(`  ❌ Table doesn't exist: ${tableName} (skipped creation due to permissions)`);
        } else {
          console.error(`  ❌ Error: ${error.message}`);
        }
        dataFailed++;
      }
    }
    
    console.log(`\n📊 Data Migration: ${dataMigrated} succeeded, ${dataFailed} failed\n`);
    console.log('✅ Migration process completed!');
    
    if (skippedCount > 0 || dataFailed > 0) {
      console.log('\n💡 Some tables may need manual creation or permission fixes.');
      console.log('   Check the errors above and contact Digital Ocean support if needed.');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourcePool.end();
    await destPool.end();
    console.log('\n🔌 Connections closed');
  }
}

migrateDatabase()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

