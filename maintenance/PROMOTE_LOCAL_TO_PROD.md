# Promote local DB to production (one-time sync)

Pushes your **local** `brandeduk_ralawise_backup` database to **production** `brandeduk_prod` so both are 100% in sync.

## Prerequisites

- PostgreSQL client tools (`pg_dump`, `pg_restore`) in PATH or in default install (e.g. `C:\Program Files\PostgreSQL\16\bin` on Windows).
- Local Postgres running with `brandeduk_ralawise_backup` (your current dev DB).
- Network access to production server and production DB credentials.

## 1. Set environment variables

For the **promote** run, production target is read from env. Set these (in `.env` or in the shell for one run):

```env
# Production target (used by promote script)
DB_HOST=206.189.119.150
DB_NAME=brandeduk_prod
DB_USER=brandeduk
DB_PASSWORD=omglol123
DB_PORT=5432
DB_SSL=true
```

Local dump uses (defaults are fine if your local DB is standard):

- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` — or script defaults: `localhost`, `5432`, `postgres`, `1234`
- `LOCAL_SOURCE_DB=brandeduk_ralawise_backup` (default)

## 2. Run the promote script

**Warning:** This **overwrites** production data to match local. Back up production first if needed (e.g. `backup-production-to-local.js` or your own dump).

**PowerShell:**

```powershell
$env:CONFIRM_PROMOTE_PROD = "YES"
$env:DB_HOST = "206.189.119.150"
$env:DB_NAME = "brandeduk_prod"
$env:DB_USER = "brandeduk"
$env:DB_PASSWORD = "omglol123"
$env:DB_PORT = "5432"
$env:DB_SSL = "true"
node maintenance/promote-local-backup-to-production.js
```

**Bash / Linux / Mac:**

```bash
export CONFIRM_PROMOTE_PROD=YES
export DB_HOST=206.189.119.150
export DB_NAME=brandeduk_prod
export DB_USER=brandeduk
export DB_PASSWORD=omglol123
export DB_PORT=5432
export DB_SSL=true
node maintenance/promote-local-backup-to-production.js
```

Or uncomment/set the same vars in `.env` and run:

```bash
# In .env set CONFIRM_PROMOTE_PROD=YES and the DB_* production vars, then:
node maintenance/promote-local-backup-to-production.js
```

## 3. What the script does

1. **Dump** local `brandeduk_ralawise_backup` to a custom-format file in `maintenance/backups/`.
2. **Restore** that dump into production `brandeduk_prod` on `206.189.119.150` with `--clean` (recreates objects so prod matches local). Uses SSL when `DB_SSL=true`.
3. **Refresh materialized views** on production (`product_search_mv`, `product_search_materialized`) so search/filters use up-to-date data.

After it finishes, production and local are in sync (prod = copy of local at that moment), and views are refreshed.

## 4. Optional: verify

```bash
node maintenance/verify-backup.js
```

(Adjust that script if it expects different env for “local” vs “prod”.)

## Re-running for ongoing sync

Run the same promote command whenever you want to push local changes to production again. There is no automatic continuous sync; each run is a full one-time sync.
