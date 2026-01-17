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
  ssl: { rejectUnauthorized: false }, // Usually required for remote databases
};

const sourcePool = new Pool(sourceConfig);
const destPool = new Pool(destConfig);

// Helper function to get all table names
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

// Helper function to get table schema
async function getTableSchema(pool, tableName) {
  const query = `
    SELECT 
      column_name,
      data_type,
      character_maximum_length,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = $1
    ORDER BY ordinal_position;
  `;
  const result = await pool.query(query, [tableName]);
  return result.rows;
}

// Helper function to get CREATE TABLE statement using pg_get_tabledef
async function getCreateTableStatement(pool, tableName) {
  // Try to use pg_get_tabledef if available, otherwise build manually
  try {
    const query = `SELECT pg_get_tabledef('${tableName}') as create_statement;`;
    const result = await pool.query(query);
    if (result.rows[0]?.create_statement) {
      return result.rows[0].create_statement;
    }
  } catch (e) {
    // Fall back to manual construction
  }
  
  // Manual construction as fallback
  const query = `
    SELECT 
      'CREATE TABLE IF NOT EXISTS ' || quote_ident(table_name) || ' (' ||
      string_agg(
        quote_ident(column_name) || ' ' || 
        CASE 
          WHEN data_type = 'character varying' THEN 'VARCHAR(' || COALESCE(character_maximum_length::text, '') || ')'
          WHEN data_type = 'character' THEN 'CHAR(' || COALESCE(character_maximum_length::text, '') || ')'
          WHEN data_type = 'numeric' THEN 'NUMERIC'
          WHEN data_type = 'integer' THEN 'INTEGER'
          WHEN data_type = 'bigint' THEN 'BIGINT'
          WHEN data_type = 'smallint' THEN 'SMALLINT'
          WHEN data_type = 'real' THEN 'REAL'
          WHEN data_type = 'double precision' THEN 'DOUBLE PRECISION'
          WHEN data_type = 'boolean' THEN 'BOOLEAN'
          WHEN data_type = 'date' THEN 'DATE'
          WHEN data_type = 'timestamp without time zone' THEN 'TIMESTAMP'
          WHEN data_type = 'timestamp with time zone' THEN 'TIMESTAMPTZ'
          WHEN data_type = 'text' THEN 'TEXT'
          WHEN data_type = 'jsonb' THEN 'JSONB'
          WHEN data_type = 'json' THEN 'JSON'
          WHEN data_type = 'bytea' THEN 'BYTEA'
          WHEN data_type = 'uuid' THEN 'UUID'
          ELSE UPPER(data_type)
        END ||
        CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
        CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
        ', '
      ) || ');' as create_statement
    FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = $1
    GROUP BY table_name;
  `;
  const result = await pool.query(query, [tableName]);
  return result.rows[0]?.create_statement;
}

// Helper function to get indexes
async function getIndexes(pool, tableName) {
  const query = `
    SELECT 
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' 
    AND tablename = $1;
  `;
  const result = await pool.query(query, [tableName]);
  return result.rows;
}

// Helper function to get foreign keys
async function getForeignKeys(pool, tableName) {
  const query = `
    SELECT
      tc.constraint_name,
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = $1
      AND tc.table_schema = 'public';
  `;
  const result = await pool.query(query, [tableName]);
  return result.rows;
}

// Export data from a table
async function exportTableData(pool, tableName) {
  const query = `SELECT * FROM ${tableName}`;
  const result = await pool.query(query);
  return result.rows;
}

// Import data to a table using COPY for better performance
async function importTableData(pool, tableName, rows) {
  if (rows.length === 0) {
    console.log(`  ⏭️  Skipping ${tableName} - no data to import`);
    return;
  }

  const columns = Object.keys(rows[0]);
  const columnNames = columns.map(col => `"${col}"`).join(', ');
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Truncate existing data
    await client.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
    
    // Use parameterized queries in batches for better performance
    const batchSize = 500;
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const valuesArray = batch.map(row => columns.map(col => row[col]));
      
      // Build multi-value INSERT for batch
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
    console.log(`  ✅ Imported ${rows.length} rows to ${tableName}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Main migration function
async function migrateDatabase() {
  console.log('🚀 Starting database migration...\n');
  
  try {
    // Test source connection
    console.log('📡 Testing source database connection...');
    await sourcePool.query('SELECT NOW()');
    console.log('✅ Source database connected\n');
    
    // Test destination connection
    console.log('📡 Testing destination database connection...');
    await destPool.query('SELECT NOW()');
    console.log('✅ Destination database connected\n');
    
    // Get all tables from source
    console.log('📋 Getting list of tables...');
    const tables = await getAllTables(sourcePool);
    console.log(`✅ Found ${tables.length} tables: ${tables.join(', ')}\n`);
    
    // Step 1: Create tables and indexes
    console.log('📦 Step 1: Creating tables and indexes...\n');
    for (const tableName of tables) {
      try {
        console.log(`📝 Processing table: ${tableName}`);
        
        // Get and execute CREATE TABLE statement
        const createStatement = await getCreateTableStatement(sourcePool, tableName);
        if (createStatement) {
          await destPool.query(createStatement);
          console.log(`  ✅ Created table: ${tableName}`);
        }
        
        // Get and create indexes
        const indexes = await getIndexes(sourcePool, tableName);
        for (const index of indexes) {
          // Skip primary key indexes (already created with table)
          if (!index.indexdef.includes('PRIMARY KEY')) {
            try {
              await destPool.query(index.indexdef);
              console.log(`  ✅ Created index: ${index.indexname}`);
            } catch (err) {
              // Index might already exist or have dependencies
              console.log(`  ⚠️  Skipped index: ${index.indexname} (${err.message})`);
            }
          }
        }
        
        // Get and create foreign keys
        const foreignKeys = await getForeignKeys(sourcePool, tableName);
        for (const fk of foreignKeys) {
          try {
            const fkStatement = `
              ALTER TABLE "${fk.table_name}"
              ADD CONSTRAINT "${fk.constraint_name}"
              FOREIGN KEY ("${fk.column_name}")
              REFERENCES "${fk.foreign_table_name}" ("${fk.foreign_column_name}");
            `;
            await destPool.query(fkStatement);
            console.log(`  ✅ Created foreign key: ${fk.constraint_name}`);
          } catch (err) {
            console.log(`  ⚠️  Skipped foreign key: ${fk.constraint_name} (${err.message})`);
          }
        }
        
        console.log('');
      } catch (error) {
        console.error(`  ❌ Error processing table ${tableName}:`, error.message);
      }
    }
    
    // Step 2: Import data
    console.log('📥 Step 2: Importing data...\n');
    for (const tableName of tables) {
      try {
        console.log(`📥 Exporting data from: ${tableName}`);
        const data = await exportTableData(sourcePool, tableName);
        console.log(`  📊 Exported ${data.length} rows`);
        
        if (data.length > 0) {
          await importTableData(destPool, tableName, data);
        } else {
          console.log(`  ⏭️  Skipping ${tableName} - no data`);
        }
        console.log('');
      } catch (error) {
        console.error(`  ❌ Error migrating data for ${tableName}:`, error.message);
      }
    }
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sourcePool.end();
    await destPool.end();
    console.log('\n🔌 Database connections closed');
  }
}

// Run migration
migrateDatabase()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });

