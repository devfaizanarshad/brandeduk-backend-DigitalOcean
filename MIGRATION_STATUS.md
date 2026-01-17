# Database Migration Status

## Current Situation

The migration script successfully:
- ✅ Connected to both source and destination databases
- ✅ Found 32 tables to migrate
- ✅ Exported all data from source database

However, it encountered **permission issues** when trying to create tables on the Digital Ocean database. The user `brandeduk` doesn't have `CREATE` permissions on the `public` schema.

## Solutions

You have **3 options** to complete the migration:

### Option 1: Use pg_dump (RECOMMENDED) ⭐

This is the **standard PostgreSQL method** and most reliable. It doesn't require CREATE permissions if tables already exist, or you can run it with a user that has proper permissions.

**See:** `migrate-using-pgdump.md` for detailed instructions.

**Quick steps:**
```bash
# Export
pg_dump -h localhost -p 5432 -U postgres -d Branded_UK -F c -f backup.dump

# Import
pg_restore -h 206.189.119.150 -p 5432 -U brandeduk -d brandeduk_prod backup.dump
```

### Option 2: Grant Permissions

If you have admin/superuser access to the Digital Ocean database:

1. Run the permission script:
   ```bash
   node grant-permissions.js
   ```

2. Then run the migration:
   ```bash
   node migrate-database.js
   ```

**Note:** You may need to connect as a superuser for this to work.

### Option 3: Contact Digital Ocean Support

Ask Digital Ocean support to:
1. Grant `CREATE` permission on `public` schema to user `brandeduk`
2. Or provide a superuser account for the migration
3. Or create the tables structure first, then you can import data

## What Was Exported

The script successfully exported data from all 32 tables:

- **Small tables:** accreditations (48), age_groups (3), brands (91), etc.
- **Medium tables:** categories (282), colours (2652), products (99,731), etc.
- **Large tables:** 
  - product_categories: **853,928 rows**
  - product_flags: **220,585 rows**
  - product_sectors: **115,619 rows**
  - product_fabrics: **56,530 rows**
  - product_accreditations: **313,333 rows**

**Total:** Over 1.5 million rows of data ready to migrate!

## Next Steps

1. **Choose your migration method** (pg_dump is recommended)
2. **Run the migration**
3. **Update your `.env` file** with new database credentials:
   ```env
   DB_HOST=206.189.119.150
   DB_PORT=5432
   DB_NAME=brandeduk_prod
   DB_USER=brandeduk
   DB_PASSWORD=omglol123
   DB_SSL=true
   ```
4. **Test your application** to ensure everything works

## Files Created

- `migrate-database.js` - Node.js migration script (needs permissions)
- `migrate-database-v2.js` - Improved version (still needs permissions)
- `migrate-database-simple.js` - Uses pg_dump (recommended if you have pg_dump)
- `grant-permissions.js` - Script to grant permissions (needs admin access)
- `migrate-using-pgdump.md` - Detailed pg_dump instructions
- `MIGRATION_GUIDE.md` - Complete migration guide

## Recommendation

**Use pg_dump method** (`migrate-using-pgdump.md`) as it's:
- The standard PostgreSQL way
- Most reliable
- Handles all edge cases
- Works even with limited permissions (if tables are pre-created)

If you don't have pg_dump installed, you can:
- Install PostgreSQL client tools
- Or use an online tool
- Or ask Digital Ocean support to help with the migration

