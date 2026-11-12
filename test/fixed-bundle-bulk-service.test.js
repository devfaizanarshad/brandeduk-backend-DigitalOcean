const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeReference,
  validateBulkPayload,
} = require('../services/fixedBundleBulkService');

test('normalizes stable bulk references', () => {
  assert.equal(normalizeReference(' Starter Polo / 10 '), 'starter-polo-10');
});

test('accepts a valid bulk payload', () => {
  const result = validateBulkPayload({
    bundles: [{
      reference: 'starter-polo-10',
      name: 'Starter Polo Bundle',
      slug: 'starter-polo-bundle',
      priceExVat: 99.99,
      components: [{ styleCode: 'uc101', quantity: 10 }],
    }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.bundles[0].components[0].styleCode, 'UC101');
});

test('rejects duplicate references and slugs', () => {
  const bundle = {
    reference: 'same-reference',
    name: 'Valid Bundle',
    slug: 'same-slug',
    priceExVat: 10,
    components: [{ styleCode: 'UC101', quantity: 1 }],
  };
  const result = validateBulkPayload({ bundles: [bundle, bundle] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /reference is duplicated/);
  assert.match(result.errors.join(' '), /slug is duplicated/);
});

test('limits bulk requests to 100 bundles', () => {
  const result = validateBulkPayload({ bundles: Array.from({ length: 101 }, () => ({})) });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /maximum of 100/);
});
