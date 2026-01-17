const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const execAsync = promisify(exec);

// Source database (current/local)
const sourceHost = process.env.DB_HOST || 'localhost';
const sourcePort = process.env.DB_PORT || 5432;
const sourceDb = process.env.DB_NAME || 'Branded_UK';
const sourceUser = process.env.DB_USER || 'postgres';
const sourcePassword = process.env.DB_PASSWORD || '1234';

// Destination database (Digital Ocean)
const destHost = '206.189.119.150';
const destPort = 5432;
const destDb = 'brandeduk_prod';
const destUser = 'brandeduk';
const destPassword = 'omglol123';

// Set PGPASSWORD environment variable for password authentication
process.env.PGPASSWORD = sourcePassword;

async function migrateDatabase() {
  console.log('🚀 Starting database migration using pg_dump and psql...\n');
  
  const dumpFile = path.join(__dirname, 'database_dump.sql');
  let dumpFileFinal = dumpFile;
  
  try {
    // Step 1: Export database using pg_dump
    console.log('📤 Step 1: Exporting database...');
    console.log(`   Source: ${sourceUser}@${sourceHost}:${sourcePort}/${sourceDb}\n`);
    
    // Try PostgreSQL 15 first (more compatible), fallback to 17
    let pgDumpPath = `"C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe"`;
    // Check if file exists, if not use 17
    if (!fs.existsSync('C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe')) {
      pgDumpPath = `"C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe"`;
    }
    
    // Use plain SQL format
    dumpFileFinal = dumpFile;
    const dumpCommand = `${pgDumpPath} -h ${sourceHost} -p ${sourcePort} -U ${sourceUser} -d ${sourceDb} -F p -f "${dumpFileFinal}" --no-owner --no-acl`;
    
    console.log('   Running pg_dump...');
    const { stdout: dumpStdout, stderr: dumpStderr } = await execAsync(dumpCommand, {
      maxBuffer: 1024 * 1024 * 100 // 100MB buffer for large databases
    });
    
    if (dumpStderr && !dumpStderr.includes('WARNING')) {
      console.warn('   ⚠️  Warnings:', dumpStderr);
    }
    
    console.log('   ✅ Database exported successfully\n');
    
    // Step 2: Import to destination database
    console.log('📥 Step 2: Importing to destination database...');
    console.log(`   Destination: ${destUser}@${destHost}:${destPort}/${destDb}\n`);
    
    // Update PGPASSWORD for destination
    process.env.PGPASSWORD = destPassword;
    
    // Use psql from PostgreSQL installation (try 15 first)
    let psqlPath = `"C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe"`;
    if (!fs.existsSync('C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe')) {
      psqlPath = `"C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe"`;
    }
    const importCommand = `${psqlPath} -h ${destHost} -p ${destPort} -U ${destUser} -d ${destDb} -f "${dumpFileFinal}"`;
    
    console.log('   Running psql import...');
    const { stdout: importStdout, stderr: importStderr } = await execAsync(importCommand, {
      maxBuffer: 1024 * 1024 * 100 // 100MB buffer for large databases
    });
    
    if (importStdout) {
      console.log('   Output:', importStdout);
    }
    
    if (importStderr && !importStderr.includes('ERROR')) {
      console.warn('   ⚠️  Warnings:', importStderr);
    }
    
    console.log('   ✅ Database imported successfully\n');
    
    // Clean up dump file
    if (fs.existsSync(dumpFileFinal)) {
      fs.unlinkSync(dumpFileFinal);
      console.log('   🗑️  Cleaned up temporary dump file\n');
    }
    
    console.log('✅ Migration completed successfully!');
    console.log(`\n📊 Your database has been migrated to:`);
    console.log(`   Host: ${destHost}`);
    console.log(`   Database: ${destDb}`);
    console.log(`   User: ${destUser}\n`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    
    if (error.stderr) {
      console.error('   Error details:', error.stderr);
    }
    
    // Clean up dump file on error
    if (fs.existsSync(dumpFileFinal)) {
      fs.unlinkSync(dumpFileFinal);
    }
    
    throw error;
  }
}

// Run migration
migrateDatabase()
  .then(() => {
    console.log('🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    console.log('\n💡 Troubleshooting tips:');
    console.log('   1. Make sure pg_dump and psql are installed and in your PATH');
    console.log('   2. Check that both databases are accessible');
    console.log('   3. Verify your source database credentials in .env file');
    console.log('   4. Ensure the destination database exists and user has proper permissions');
    process.exit(1);
  });

