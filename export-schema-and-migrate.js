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

// Get proper CREATE TABLE statement using pg_catalog
async function getCreateTableSQL(pool, tableName) {
  const query = `
    SELECT 
      'CREATE TABLE IF NOT EXISTS "' || table_name || '" (' || E'\\n' ||
      string_agg(
        '  "' || column_name || '" ' ||
        CASE 
          WHEN udt_name = 'varchar' THEN 'character varying' || 
            CASE WHEN character_maximum_length IS NOT NULL 
              THEN '(' || character_maximum_length || ')' 
              ELSE '' 
            END
          WHEN udt_name = 'bpchar' THEN 'character' || 
            CASE WHEN character_maximum_length IS NOT NULL 
              THEN '(' || character_maximum_length || ')' 
              ELSE '' 
            END
          WHEN udt_name = 'numeric' THEN 'numeric' ||
            CASE 
              WHEN numeric_precision IS NOT NULL AND numeric_scale IS NOT NULL
              THEN '(' || numeric_precision || ',' || numeric_scale || ')'
              WHEN numeric_precision IS NOT NULL
              THEN '(' || numeric_precision || ')'
              ELSE ''
            END
          WHEN udt_name = 'int4' THEN 'integer'
          WHEN udt_name = 'int8' THEN 'bigint'
          WHEN udt_name = 'int2' THEN 'smallint'
          WHEN udt_name = 'float4' THEN 'real'
          WHEN udt_name = 'float8' THEN 'double precision'
          WHEN udt_name = 'bool' THEN 'boolean'
          WHEN udt_name = 'date' THEN 'date'
          WHEN udt_name = 'timestamp' THEN 'timestamp without time zone'
          WHEN udt_name = 'timestamptz' THEN 'timestamp with time zone'
          WHEN udt_name = 'text' THEN 'text'
          WHEN udt_name = 'jsonb' THEN 'jsonb'
          WHEN udt_name = 'json' THEN 'json'
          WHEN udt_name = 'bytea' THEN 'bytea'
          WHEN udt_name = 'uuid' THEN 'uuid'
          WHEN udt_name LIKE '%[]' THEN 
            REPLACE(udt_name, '_', ' ') || '[]'
          ELSE udt_name
        END ||
        CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
        CASE 
          WHEN column_default IS NOT NULL 
          THEN ' DEFAULT ' || column_default 
          ELSE '' 
        END,
        ',' || E'\\n'
        ORDER BY ordinal_position
      ) || E'\\n' || ');' as create_sql
    FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = $1
    GROUP BY table_name;
  `;
  
  try {
    const result = await pool.query(query, [tableName]);
    return result.rows[0]?.create_sql;
  } catch (error) {
    console.error(`  ⚠️  Error getting DDL for ${tableName}:`, error.message);
    return null;
  }
}

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

async function migrateDatabase() {
  console.log('🚀 Starting comprehensive database migration...\n');
  
  const schemaFile = path.join(__dirname, 'schema.sql');
  const schemaSQL = [];
  
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
    
    // Generate CREATE TABLE statements
    console.log('📝 Generating CREATE TABLE statements...\n');
    let successCount = 0;
    let failCount = 0;
    
    for (const tableName of tables) {
      try {
        const createSQL = await getCreateTableSQL(sourcePool, tableName);
        if (createSQL) {
          schemaSQL.push(`-- Table: ${tableName}`);
          schemaSQL.push(createSQL);
          schemaSQL.push('');
          successCount++;
          console.log(`  ✅ ${tableName}`);
        } else {
          failCount++;
          console.log(`  ❌ ${tableName} - Could not generate DDL`);
        }
      } catch (error) {
        failCount++;
        console.error(`  ❌ ${tableName}:`, error.message);
      }
    }
    
    // Save schema to file
    fs.writeFileSync(schemaFile, schemaSQL.join('\n'));
    console.log(`\n📄 Schema saved to: ${schemaFile}`);
    console.log(`   Generated: ${successCount}, Failed: ${failCount}\n`);
    
    // Try to create tables on destination
    console.log('📦 Attempting to create tables on destination...\n');
    const schemaContent = fs.readFileSync(schemaFile, 'utf8');
    const statements = schemaContent.split(';').filter(s => s.trim().length > 0);
    
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim() + ';';
      if (statement.includes('CREATE TABLE')) {
        try {
          await destPool.query(statement);
          created++;
          const tableMatch = statement.match(/CREATE TABLE.*?"(\w+)"/);
          if (tableMatch) {
            console.log(`  ✅ Created: ${tableMatch[1]}`);
          }
        } catch (error) {
          if (error.message.includes('already exists') || error.message.includes('duplicate')) {
            skipped++;
          } else if (error.message.includes('permission denied')) {
            console.log(`  ❌ Permission denied - tables need to be created manually`);
            console.log(`  💡 You can:`);
            console.log(`     1. Run the SQL file manually: psql -h 206.189.119.150 -U brandeduk -d brandeduk_prod -f schema.sql`);
            console.log(`     2. Or ask Digital Ocean support to create the tables`);
            errors++;
            break; // Stop trying if we hit permission errors
          } else {
            console.error(`  ⚠️  Error:`, error.message.substring(0, 100));
            errors++;
          }
        }
      }
    }
    
    console.log(`\n📊 Table Creation: ${created} created, ${skipped} skipped, ${errors} errors\n`);
    
    // Now migrate data
    if (created > 0 || skipped > 0) {
      console.log('📥 Migrating data...\n');
      let dataMigrated = 0;
      let dataFailed = 0;
      
      for (const tableName of tables) {
        try {
          console.log(`📥 Migrating: ${tableName}`);
          const sourceData = await sourcePool.query(`SELECT * FROM "${tableName}"`);
          const rows = sourceData.rows;
          console.log(`  📊 Exported ${rows.length} rows`);
          
          if (rows.length === 0) {
            console.log(`  ⏭️  Skipping - no data`);
            continue;
          }
          
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
            dataMigrated++;
          } catch (error) {
            await destClient.query('ROLLBACK');
            if (error.message.includes('does not exist')) {
              console.log(`  ❌ Table doesn't exist`);
            } else {
              console.error(`  ❌ Error:`, error.message);
            }
            dataFailed++;
          } finally {
            destClient.release();
          }
        } catch (error) {
          console.error(`  ❌ Error:`, error.message);
          dataFailed++;
        }
      }
      
      console.log(`\n📊 Data Migration: ${dataMigrated} succeeded, ${dataFailed} failed\n`);
    }
    
    console.log('✅ Migration process completed!');
    console.log(`\n📄 Schema SQL file saved: ${schemaFile}`);
    console.log('   You can use this file to create tables manually if needed.\n');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourcePool.end();
    await destPool.end();
    console.log('🔌 Connections closed');
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

