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
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
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

async function findAdminToken() {
  const result = await queryWithTimeout(`
    SELECT id
    FROM customer_users
    WHERE role IN ('admin', 'super_admin')
    ORDER BY CASE WHEN role = 'super_admin' THEN 0 ELSE 1 END, id
    LIMIT 1
  `, [], 10000);
  if (!result.rows.length) throw new Error('No administrator account exists for authenticated API testing');
  return signJwt({ sub: result.rows[0].id }, 600);
}

async function findTestSkus() {
  const result = await queryWithTimeout(`
    SELECT DISTINCT ON (style_code) style_code, sku_code
    FROM products
    WHERE sku_status = 'Live'
      AND style_code IN ('UC101', 'GD005')
    ORDER BY style_code, id
  `, [], 10000);
  const skus = new Map(result.rows.map(row => [row.style_code, row.sku_code]));
  if (!skus.has('UC101') || !skus.has('GD005')) throw new Error('Required live test SKUs are unavailable');
  return skus;
}

async function cleanup() {
  if (!createdBundleIds.size) return;
  await pool.query('DELETE FROM bundles WHERE id = ANY($1::bigint[])', [[...createdBundleIds]]);
}

async function run() {
  const token = await findAdminToken();
  const skus = await findTestSkus();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const slug = `api-test-${suffix}`;
  const duplicateSlug = `api-test-duplicate-${suffix}`;
  let bundleId;
  let componentId;

  await check('rejects unauthenticated admin access', async () => {
    const response = await request('/api/admin/bundles?limit=1');
    assert.equal(response.status, 401);
  });

  await check('rejects invalid create payload', async () => {
    const response = await request('/api/admin/bundles', {
      method: 'POST', token, body: { name: 'x', priceExVat: -1, components: [] },
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.success, false);
  });

  await check('creates a valid draft bundle', async () => {
    const response = await request('/api/admin/bundles', {
      method: 'POST',
      token,
      body: {
        name: 'Temporary API Test Bundle',
        slug,
        priceExVat: 25.5,
        description: 'Temporary automated test',
        components: [{ styleCode: 'UC101', quantity: 2 }],
      },
    });
    assert.equal(response.status, 201);
    assert.equal(response.payload.bundle.status, 'draft');
    assert.equal(response.payload.bundle.catalogueStatus, 'complete');
    bundleId = response.payload.bundle.id;
    componentId = response.payload.bundle.components[0].id;
    createdBundleIds.add(bundleId);
  });

  await check('keeps drafts private', async () => {
    const response = await request(`/api/bundles/${slug}`);
    assert.equal(response.status, 404);
  });

  await check('loads draft through authenticated admin detail', async () => {
    const response = await request(`/api/admin/bundles/${bundleId}`, { token });
    assert.equal(response.status, 200);
    assert.equal(response.payload.bundle.components.length, 1);
  });

  await check('blocks publishing before pricing approval', async () => {
    const response = await request(`/api/admin/bundles/${bundleId}/publish`, { method: 'POST', token });
    assert.equal(response.status, 400);
    assert.match(response.payload.errors.join(' '), /Pricing must be approved/);
  });

  await check('approves pricing and publishes', async () => {
    const approval = await request(`/api/admin/bundles/${bundleId}/pricing-status`, {
      method: 'PATCH', token, body: { pricingStatus: 'approved' },
    });
    assert.equal(approval.status, 200);
    const publish = await request(`/api/admin/bundles/${bundleId}/publish`, { method: 'POST', token });
    assert.equal(publish.status, 200);
    assert.equal(publish.payload.bundle.status, 'active');
  });

  await check('returns the active bundle publicly', async () => {
    const response = await request(`/api/bundles/${slug}`);
    assert.equal(response.status, 200);
    assert.equal(response.payload.bundle.id, bundleId);
  });

  await check('lists active bundle through public search', async () => {
    const response = await request(`/api/bundles?search=${encodeURIComponent(slug)}&limit=100`);
    assert.equal(response.status, 200);
    assert.equal(response.payload.bundles.some(bundle => bundle.id === bundleId), true);
  });

  await check('caps public pagination limit', async () => {
    const response = await request('/api/bundles?limit=999999');
    assert.equal(response.status, 200);
    assert.equal(response.payload.limit, 100);
  });

  await check('handles SQL-like search text safely', async () => {
    const response = await request(`/api/bundles?search=${encodeURIComponent("%' OR 1=1 --")}`);
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.payload.bundles), true);
  });

  await check('returns live SKU options', async () => {
    const response = await request(`/api/bundles/${slug}/components/${componentId}/options?limit=1`);
    assert.equal(response.status, 200);
    assert.equal(response.payload.options.length, 1);
    assert.equal(response.payload.total > 0, true);
  });

  await check('rejects empty selection', async () => {
    const response = await request(`/api/bundles/${slug}/validate-selection`, {
      method: 'POST', body: { components: [] },
    });
    assert.equal(response.status, 400);
  });

  await check('rejects incorrect component quantity', async () => {
    const response = await request(`/api/bundles/${slug}/validate-selection`, {
      method: 'POST',
      body: { components: [{ componentId, selections: [{ skuCode: skus.get('UC101'), quantity: 1 }] }] },
    });
    assert.equal(response.status, 400);
    assert.match(response.payload.errors.join(' '), /exactly 2 items/);
  });

  await check('rejects SKU from another style', async () => {
    const response = await request(`/api/bundles/${slug}/validate-selection`, {
      method: 'POST',
      body: { components: [{ componentId, selections: [{ skuCode: skus.get('GD005'), quantity: 2 }] }] },
    });
    assert.equal(response.status, 400);
    assert.match(response.payload.errors.join(' '), /not a live option/);
  });

  await check('rejects duplicate SKU selection lines', async () => {
    const response = await request(`/api/bundles/${slug}/validate-selection`, {
      method: 'POST',
      body: {
        components: [{
          componentId,
          selections: [
            { skuCode: skus.get('UC101'), quantity: 1 },
            { skuCode: skus.get('UC101'), quantity: 1 },
          ],
        }],
      },
    });
    assert.equal(response.status, 400);
    assert.match(response.payload.errors.join(' '), /duplicated/);
  });

  await check('accepts an exact valid SKU selection', async () => {
    const response = await request(`/api/bundles/${slug}/validate-selection`, {
      method: 'POST',
      body: { components: [{ componentId, selections: [{ skuCode: skus.get('UC101'), quantity: 2 }] }] },
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.valid, true);
    assert.equal(response.payload.bundle.priceExVat, 25.5);
  });

  await check('blocks component edits while active', async () => {
    const response = await request(`/api/admin/bundles/${bundleId}/components`, {
      method: 'PUT', token, body: { components: [{ styleCode: 'GD005', quantity: 2 }] },
    });
    assert.equal(response.status, 400);
    assert.match(response.payload.errors.join(' '), /Unpublish/);
  });

  await check('blocks active price changes', async () => {
    const response = await request(`/api/admin/bundles/${bundleId}`, {
      method: 'PATCH', token, body: { priceExVat: 20 },
    });
    assert.equal(response.status, 400);
    assert.match(response.payload.errors.join(' '), /Unpublish/);
  });

  await check('blocks removing pricing approval while active', async () => {
    const response = await request(`/api/admin/bundles/${bundleId}/pricing-status`, {
      method: 'PATCH', token, body: { pricingStatus: 'margin_review' },
    });
    assert.equal(response.status, 400);
    assert.match(response.payload.errors.join(' '), /Unpublish/);
  });

  await check('unpublishes and replaces components', async () => {
    const unpublish = await request(`/api/admin/bundles/${bundleId}/unpublish`, { method: 'POST', token });
    assert.equal(unpublish.status, 200);
    const replace = await request(`/api/admin/bundles/${bundleId}/components`, {
      method: 'PUT', token, body: { components: [{ styleCode: 'GD005', quantity: 3 }] },
    });
    assert.equal(replace.status, 200);
    assert.equal(replace.payload.bundle.totalItemQuantity, 3);
    componentId = replace.payload.bundle.components[0].id;
  });

  await check('marks unknown products missing and blocks approval', async () => {
    const replace = await request(`/api/admin/bundles/${bundleId}/components`, {
      method: 'PUT', token, body: { components: [{ styleCode: 'DOES-NOT-EXIST', quantity: 1 }] },
    });
    assert.equal(replace.status, 200);
    assert.equal(replace.payload.bundle.catalogueStatus, 'missing_products');
    const approval = await request(`/api/admin/bundles/${bundleId}/pricing-status`, {
      method: 'PATCH', token, body: { pricingStatus: 'approved' },
    });
    assert.equal(approval.status, 400);
    assert.match(approval.payload.errors.join(' '), /Missing catalogue products/);
  });

  await check('rejects duplicate slug', async () => {
    const first = await request('/api/admin/bundles', {
      method: 'POST',
      token,
      body: { name: 'Duplicate One', slug: duplicateSlug, priceExVat: 10, components: [{ styleCode: 'UC101', quantity: 1 }] },
    });
    assert.equal(first.status, 201);
    createdBundleIds.add(first.payload.bundle.id);
    const second = await request('/api/admin/bundles', {
      method: 'POST',
      token,
      body: { name: 'Duplicate Two', slug: duplicateSlug, priceExVat: 10, components: [{ styleCode: 'UC101', quantity: 1 }] },
    });
    assert.equal(second.status, 400);
    assert.match(second.payload.errors.join(' '), /slug already exists/);
  });

  await check('records admin audit history', async () => {
    const response = await request(`/api/admin/bundles/${bundleId}/audit`, { token });
    assert.equal(response.status, 200);
    const actions = response.payload.audit.map(entry => entry.action);
    assert.equal(response.payload.audit.length >= 6, true);
    assert.equal(actions.includes('created'), true);
    assert.equal(actions.includes('pricing_status_changed'), true);
    assert.equal(actions.includes('status_changed_to_active'), true);
    assert.equal(actions.includes('status_changed_to_draft'), true);
    assert.equal(actions.includes('components_replaced'), true);
  });

  await check('archives and prevents further edits', async () => {
    const archive = await request(`/api/admin/bundles/${bundleId}/archive`, { method: 'POST', token });
    assert.equal(archive.status, 200);
    const edit = await request(`/api/admin/bundles/${bundleId}`, {
      method: 'PATCH', token, body: { description: 'Should not update' },
    });
    assert.equal(edit.status, 404);
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
