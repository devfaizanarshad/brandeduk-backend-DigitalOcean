const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../services/customizationCapabilityRules');
const engine = require('../services/customizationCapabilityEngine');

function resolve(productType, position, method, skuStatus) {
  return engine.resolveFromStatuses({
    method,
    productStatus: rules.PRODUCT_CAPABILITIES[productType]?.[engine.normalizeMethod(method)],
    positionStatus: rules.POSITION_CAPABILITIES[position]?.[engine.normalizeMethod(method)],
    skuStatus,
  });
}

test('loads the complete supplied product capability matrix', () => {
  assert.equal(Object.keys(rules.PRODUCT_CAPABILITIES).length, 110);
  assert.equal(Object.keys(rules.POSITION_CAPABILITIES).length, 18);
});

test('allows DTF for a heavy premium t-shirt left chest', () => {
  assert.equal(resolve('heavy_premium_tshirt', 'left_chest', 'dtf').status, 'AVAILABLE');
});

test('requires approval for cotton t-shirt embroidery', () => {
  assert.equal(resolve('cotton_tshirt', 'left_chest', 'embroidery').status, 'POA');
});

test('keeps screen print hidden globally', () => {
  const result = resolve('heavy_premium_tshirt', 'left_chest', 'screen_print');
  assert.equal(result.status, 'HIDDEN');
  assert.equal(result.visible, false);
});

test('maps legacy generic print requests to DTF', () => {
  assert.equal(engine.normalizeMethod('print'), 'dtf');
});

test('uses the most restrictive product, position, and SKU status', () => {
  assert.equal(resolve('heavy_premium_tshirt', 'large_back', 'embroidery').status, 'POA');
  assert.equal(resolve('heavy_premium_tshirt', 'left_chest', 'dtf', 'UNAVAILABLE').status, 'UNAVAILABLE');
});

test('unknown product or position defaults to manual approval', () => {
  assert.equal(resolve('missing', 'missing', 'dtf').status, 'POA');
});
