const test = require('node:test');
const assert = require('node:assert/strict');

const { isAdminRole, isBundleManagerRole } = require('../utils/auth');
const { buildCorsOptions } = require('../utils/security');

test('admin role check permits only administrator roles', () => {
  assert.equal(isAdminRole('admin'), true);
  assert.equal(isAdminRole('super_admin'), true);
  assert.equal(isAdminRole('customer'), false);
  assert.equal(isAdminRole(undefined), false);
});

test('bundle manager role permits bundle editors and administrators', () => {
  assert.equal(isBundleManagerRole('bundle_editor'), true);
  assert.equal(isBundleManagerRole('admin'), true);
  assert.equal(isBundleManagerRole('super_admin'), true);
  assert.equal(isBundleManagerRole('customer'), false);
  assert.equal(isAdminRole('bundle_editor'), false);
});

test('CORS permits the storefront and rejects untrusted origins', async () => {
  const corsOptions = buildCorsOptions();
  const checkOrigin = (origin) => new Promise((resolve) => {
    corsOptions.origin(origin, (error, allowed) => resolve({ error, allowed }));
  });

  const storefront = await checkOrigin('https://www.brandeduk.com');
  const attacker = await checkOrigin('https://attacker.example');
  const serverToServer = await checkOrigin(undefined);

  assert.equal(storefront.error, null);
  assert.equal(storefront.allowed, true);
  assert.equal(serverToServer.allowed, true);
  assert.equal(attacker.allowed, undefined);
  assert.equal(attacker.error?.status, 403);
  assert.ok(corsOptions.allowedHeaders.includes('Cache-Control'));
});
