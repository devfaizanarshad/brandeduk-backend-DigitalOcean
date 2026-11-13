require('dotenv').config();

const assert = require('node:assert/strict');
const { pool, queryWithTimeout, closePool } = require('../config/database');
const { signJwt } = require('../utils/auth');

const API_BASE = process.env.BUNDLE_API_TEST_BASE_URL || 'http://127.0.0.1:3004';
const createdBundleIds = new Set();
const results = [];

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

async function check(name, callback) {
  try {
    await callback();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    throw error;
  }
}

async function getAdminToken() {
  const result = await queryWithTimeout(`
    SELECT id FROM customer_users
    WHERE role IN ('admin', 'super_admin')
    ORDER BY id LIMIT 1
  `, [], 10000);
  if (!result.rows.length) throw new Error('No administrator account available');
  return signJwt({ sub: result.rows[0].id }, 600);
}

async function cleanup() {
  if (createdBundleIds.size) {
    await pool.query('DELETE FROM bundles WHERE id = ANY($1::bigint[])', [[...createdBundleIds]]);
  }
}

async function run() {
  const token = await getAdminToken();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const reference = `bulk-test-${suffix}`;
  const atomicReference = `bulk-atomic-${suffix}`;
  const slug = `bulk-test-${suffix}`;
  let bundleId;

  const payload = {
    bundles: [{
      reference,
      name: 'Temporary Bulk API Bundle',
      slug,
      priceExVat: 30,
      includedDecorationMethods: ['print'],
      includedLogoCount: 1,
      logoPosition: null,
      freeDelivery: true,
      freeGift: null,
      components: [{ styleCode: 'UC101', quantity: 2 }],
    }],
  };

  await check('requires authentication for template', async () => {
    const response = await request('/api/admin/bundles/bulk/template');
    assert.equal(response.status, 401);
  });

  await check('returns a beginner-friendly template', async () => {
    const response = await request('/api/admin/bundles/bulk/template', { token });
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.payload.template.bundles), true);
  });

  await check('reports missing product without writing', async () => {
    const response = await request('/api/admin/bundles/bulk/validate', {
      method: 'POST',
      token,
      body: {
        bundles: [{
          reference: `missing-${suffix}`,
          name: 'Missing Product Bundle',
          priceExVat: 10,
          components: [{ styleCode: 'NOT-A-REAL-CODE', quantity: 1 }],
        }],
      },
    });
    assert.equal(response.status, 400);
    assert.match(response.payload.errors.join(' '), /Unknown or unavailable product codes/);
    const dbResult = await pool.query('SELECT COUNT(*)::integer AS count FROM bundles WHERE external_reference = $1', [`missing-${suffix}`]);
    assert.equal(dbResult.rows[0].count, 0);
  });

  await check('validates create without writing', async () => {
    const response = await request('/api/admin/bundles/bulk/validate', { method: 'POST', token, body: payload });
    assert.equal(response.status, 200);
    assert.equal(response.payload.results[0].action, 'create');
    const dbResult = await pool.query('SELECT COUNT(*)::integer AS count FROM bundles WHERE external_reference = $1', [reference]);
    assert.equal(dbResult.rows[0].count, 0);
  });

  await check('creates draft through atomic bulk upsert', async () => {
    const response = await request('/api/admin/bundles/bulk/upsert', { method: 'POST', token, body: payload });
    assert.equal(response.status, 200);
    assert.equal(response.payload.created, 1);
    assert.equal(response.payload.updated, 0);
    bundleId = response.payload.results[0].bundleId;
    createdBundleIds.add(bundleId);
    const detail = await request(`/api/admin/bundles/${bundleId}`, { token });
    assert.equal(detail.payload.bundle.status, 'draft');
    assert.equal(detail.payload.bundle.pricingStatus, 'pending_customization_review');
    assert.deepEqual(detail.payload.bundle.includedDecorationMethods, ['print']);
    assert.equal(detail.payload.bundle.includedLogoCount, 1);
    assert.equal(detail.payload.bundle.logoPosition, null);
    assert.equal(detail.payload.bundle.freeDelivery, true);
    assert.equal(detail.payload.bundle.freeGift, null);
  });

  await check('updates same reference instead of duplicating', async () => {
    const updatedPayload = JSON.parse(JSON.stringify(payload));
    updatedPayload.bundles[0].name = 'Updated Temporary Bulk API Bundle';
    updatedPayload.bundles[0].priceExVat = 35;
    updatedPayload.bundles[0].components[0].quantity = 3;
    const response = await request('/api/admin/bundles/bulk/upsert', {
      method: 'POST', token, body: updatedPayload,
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.created, 0);
    assert.equal(response.payload.updated, 1);
    assert.equal(response.payload.results[0].bundleId, bundleId);
    const dbResult = await pool.query(`
      SELECT COUNT(*)::integer AS count, MAX(total_item_quantity)::integer AS quantity
      FROM bundles WHERE external_reference = $1
    `, [reference]);
    assert.equal(dbResult.rows[0].count, 1);
    assert.equal(dbResult.rows[0].quantity, 3);
  });

  await check('blocks bulk updates to active bundle', async () => {
    const approval = await request(`/api/admin/bundles/${bundleId}/pricing-status`, {
      method: 'PATCH', token, body: { pricingStatus: 'approved' },
    });
    assert.equal(approval.status, 200);
    const publish = await request(`/api/admin/bundles/${bundleId}/publish`, { method: 'POST', token });
    assert.equal(publish.status, 200);
    const validation = await request('/api/admin/bundles/bulk/validate', { method: 'POST', token, body: payload });
    assert.equal(validation.status, 400);
    assert.match(validation.payload.errors.join(' '), /Unpublish/);
  });

  await check('rolls back entire request when one entry is invalid', async () => {
    const atomicPayload = {
      bundles: [
        {
          reference: atomicReference,
          name: 'Should Roll Back',
          priceExVat: 15,
          components: [{ styleCode: 'UC101', quantity: 1 }],
        },
        payload.bundles[0],
      ],
    };
    const response = await request('/api/admin/bundles/bulk/upsert', {
      method: 'POST', token, body: atomicPayload,
    });
    assert.equal(response.status, 400);
    const dbResult = await pool.query('SELECT COUNT(*)::integer AS count FROM bundles WHERE external_reference = $1', [atomicReference]);
    assert.equal(dbResult.rows[0].count, 0);
  });
}

run()
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error(`Cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }
    console.log(JSON.stringify({
      passed: results.filter(result => result.passed).length,
      failed: results.filter(result => !result.passed).length,
      tests: results,
      temporaryBundlesRemoved: createdBundleIds.size,
    }, null, 2));
    await closePool();
  });
