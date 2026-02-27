#!/usr/bin/env node
/**
 * Promote LOCAL brandeduk_ralawise_backup → PRODUCTION brandeduk_prod
 *
 * WARNING: This will OVERWRITE data/schema in production to match your local backup.
 *
 * Flow:
 * 1. Dump local DB brandeduk_ralawise_backup
 * 2. Restore dump into remote brandeduk_prod (host 206.189.119.150 by default)
 *
 * Safety:
 * - Requires CONFIRM_PROMOTE_PROD=YES in environment to run
 * - Strongly recommended: run maintenance/backup-production-to-local.js first
 * - Strongly recommended: run maintenance/verify-backup.js before and after
 *
 * Requires: PostgreSQL client tools (pg_dump, pg_restore) in PATH or default install dirs.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (process.env.CONFIRM_PROMOTE_PROD !== 'YES') {
  console.error(
    'ABORTING: You must set CONFIRM_PROMOTE_PROD=YES in your environment before running this script.'
  );
  console.error(
    'Example (PowerShell): $env:CONFIRM_PROMOTE_PROD="YES"; node maintenance/promote-local-backup-to-production.js'
  );
  process.exit(1);
}

// Local source (up-to-date backup)
const LOCAL = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '1234',
  database: process.env.LOCAL_SOURCE_DB || 'brandeduk_ralawise_backup',
};

// Remote production target
const PROD = {
  host: process.env.DB_HOST || '206.189.119.150',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'brandeduk_prod',
  user: process.env.DB_USER || 'brandeduk',
  password: process.env.DB_PASSWORD || 'omglol123',
};

const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUP_FILE = path.join(
  BACKUP_DIR,
  `local_ralawise_for_promotion_${Date.now()}.dump`
);

function findPgBin() {
  const candidates = [
    'pg_dump',
    'pg_restore',
    path.join(
      process.env['ProgramFiles'] || 'C:\\Program Files',
      'PostgreSQL',
      '16',
      'bin'
    ),
    path.join(
      process.env['ProgramFiles'] || 'C:\\Program Files',
      'PostgreSQL',
      '15',
      'bin'
    ),
    path.join(
      process.env['ProgramFiles'] || 'C:\\Program Files',
      'PostgreSQL',
      '14',
      'bin'
    ),
    path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'PostgreSQL',
      '16',
      'bin'
    ),
    '/usr/bin',
  ];

  for (const base of candidates) {
    try {
      if (base === 'pg_dump') {
        // rely on PATH
        return null;
      }
      if (fs.existsSync(path.join(base, 'pg_dump'))) {
        return base;
      }
    } catch (_) {
      // ignore
    }
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
    proc.stdout?.on('data', (d) => {
      out += d.toString();
    });
    proc.stderr?.on('data', (d) => {
      err += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0 || (allowExit1 && code === 1)) resolve({ out, err, code });
      else reject(new Error(err || out || `Exit code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function main() {
  console.log('='.repeat(80));
  console.log('PROMOTE LOCAL brandeduk_ralawise_backup → PRODUCTION brandeduk_prod');
  console.log('='.repeat(80));

  console.log('\nSource (LOCAL BACKUP):');
  console.log(
    `  ${LOCAL.user}@${LOCAL.host}:${LOCAL.port}/${LOCAL.database} (password: ****)`
  );
  console.log('\nTarget (PRODUCTION):');
  console.log(
    `  ${PROD.user}@${PROD.host}:${PROD.port}/${PROD.database} (password: ****)`
  );

  const binDir = findPgBin();
  const pg = (name) => (binDir ? path.join(binDir, name) : name);

  // Ensure backup dir exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log('\nCreated backup dir:', BACKUP_DIR);
  }

  // 1. Dump local backup
  console.log('\n[1/3] Dumping LOCAL brandeduk_ralawise_backup...');
  const pgDumpArgs = [
    '-h',
    LOCAL.host,
    '-p',
    String(LOCAL.port),
    '-U',
    LOCAL.user,
    '-d',
    LOCAL.database,
    '-Fc',
    '-f',
    BACKUP_FILE,
  ];
  try {
    await run(pg('pg_dump'), pgDumpArgs, {
      PGPASSWORD: LOCAL.password,
    });
    console.log('  Done. Dump file:', BACKUP_FILE);
  } catch (e) {
    console.error('  pg_dump (local) failed:', e.message);
    process.exit(1);
  }

  // 2. Restore into production (clean existing objects)
  console.log('\n[2/3] Restoring dump into PRODUCTION (this may take a while)...');
  try {
    const res = await run(
      pg('pg_restore'),
      [
        '-h',
        PROD.host,
        '-p',
        String(PROD.port),
        '-U',
        PROD.user,
        '-d',
        PROD.database,
        '--clean', // drop and recreate database objects
        '--no-owner',
        '--no-acl',
        '-v',
        BACKUP_FILE,
      ],
      {
        PGPASSWORD: PROD.password,
      },
      true // allow exit 1 for role/owner warnings
    );
    console.log('  Restore completed with exit code:', res.code);
    if (res.code === 1) {
      console.log(
        '  Note: pg_restore exit 1 is often just role/owner warnings; review logs above.'
      );
    }
  } catch (e) {
    console.error('  pg_restore (to prod) failed:', e.message);
    console.error(
      '  IMPORTANT: Check production DB connectivity and permissions before retrying.'
    );
    process.exit(1);
  }

  // 3. Final message
  console.log('\n[3/3] DONE.');
  console.log('Production database should now match your local brandeduk_ralawise_backup.');
  console.log(
    'Recommended next step: node maintenance/verify-backup.js  (to compare PROD vs LOCAL backup).'
  );
  console.log('='.repeat(80));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

