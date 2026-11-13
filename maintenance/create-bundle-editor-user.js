require('dotenv').config();

const { queryWithTimeout, closePool } = require('../config/database');
const { ensureCustomerTables } = require('../services/customerCheckoutService');
const { hashPassword } = require('../utils/auth');

async function createBundleEditorUser() {
  const email = String(process.env.BUNDLE_EDITOR_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.BUNDLE_EDITOR_PASSWORD || '');
  const name = String(process.env.BUNDLE_EDITOR_NAME || 'Bundle Editor').trim();

  if (!email || !email.includes('@')) throw new Error('BUNDLE_EDITOR_EMAIL must be a valid email address');
  if (password.length < 8) throw new Error('BUNDLE_EDITOR_PASSWORD must contain at least 8 characters');

  await ensureCustomerTables();
  const existing = await queryWithTimeout(`
    SELECT id, name, email, role, provider
    FROM customer_users
    WHERE lower(email) = lower($1)
    LIMIT 1
  `, [email], 10000);

  if (existing.rows[0] && existing.rows[0].role !== 'bundle_editor') {
    throw new Error(`Refusing to replace existing ${existing.rows[0].role} account: ${email}`);
  }

  const result = await queryWithTimeout(`
    INSERT INTO customer_users (name, email, password_hash, provider, role)
    VALUES ($1, $2, $3, 'local', 'bundle_editor')
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      provider = 'local',
      role = 'bundle_editor',
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, name, email, role
  `, [name, email, hashPassword(password)], 10000);

  console.log(JSON.stringify(result.rows[0]));
}

createBundleEditorUser()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
