# Database Migration Guide

This guide will help you migrate your database from your current setup to the Digital Ocean server.

## Prerequisites

- Node.js installed
- Access to both source and destination databases
- PostgreSQL client tools (optional, for `migrate-database-simple.js`)

## Migration Options

You have two migration scripts available:

### Option 1: Node.js Migration Script (Recommended)
**File:** `migrate-database.js`

This script uses pure Node.js and the `pg` library. It works on any platform and doesn't require PostgreSQL client tools.

**Usage:**
```bash
node migrate-database.js
```

**What it does:**
1. Connects to your current database (from `.env` file)
2. Exports all tables, indexes, and foreign keys
3. Creates the schema on the Digital Ocean database
4. Imports all data

### Option 2: PostgreSQL Native Tools
**File:** `migrate-database-simple.js`

This script uses `pg_dump` and `psql` commands. Requires PostgreSQL client tools to be installed.

**Usage:**
```bash
node migrate-database-simple.js
```

**Requirements:**
- `pg_dump` and `psql` must be in your PATH
- On Windows, you may need to install PostgreSQL client tools separately

## Current Database Configuration

The migration script will read your current database settings from your `.env` file:
- `DB_HOST` (default: localhost)
- `DB_PORT` (default: 5432)
- `DB_NAME` (default: Branded_UK)
- `DB_USER` (default: postgres)
- `DB_PASSWORD` (default: 1234)
- `DB_SSL` (default: false)

## Destination Database (Digital Ocean)

The script is configured to migrate to:
- **Host:** 206.189.119.150
- **Port:** 5432
- **Database:** brandeduk_prod
- **User:** brandeduk
- **Password:** omglol123

## Steps to Migrate

1. **Ensure your `.env` file has the correct source database credentials:**
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=Branded_UK
   DB_USER=postgres
   DB_PASSWORD=your_current_password
   DB_SSL=false
   ```

2. **Run the migration script:**
   ```bash
   node migrate-database.js
   ```

3. **Wait for the migration to complete.** The script will:
   - Test connections to both databases
   - List all tables to be migrated
   - Create tables and indexes
   - Import all data
   - Show progress for each step

4. **Update your application configuration** to use the new database:
   
   Update your `.env` file with the new credentials:
   ```env
   DB_HOST=206.189.119.150
   DB_PORT=5432
   DB_NAME=brandeduk_prod
   DB_USER=brandeduk
   DB_PASSWORD=omglol123
   DB_SSL=true
   DB_POOL_MAX=50
   DB_POOL_MIN=5
   ```

5. **Test your application** to ensure everything works with the new database.

## Troubleshooting

### Connection Errors

If you get connection errors:
- Verify the destination database is accessible from your network
- Check firewall settings on Digital Ocean
- Ensure the database user has proper permissions
- Try connecting manually with `psql` to test connectivity

### SSL Connection Issues

If you encounter SSL errors:
- The script sets `rejectUnauthorized: false` for SSL connections
- For production, you may want to use proper SSL certificates

### Large Database Migration

For very large databases:
- The migration may take some time
- Consider running during off-peak hours
- Monitor the progress in the console output

### Partial Migration

If the migration fails partway through:
- The script will show which tables were successfully migrated
- You can re-run the script (it will truncate tables before importing)
- Or manually fix issues and re-run specific parts

## After Migration

1. **Verify data integrity:**
   - Check row counts match between source and destination
   - Test critical queries
   - Verify relationships and foreign keys

2. **Update application:**
   - Update `.env` file with new database credentials
   - Restart your application
   - Test all API endpoints

3. **Backup:**
   - Keep a backup of your original database
   - Consider setting up automated backups on Digital Ocean

## Notes

- The migration script will **truncate** existing data in destination tables before importing
- Foreign keys are created after tables and data are imported
- Indexes are recreated on the destination database
- The script handles errors gracefully and continues with other tables

## Support

If you encounter issues:
1. Check the error messages in the console
2. Verify database credentials
3. Ensure both databases are accessible
4. Check network connectivity to Digital Ocean

