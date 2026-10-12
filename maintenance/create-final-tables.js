const { Pool } = require('pg');
require('dotenv').config();

// Destination database
const destConfig = {
  host: '206.189.119.150',
  port: 5432,
  database: 'brandeduk_prod',
  user: 'brandeduk',
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

const destPool = new Pool(destConfig);

// Source database
const sourceConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'Branded_UK',
  user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

const sourcePool = new Pool(sourceConfig);

const tablesToCreate = [
  {
    name: 'related_sectors',
    sql: `CREATE TABLE IF NOT EXISTS "related_sectors" (
      "id" integer NOT NULL DEFAULT nextval('related_sectors_id_seq'::regclass),
      "name" character varying(200) NOT NULL,
      "slug" character varying(200) NOT NULL,
      "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
    );`
  },
  {
    name: 'related_sports',
    sql: `CREATE TABLE IF NOT EXISTS "related_sports" (
      "id" integer NOT NULL DEFAULT nextval('related_sports_id_seq'::regclass),
      "name" character varying(200) NOT NULL,
      "slug" character varying(200) NOT NULL,
      "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
    );`
  },
  {
    name: 'special_flags',
    sql: `CREATE TABLE IF NOT EXISTS "special_flags" (
      "id" integer NOT NULL DEFAULT nextval('special_flags_id_seq'::regclass),
      "name" character varying(100) NOT NULL,
      "slug" character varying(100) NOT NULL,
      "flag_type" character varying(50),
      "display_order" integer DEFAULT 0,
      "description" text,
      "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
    );`
  },
  {
    name: 'style_keywords',
    sql: `CREATE TABLE IF NOT EXISTS "style_keywords" (
      "id" integer NOT NULL DEFAULT nextval('style_keywords_id_seq'::regclass),
      "name" character varying(200) NOT NULL,
      "slug" character varying(200) NOT NULL,
      "keyword_type" character varying(50),
      "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
    );`
  }
];

async function createTablesAndMigrate() {
  console.log('🚀 Creating final tables and migrating data...\n');
  
  try {
    // Create tables
    console.log('📦 Creating tables...\n');
    const client = await destPool.connect();
    
    try {
      for (const table of tablesToCreate) {
        try {
          await client.query(table.sql);
          console.log(`  ✅ Created: ${table.name}`);
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log(`  ⏭️  Already exists: ${table.name}`);
          } else {
            console.error(`  ❌ Error creating ${table.name}:`, error.message);
          }
        }
      }
    } finally {
      client.release();
    }
    
    // Migrate data
    console.log('\n📥 Migrating data...\n');
    
    for (const table of tablesToCreate) {
      try {
        console.log(`📥 Migrating: ${table.name}`);
        
        // Get data from source
        const sourceData = await sourcePool.query(`SELECT * FROM "${table.name}"`);
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
          await destClient.query(`TRUNCATE TABLE "${table.name}" CASCADE`);
          
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
              `INSERT INTO "${table.name}" (${columnNames}) VALUES ${values}`,
              allValues
            );
          }
          
          await destClient.query('COMMIT');
          console.log(`  ✅ Imported ${rows.length} rows`);
        } catch (error) {
          await destClient.query('ROLLBACK');
          console.error(`  ❌ Error:`, error.message);
        } finally {
          destClient.release();
        }
      } catch (error) {
        console.error(`  ❌ Error migrating ${table.name}:`, error.message);
      }
    }
    
    console.log('\n✅ All done!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await sourcePool.end();
    await destPool.end();
    console.log('\n🔌 Connections closed');
  }
}

createTablesAndMigrate()
  .then(() => {
    console.log('\n🎉 Migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

