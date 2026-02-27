#!/usr/bin/env node
/**
 * Verify production backup matches source
 * Compares row counts and key checksums between production and brandeduk_ralawise_backup
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PROD = {
  host: process.env.DB_HOST || '206.189.119.150',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'brandeduk_prod',
  user: process.env.DB_USER || 'brandeduk',
  password: process.env.DB_PASSWORD || 'omglol123',
  // Production server currently does NOT support SSL; connect without SSL unless DB_SSL explicitly true
  ssl:
    typeof process.env.DB_SSL === 'string' &&
    process.env.DB_SSL.toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
};

const BACKUP = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: 'brandeduk_ralawise_backup',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '1234',
};

const TABLES = [
  'products',
  'styles',
  'brands',
  'categories',
  'product_types',
  'colours',
  'sizes',
  'genders',
  'age_groups',
  'tags',
  'product_categories',
  'product_fabrics',
  'product_flags',
  'product_accreditations',
  'fabrics',
  'effects',
  'accreditations',
  'special_flags',
];

async function getCounts(pool, prefix) {
  const counts = {};
  for (const table of TABLES) {
    try {
      const r = await pool.query(`SELECT COUNT(*) as cnt FROM "${table}"`);
      counts[table] = parseInt(r.rows[0].cnt, 10);
    } catch (e) {
      counts[table] = `error: ${e.message.split('\n')[0]}`;
    }
  }
  return counts;
}

async function getProductChecks(pool) {
  const checks = {};
  try {
    const r = await pool.query("SELECT COUNT(*) as cnt FROM products WHERE sku_status = 'Live'");
    checks.live_products = parseInt(r.rows[0].cnt, 10);
  } catch (e) {
    checks.live_products = `error: ${e.message}`;
  }
  try {
    const r = await pool.query('SELECT COUNT(DISTINCT style_code) as cnt FROM products WHERE sku_status = \'Live\'');
    checks.unique_live_styles = parseInt(r.rows[0].cnt, 10);
  } catch (e) {
    checks.unique_live_styles = `error: ${e.message}`;
  }
  try {
    const r = await pool.query('SELECT COUNT(*) as cnt FROM products');
    checks.total_products = parseInt(r.rows[0].cnt, 10);
  } catch (e) {
    checks.total_products = `error: ${e.message}`;
  }
  try {
    const r = await pool.query('SELECT COUNT(*) as cnt FROM styles');
    checks.total_styles = parseInt(r.rows[0].cnt, 10);
  } catch (e) {
    checks.total_styles = `error: ${e.message}`;
  }
  return checks;
}

async function main() {
  const prodPool = new Pool(PROD);
  const backupPool = new Pool(BACKUP);

  console.log('='.repeat(70));
  console.log('BACKUP VERIFICATION: Production vs brandeduk_ralawise_backup');
  console.log('='.repeat(70));

  try {
    const [prodCounts, backupCounts] = await Promise.all([
      getCounts(prodPool, 'PROD'),
      getCounts(backupPool, 'BACKUP'),
    ]);

    const prodChecks = await getProductChecks(prodPool);
    const backupChecks = await getProductChecks(backupPool);

    console.log('\n--- Row counts by table ---');
    console.log('Table'.padEnd(35), 'Production'.padEnd(14), 'Backup'.padEnd(14), 'Match');
    console.log('-'.repeat(70));

    let allMatch = true;
    for (const table of TABLES) {
      const p = prodCounts[table];
      const b = backupCounts[table];
      const match = typeof p === 'number' && typeof b === 'number' && p === b ? 'OK' : (p === b ? 'OK' : 'MISMATCH');
      if (match === 'MISMATCH') allMatch = false;
      console.log(
        table.padEnd(35),
        String(p).padEnd(14),
        String(b).padEnd(14),
        match
      );
    }

    console.log('\n--- Key metrics ---');
    console.log('Metric'.padEnd(30), 'Production'.padEnd(14), 'Backup'.padEnd(14), 'Match');
    console.log('-'.repeat(70));
    for (const [k, pv] of Object.entries(prodChecks)) {
      const bv = backupChecks[k];
      const match = pv === bv ? 'OK' : 'MISMATCH';
      if (match === 'MISMATCH') allMatch = false;
      console.log(k.padEnd(30), String(pv).padEnd(14), String(bv).padEnd(14), match);
    }

    console.log('\n' + '='.repeat(70));
    if (allMatch) {
      console.log('VERIFICATION PASSED: Backup matches production.');
    } else {
      console.log('VERIFICATION: Some differences. Check tables above.');
    }
    console.log('='.repeat(70));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prodPool.end();
    await backupPool.end();
  }
}

main();
