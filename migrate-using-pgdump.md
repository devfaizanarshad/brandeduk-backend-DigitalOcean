# Alternative Migration Method: Using pg_dump

Since the Node.js script encountered permission issues, here's an alternative method using PostgreSQL's native tools.

## Prerequisites

1. Install PostgreSQL client tools (if not already installed):
   - **Windows:** Download from https://www.postgresql.org/download/windows/
   - **Mac:** `brew install postgresql`
   - **Linux:** `sudo apt-get install postgresql-client` (Ubuntu/Debian)

## Step 1: Export Database

Open a terminal/command prompt and run:

```bash
# Set password as environment variable (Windows PowerShell)
$env:PGPASSWORD="your_current_password"

# Export database
pg_dump -h localhost -p 5432 -U postgres -d Branded_UK -F c -f database_backup.dump

# Or if using connection string from .env:
pg_dump -h YOUR_CURRENT_HOST -p 5432 -U YOUR_CURRENT_USER -d YOUR_CURRENT_DB -F c -f database_backup.dump
```

**Note:** Replace the connection details with your actual current database credentials.

## Step 2: Import to Digital Ocean

```bash
# Set password for destination
$env:PGPASSWORD="omglol123"

# Import database
pg_restore -h 206.189.119.150 -p 5432 -U brandeduk -d brandeduk_prod -v database_backup.dump
```

## Alternative: Using SQL Format

If you prefer SQL format (easier to inspect):

### Export:
```bash
pg_dump -h localhost -p 5432 -U postgres -d Branded_UK -F p -f database_backup.sql --no-owner --no-acl
```

### Import:
```bash
psql -h 206.189.119.150 -p 5432 -U brandeduk -d brandeduk_prod -f database_backup.sql
```

## Troubleshooting

### Permission Denied
If you get permission errors, you may need to:
1. Contact Digital Ocean support to grant your user proper permissions
2. Or use a superuser account for the migration

### Connection Issues
- Ensure your IP is whitelisted in Digital Ocean firewall
- Check that the database allows remote connections
- Verify SSL settings (Digital Ocean usually requires SSL)

### Large Database
For very large databases:
- Use custom format (`-F c`) for faster migration
- Consider using `--jobs` flag with pg_restore for parallel restoration
- Example: `pg_restore -j 4 ...` (uses 4 parallel jobs)

## After Migration

1. Verify data:
```bash
psql -h 206.189.119.150 -p 5432 -U brandeduk -d brandeduk_prod -c "SELECT COUNT(*) FROM products;"
```

2. Update your `.env` file:
```env
DB_HOST=206.189.119.150
DB_PORT=5432
DB_NAME=brandeduk_prod
DB_USER=brandeduk
DB_PASSWORD=omglol123
DB_SSL=true
```

3. Test your application!

