const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateBundleInput,
  validateComponentsInput,
  validateSelectionInput,
} = require('../services/fixedBundleService');

test('accepts a valid fixed bundle definition', () => {
  const result = validateBundleInput({
    name: 'Starter Workwear Bundle',
    priceExVat: 99.49,
    slug: 'Starter Workwear Bundle',
    displayOrder: 3,
  });

  assert.equal(result.valid, true);
  assert.equal(result.value.slug, 'starter-workwear-bundle');
  assert.equal(result.value.priceExVat, 99.49);
});

test('rejects invalid bundle prices and names', () => {
  const result = validateBundleInput({ name: 'x', priceExVat: -1 });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});

test('normalizes component style codes and quantities', () => {
  const result = validateComponentsInput([{ styleCode: ' uc101 ', quantity: '5' }]);
  assert.deepEqual(result, {
    valid: true,
    errors: [],
    value: [{ styleCode: 'UC101', quantity: 5 }],
  });
});

test('validates SKU selection request shape', () => {
  const result = validateSelectionInput({
    components: [{
      componentId: '12',
      selections: [{ skuCode: ' uc101-navy-l ', quantity: '3' }],
    }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.value[0].componentId, 12);
  assert.equal(result.value[0].selections[0].skuCode, 'UC101-NAVY-L');
});

test('rejects empty selection requests', () => {
  const result = validateSelectionInput({ components: [] });
  assert.equal(result.valid, false);
});
