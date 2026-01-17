const { Pool } = require('pg');
require('dotenv').config();

// Source database (current/local)
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

// Get all table names
async function getAllTables(pool) {
  const query = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;
  const result = await pool.query(query);
  return result.rows.map(row => row.table_name);
}

// Get full CREATE TABLE statement using pg_get_tabledef or manual construction
async function getFullTableDefinition(pool, tableName) {
  const client = await pool.connect();
  try {
    // Try to get the full table definition using a query that mimics pg_dump
    const query = `
      SELECT 
        'CREATE TABLE ' || quote_ident(table_name) || ' (' || E'\\n' ||
        string_agg(
          '  ' || quote_ident(column_name) || ' ' ||
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
            WHEN udt_name = 'array' THEN 
              (SELECT 'ARRAY' FROM information_schema.element_types 
               WHERE object_schema = 'public' 
               AND object_name = $1 
               AND collection_type_identifier = (SELECT type_identifier FROM information_schema.columns 
                                                  WHERE table_schema = 'public' 
                                                  AND table_name = $1 
                                                  AND column_name = c.column_name))
            ELSE udt_name
          END ||
          CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
          CASE 
            WHEN column_default IS NOT NULL AND column_default NOT LIKE 'nextval%' 
            THEN ' DEFAULT ' || column_default 
            WHEN column_default LIKE 'nextval%'
            THEN ' DEFAULT ' || column_default
            ELSE '' 
          END,
          ',' || E'\\n'
          ORDER BY ordinal_position
        ) || E'\\n' || ');' as create_statement
      FROM information_schema.columns c
      WHERE table_schema = 'public' 
      AND table_name = $1
      GROUP BY table_name;
    `;
    
    const result = await client.query(query, [tableName]);
    if (result.rows[0]?.create_statement) {
      return result.rows[0].create_statement;
    }
    
    // Fallback: simpler version
    return await getSimpleCreateTable(pool, tableName);
  } finally {
    client.release();
  }
}

// Simpler CREATE TABLE statement builder
async function getSimpleCreateTable(pool, tableName) {
  const query = `
    SELECT 
      column_name,
      CASE 
        WHEN data_type = 'ARRAY' THEN 
          (SELECT 'ARRAY(' || udt_name || ')' 
           FROM information_schema.element_types 
           WHERE object_schema = 'public' 
           AND object_name = $1 
           LIMIT 1)
        ELSE 
          CASE 
            WHEN data_type = 'character varying' THEN 'VARCHAR(' || COALESCE(character_maximum_length::text, '') || ')'
            WHEN data_type = 'character' THEN 'CHAR(' || COALESCE(character_maximum_length::text, '') || ')'
            WHEN data_type = 'numeric' THEN 'NUMERIC' ||
              CASE 
                WHEN numeric_precision IS NOT NULL AND numeric_scale IS NOT NULL
                THEN '(' || numeric_precision || ',' || numeric_scale || ')'
                WHEN numeric_precision IS NOT NULL
                THEN '(' || numeric_precision || ')'
                ELSE ''
              END
            ELSE UPPER(REPLACE(data_type, ' ', '_'))
          END
      END as full_type,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = $1
    ORDER BY ordinal_position;
  `;
  
  const result = await pool.query(query, [tableName]);
  const columns = result.rows.map(col => {
    let def = `"${col.column_name}" ${col.full_type}`;
    if (col.is_nullable === 'NO') def += ' NOT NULL';
    if (col.column_default) def += ' DEFAULT ' + col.column_default;
    return def;
  });
  
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columns.join(',\n  ')}\n);`;
}

// Export and import data
async function migrateTableData(sourcePool, destPool, tableName) {
  console.log(`📥 Migrating data for: ${tableName}`);
  
  // Export from source
  const sourceData = await sourcePool.query(`SELECT * FROM "${tableName}"`);
  const rows = sourceData.rows;
  console.log(`  📊 Exported ${rows.length} rows`);
  
  if (rows.length === 0) {
    console.log(`  ⏭️  Skipping - no data`);
    return;
  }
  
  // Import to destination
  const columns = Object.keys(rows[0]);
  const columnNames = columns.map(col => `"${col}"`).join(', ');
  
  const client = await destPool.connect();
  try {
    await client.query('BEGIN');
    
    // Truncate
    await client.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
    
    // Insert in batches
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const valuesArray = batch.map(row => columns.map(col => row[col]));
      
      const allPlaceholders = batch.map((_, batchIdx) => {
        return '(' + columns.map((_, colIdx) => `$${batchIdx * columns.length + colIdx + 1}`).join(', ') + ')';
      }).join(', ');
      
      const allValues = valuesArray.flat();
      
      await client.query(
        `INSERT INTO "${tableName}" (${columnNames}) VALUES ${allPlaceholders}`,
        allValues
      );
    }
    
    await client.query('COMMIT');
    console.log(`  ✅ Imported ${rows.length} rows`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Main migration
async function migrateDatabase() {
  console.log('🚀 Starting database migration (v2)...\n');
  
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
    
    // Create tables
    console.log('📦 Creating tables...\n');
    for (const tableName of tables) {
      try {
        console.log(`📝 Creating table: ${tableName}`);
        const createStatement = await getFullTableDefinition(sourcePool, tableName);
        
        // Try to create table
        try {
          await destPool.query(createStatement);
          console.log(`  ✅ Created: ${tableName}`);
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log(`  ⚠️  Table already exists: ${tableName}`);
          } else if (error.message.includes('permission denied')) {
            console.log(`  ❌ Permission denied for: ${tableName}`);
            console.log(`  💡 You may need to grant CREATE permissions. See grant-permissions.js`);
            continue; // Skip this table
          } else {
            throw error;
          }
        }
      } catch (error) {
        console.error(`  ❌ Error creating ${tableName}:`, error.message);
      }
    }
    
    console.log('\n📥 Migrating data...\n');
    for (const tableName of tables) {
      try {
        await migrateTableData(sourcePool, destPool, tableName);
      } catch (error) {
        if (error.message.includes('does not exist')) {
          console.log(`  ⚠️  Table doesn't exist (skipped creation due to permissions): ${tableName}`);
        } else {
          console.error(`  ❌ Error migrating ${tableName}:`, error.message);
        }
      }
    }
    
    console.log('\n✅ Migration process completed!');
    console.log('\n💡 Note: Some tables may not have been migrated due to permission issues.');
    console.log('   If you see permission errors, you may need to:');
    console.log('   1. Run: node grant-permissions.js (if you have admin access)');
    console.log('   2. Or use pg_dump method (see migrate-using-pgdump.md)');
    console.log('   3. Or contact Digital Ocean support to grant permissions');
    
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

