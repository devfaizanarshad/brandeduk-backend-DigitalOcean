# Supplier catalogue sync

The supplier importer updates the existing catalogue schema and API contract. It does not replace the frontend flow or admin-managed merchandising, markup overrides, display order, or customization templates.

## Safe workflow

1. Place the supplier file in a server-only data directory. Large supplier files should not be committed to Git.
2. Run a source-only preflight (no database connection or writes):

   ```bash
   npm run catalog:sync -- --supplier ralawise --source /root/app/data/CustomerDataFull.csv
   ```

3. Take the normal PostgreSQL backup/snapshot.
4. Apply the import. `--retire-missing` changes stale live SKUs to `Discontinued`; it never deletes them:

   ```bash
   npm run catalog:sync -- --supplier ralawise --source /root/app/data/CustomerDataFull.csv --apply --retire-missing
   ```

5. Verify database/view consistency and the reported Cotton + Burgundy + 151–200gsm combination:

   ```bash
   npm run catalog:verify -- --supplier ralawise
   ```

The apply command uses one transaction and refreshes both product search materialized views before commit. It aborts on malformed/undersized sources, duplicate IDs, supplier ownership conflicts, schema incompatibility, refresh failure, or retirement of more than 10% of current live supplier SKUs. `--allow-large-retire` exists only for a deliberately verified exceptional feed.

Supported supplier values are `ralawise`, `uneek`, and `absolute-apparel`.
