const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePpeSearchIntent, PPE_CATEGORY_SLUGS } = require('../services/ppeCatalog');
const rules = require('../services/customizationCapabilityRules');

test('PPE search variations resolve to the curated PPE catalogue', () => {
  for (const query of ['PPE', 'ppe', 'safety wear', 'protective clothing', 'work safety', 'safty']) {
    assert.deepEqual(parsePpeSearchIntent(query), { isPpe: true, remainingQuery: null });
  }
});

test('PPE intent can be combined with a subtype search', () => {
  assert.deepEqual(parsePpeSearchIntent('PPE gloves'), { isPpe: true, remainingQuery: 'gloves' });
  assert.deepEqual(parsePpeSearchIntent('Portwest safety wear'), { isPpe: true, remainingQuery: 'Portwest' });
});

test('ordinary searches are not classified as PPE from product wording alone', () => {
  for (const query of ['fashion snood', 'ordinary mask', 'normal jacket', 'work trousers']) {
    assert.deepEqual(parsePpeSearchIntent(query), { isPpe: false, remainingQuery: query });
  }
  assert.deepEqual(PPE_CATEGORY_SLUGS, ['ppe-safety-wear', 'safetywear']);
});

test('hi-vis branding requires approval to protect reflective areas', () => {
  const hiVisTypes = Object.keys(rules.PRODUCT_CAPABILITIES).filter(key => key.startsWith('hi_vis_'));
  assert.ok(hiVisTypes.length > 0);
  for (const type of hiVisTypes) {
    assert.equal(rules.PRODUCT_CAPABILITIES[type].dtf, rules.STATUSES.POA, type);
    assert.equal(rules.PRODUCT_CAPABILITIES[type].embroidery, rules.STATUSES.POA, type);
  }
});
