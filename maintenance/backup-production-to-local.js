#!/usr/bin/env node
/**
 * Backup Production (Ralawise) to Local Database
 *
 * 1. Dump brandeduk_prod from production server
 * 2. Create new local DB: brandeduk_ralawise_backup
 * 3. Restore dump into local DB
 *
 * Use for: Merging tests with UNEEK (ecommerce DB) - both datasets local
 *
 * Requires: PostgreSQL client tools (pg_dump, createdb, pg_restore) in PATH
 *           or in Program Files\PostgreSQL\{version}\bin
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Production (Ralawise)
const PROD = {
  host: process.env.DB_HOST || '206.189.119.150',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'brandeduk_prod',
  user: process.env.DB_USER || 'brandeduk',
  password: process.env.DB_PASSWORD || 'omglol123',
};

// Local target
const LOCAL = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '1234',
  database: 'brandeduk_ralawise_backup',
};

const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUP_FILE = path.join(BACKUP_DIR, `ralawise_backup_${Date.now()}.dump`);

function findPgBin() {
  const pathEnv = process.env.PATH || '';
  const candidates = [
    'pg_dump',
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'PostgreSQL', '16', 'bin', 'pg_dump'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'PostgreSQL', '15', 'bin', 'pg_dump'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'PostgreSQL', '14', 'bin', 'pg_dump'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'PostgreSQL', '16', 'bin', 'pg_dump'),
    '/usr/bin/pg_dump',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return path.dirname(p);
      if (p === 'pg_dump') break; // will use from PATH
    } catch (_) {}
  }
  return null;
}

function run(cmd, args, env = {}, allowExit1 = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      shell: true,
      cwd: process.cwd(),
    });
    let out = '';
    let err = '';
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.stderr?.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 || (allowExit1 && code === 1)) resolve({ out, err, code });
      else reject(new Error(err || out || `Exit code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('Backup Production (Ralawise) → Local brandeduk_ralawise_backup');
  console.log('='.repeat(70));

  const binDir = findPgBin();
  const pg = (name) => (binDir ? path.join(binDir, name) : name);

  // Ensure backup dir exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log('Created backup dir:', BACKUP_DIR);
  }

  // 1. Dump production
  console.log('\n[1/4] Dumping production DB...');
  const pgDumpArgs = [
    '-h', PROD.host,
    '-p', String(PROD.port),
    '-U', PROD.user,
    '-d', PROD.database,
    '-Fc',
    '-f', BACKUP_FILE,
  ];
  try {
    await run(pg('pg_dump'), pgDumpArgs, {
      PGPASSWORD: PROD.password,
      PGSSLMODE: 'require',
    });
    console.log('  Done. Backup file:', BACKUP_FILE);
  } catch (e) {
    console.error('  pg_dump failed:', e.message);
    process.exit(1);
  }

  // 2. Drop existing local DB (if exists) and create fresh
  console.log('\n[2/4] Creating local database:', LOCAL.database);
  try {
    await run(pg('psql'), [
      '-h', LOCAL.host,
      '-p', String(LOCAL.port),
      '-U', LOCAL.user,
      '-d', 'postgres',
      '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LOCAL.database}' AND pid <> pg_backend_pid();`,
    ], { PGPASSWORD: LOCAL.password }).catch(() => {});
    await run(pg('dropdb'), [
      '-h', LOCAL.host,
      '-p', String(LOCAL.port),
      '-U', LOCAL.user,
      '--if-exists',
      LOCAL.database,
    ], { PGPASSWORD: LOCAL.password }).catch(() => {});
    await run(pg('createdb'), [
      '-h', LOCAL.host,
      '-p', String(LOCAL.port),
      '-U', LOCAL.user,
      LOCAL.database,
    ], { PGPASSWORD: LOCAL.password });
    console.log('  Done.');
  } catch (e) {
    console.error('  create db failed:', e.message);
    process.exit(1);
  }

  // 3. Restore (pg_restore often exits 1 for harmless role warnings)
  console.log('\n[3/4] Restoring into local DB...');
  try {
    const res = await run(
      pg('pg_restore'),
      [
        '-h', LOCAL.host,
        '-p', String(LOCAL.port),
        '-U', LOCAL.user,
        '-d', LOCAL.database,
        '--no-owner',
        '--no-acl',
        '-v',
        BACKUP_FILE,
      ],
      { PGPASSWORD: LOCAL.password },
      true  // allow exit 1 (pg_restore role warnings)
    );
    console.log('  Done.');
    if (res.code === 1) {
      console.log('  (pg_restore exit 1 - typically OK for role/owner warnings)');
    }
  } catch (e) {
    console.error('  pg_restore failed:', e.message);
    process.exit(1);
  }

  // 4. Verify
  console.log('\n[4/4] Verifying...');
  const { Pool } = require('pg');
  const pool = new Pool({
    host: LOCAL.host,
    port: Number(LOCAL.port),
    database: LOCAL.database,
    user: LOCAL.user,
    password: LOCAL.password,
  });
  try {
    const r = await pool.query("SELECT COUNT(*) as cnt FROM products WHERE sku_status = 'Live'");
    console.log('  Live products:', r.rows[0].cnt);
    const s = await pool.query('SELECT COUNT(*) as cnt FROM styles');
    console.log('  Styles:', s.rows[0].cnt);
  } catch (e) {
    console.log('  Could not verify counts:', e.message);
  }
  await pool.end();

  console.log('\n' + '='.repeat(70));
  console.log('SUCCESS. You now have:');
  console.log('  - ecommerce          → UNEEK data (products, product_variants)');
  console.log('  - brandeduk_ralawise_backup → Ralawise (production backup)');
  console.log('='.repeat(70));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
