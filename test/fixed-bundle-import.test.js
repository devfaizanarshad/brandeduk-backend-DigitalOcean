const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyBundle,
  normalizeDeal,
} = require('../maintenance/import-fixed-bundles');

test('normalizes supplier aliases to canonical catalogue style codes', () => {
  const deal = normalizeDeal({
    number: 1,
    title: 'Alias bundle',
    brandedExVat: 10,
    quantity: 2,
    status: 'document-ok',
    compositions: [{ quantity: 2, code: 'STTU170', documentUnitCost: 3 }],
  });

  assert.equal(deal.components[0].requestedCode, 'STTU170');
  assert.equal(deal.components[0].canonicalCode, 'SX236');
});

test('restores components for the seven missing-product bundles', () => {
  const deal = normalizeDeal({
    number: 35,
    title: 'Missing product bundle',
    brandedExVat: 162.49,
    quantity: 6,
    status: 'unpriced',
    compositions: [],
  });

  assert.deepEqual(deal.components, [{
    quantity: 6,
    requestedCode: 'DX412',
    canonicalCode: 'DX412',
    sourceUnitCost: null,
  }]);
});

test('blocks bundles with missing products', () => {
  const classification = classifyBundle(
    { documentStatus: 'unpriced' },
    [{ requestedCode: 'B309', componentStatus: 'missing_product' }],
  );

  assert.equal(classification.catalogueStatus, 'missing_products');
  assert.equal(classification.pricingStatus, 'unpriced');
  assert.match(classification.publishBlockReason, /B309/);
});

test('keeps every otherwise valid bundle pending customization review', () => {
  const classification = classifyBundle(
    { documentStatus: 'document-ok' },
    [{ requestedCode: 'GD005', componentStatus: 'linked' }],
  );

  assert.equal(classification.catalogueStatus, 'complete');
  assert.equal(classification.pricingStatus, 'pending_customization_review');
  assert.match(classification.publishBlockReason, /Customization/);
});

test('flags BC640 cost and unsafe margin separately', () => {
  const costReview = classifyBundle(
    { documentStatus: 'document-ok' },
    [{ requestedCode: 'BC640', componentStatus: 'linked' }],
  );
  const marginReview = classifyBundle(
    { documentStatus: 'unsafe' },
    [{ requestedCode: 'GD005', componentStatus: 'linked' }],
  );

  assert.equal(costReview.pricingStatus, 'cost_review');
  assert.equal(marginReview.pricingStatus, 'margin_review');
});
