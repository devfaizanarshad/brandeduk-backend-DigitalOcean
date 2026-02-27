#!/usr/bin/env node
/**
 * Compare LOCAL DB (brandeduk_ralawise_backup by default) vs PRODUCTION (brandeduk_prod)
 *
 * - Lists tables only in LOCAL, only in PROD, and in both
 * - For common tables, compares row counts
 *
 * LOCAL connection (source):
 *   PGHOST / PGPORT / PGUSER / PGPASSWORD
 *   DB: process.env.LOCAL_DB_NAME || 'brandeduk_ralawise_backup'
 *
 * PROD connection (target):
 *   DB_* env vars with sensible defaults (same as verify-backup.js)
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const LOCAL_DB_NAME = process.env.LOCAL_DB_NAME || 'brandeduk_ralawise_backup';

const LOCAL = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: LOCAL_DB_NAME,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '1234',
};

const PROD = {
  host: process.env.DB_HOST || '206.189.119.150',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'brandeduk_prod',
  user: process.env.DB_USER || 'brandeduk',
  password: process.env.DB_PASSWORD || 'omglol123',
  ssl:
    typeof process.env.DB_SSL === 'string' &&
    process.env.DB_SSL.toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
};

async function listTables(pool, label) {
  const sql = `
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename
  `;
  const res = await pool.query(sql);
  const tables = res.rows.map((r) => `${r.schemaname}.${r.tablename}`);
  return new Set(tables);
}

async function getRowCount(pool, fullTableName) {
  const [schema, table] = fullTableName.split('.');
  const sql = `SELECT COUNT(*) AS cnt FROM "${schema}"."${table}"`;
  const res = await pool.query(sql);
  return parseInt(res.rows[0].cnt, 10);
}

async function main() {
  console.log('='.repeat(80));
  console.log(
    `SCHEMA / ROW COUNT DIFF: LOCAL (${LOCAL.database}) vs PROD (${PROD.database})`
  );
  console.log('='.repeat(80));

  const localPool = new Pool(LOCAL);
  const prodPool = new Pool(PROD);

  try {
    console.log('\n[1/3] Fetching table lists from both databases...');
    const [localTables, prodTables] = await Promise.all([
      listTables(localPool, 'LOCAL'),
      listTables(prodPool, 'PROD'),
    ]);

    const onlyLocal = [...localTables].filter((t) => !prodTables.has(t));
    const onlyProd = [...prodTables].filter((t) => !localTables.has(t));
    const common = [...localTables].filter((t) => prodTables.has(t));

    console.log('\n--- Tables ONLY in LOCAL ---');
    if (onlyLocal.length === 0) {
      console.log('(none)');
    } else {
      onlyLocal.forEach((t) => console.log(`  ${t}`));
    }

    console.log('\n--- Tables ONLY in PROD ---');
    if (onlyProd.length === 0) {
      console.log('(none)');
    } else {
      onlyProd.forEach((t) => console.log(`  ${t}`));
    }

    console.log('\n[2/3] Comparing row counts for common tables (this may take a while)...');
    const differences = [];
    for (const table of common) {
      try {
        const [localCount, prodCount] = await Promise.all([
          getRowCount(localPool, table),
          getRowCount(prodPool, table),
        ]);
        if (localCount !== prodCount) {
          differences.push({ table, localCount, prodCount });
        }
      } catch (e) {
        differences.push({
          table,
          localCount: `error: ${e.message.split('\n')[0]}`,
          prodCount: 'error',
        });
      }
    }

    console.log('\n--- Common tables with ROW COUNT differences ---');
    if (differences.length === 0) {
      console.log('(none – all common tables have identical row counts)');
    } else {
      console.log('Table'.padEnd(45), 'LOCAL'.padEnd(14), 'PROD'.padEnd(14));
      console.log('-'.repeat(80));
      for (const diff of differences) {
        console.log(
          diff.table.padEnd(45),
          String(diff.localCount).padEnd(14),
          String(diff.prodCount).padEnd(14)
        );
      }
    }

    console.log('\n[3/3] Summary:');
    console.log(`  Tables only in LOCAL: ${onlyLocal.length}`);
    console.log(`  Tables only in PROD : ${onlyProd.length}`);
    console.log(`  Common tables       : ${common.length}`);
    console.log(`  Row-count diffs     : ${differences.length}`);
    console.log('\nDONE.');
    console.log('='.repeat(80));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await localPool.end();
    await prodPool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

