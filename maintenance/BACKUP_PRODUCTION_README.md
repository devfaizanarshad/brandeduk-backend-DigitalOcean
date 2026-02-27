# Backup Production (Ralawise) to Local

Creates a local copy of the production Ralawise database for merging tests with UNEEK.

## Result

After running, you have:

| Database | Purpose |
|----------|---------|
| `ecommerce` | UNEEK data (products, product_variants, suppliers) |
| `brandeduk_ralawise_backup` | Ralawise production backup (products, styles, brands, etc.) |

## Prerequisites

- PostgreSQL installed locally (postgres user, password 1234)
- PostgreSQL client tools in PATH: `pg_dump`, `createdb`, `pg_restore`, `psql`
- Network access to production: 206.189.119.150:5432

## Run

```bash
node maintenance/backup-production-to-local.js
```

Uses `.env` for production creds; local uses:
- Host: localhost (or PGHOST)
- User: postgres (or PGUSER)
- Password: 1234 (or PGPASSWORD)

## Manual Steps (if script fails)

```powershell
# 1. Dump production
$env:PGPASSWORD="omglol123"
$env:PGSSLMODE="require"
pg_dump -h 206.189.119.150 -p 5432 -U brandeduk -d brandeduk_prod -Fc -f maintenance/backups/ralawise.dump

# 2. Create local DB
$env:PGPASSWORD="1234"
dropdb -h localhost -U postgres brandeduk_ralawise_backup  # if exists
createdb -h localhost -U postgres brandeduk_ralawise_backup

# 3. Restore
pg_restore -h localhost -U postgres -d brandeduk_ralawise_backup --no-owner --no-acl maintenance/backups/ralawise.dump
```

## Notes

- pg_restore may exit 1 for role/owner warnings; data is still restored
- Backups are saved in `maintenance/backups/`
- After restore, connect to `brandeduk_ralawise_backup` for Ralawise data
