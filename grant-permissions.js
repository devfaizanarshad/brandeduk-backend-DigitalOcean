const { Pool } = require('pg');
require('dotenv').config();

// Destination database (Digital Ocean)
const destConfig = {
  host: '206.189.119.150',
  port: 5432,
  database: 'brandeduk_prod',
  user: 'brandeduk',
  password: 'omglol123',
  ssl: { rejectUnauthorized: false },
};

// Admin connection (you may need to use a superuser account)
// If you have admin access, update these credentials
const adminConfig = {
  host: '206.189.119.150',
  port: 5432,
  database: 'brandeduk_prod',
  user: 'brandeduk', // Try with current user first, may need admin user
  password: 'omglol123',
  ssl: { rejectUnauthorized: false },
};

async function grantPermissions() {
  console.log('🔐 Granting permissions to database user...\n');
  
  const pool = new Pool(adminConfig);
  
  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Connected to database\n');
    
    // Grant schema usage
    console.log('📝 Granting schema permissions...');
    await pool.query('GRANT USAGE ON SCHEMA public TO brandeduk;');
    console.log('  ✅ Granted USAGE on schema public');
    
    // Grant create privileges
    await pool.query('GRANT CREATE ON SCHEMA public TO brandeduk;');
    console.log('  ✅ Granted CREATE on schema public');
    
    // Grant all privileges on all existing tables
    await pool.query('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO brandeduk;');
    console.log('  ✅ Granted privileges on existing tables');
    
    // Grant privileges on sequences
    await pool.query('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO brandeduk;');
    console.log('  ✅ Granted privileges on sequences');
    
    // Set default privileges for future objects
    await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO brandeduk;');
    console.log('  ✅ Set default privileges for future tables');
    
    await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO brandeduk;');
    console.log('  ✅ Set default privileges for future sequences');
    
    console.log('\n✅ Permissions granted successfully!');
    console.log('\n💡 You can now run the migration script: node migrate-database.js');
    
  } catch (error) {
    console.error('❌ Error granting permissions:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('   1. You may need to connect as a superuser/admin');
    console.log('   2. Contact Digital Ocean support to grant permissions');
    console.log('   3. Or use pg_dump/pg_restore with a user that has proper permissions');
    throw error;
  } finally {
    await pool.end();
  }
}

grantPermissions()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });

