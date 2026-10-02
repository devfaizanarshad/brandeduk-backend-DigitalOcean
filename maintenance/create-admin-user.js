require('dotenv').config();

const { queryWithTimeout, closePool } = require('../config/database');
const { ensureCustomerTables } = require('../services/customerCheckoutService');
const { hashPassword } = require('../utils/auth');

async function createAdminUser() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || 'Administrator').trim();

  if (!email || !email.includes('@')) throw new Error('ADMIN_EMAIL must be a valid email address');
  if (password.length < 8) throw new Error('ADMIN_PASSWORD must contain at least 8 characters');

  await ensureCustomerTables();
  const result = await queryWithTimeout(`
    INSERT INTO customer_users (name, email, password_hash, provider, role)
    VALUES ($1, $2, $3, 'local', 'admin')
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      provider = 'local',
      role = 'admin',
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, name, email, role
  `, [name, email, hashPassword(password)], 10000);

  console.log(`Administrator ready: ${result.rows[0].email}`);
}

createAdminUser()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
