const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStaticPrice } = require('../services/customizationPricingEngine');

const expected = {
  dtf: [[1,7.50],[8,7.50],[9,5.25],[24,5.25],[25,4.00],[99,4.00],[100,3.00],[249,3.00],[250,2.50],[499,2.50],[500,2.25],[749,2.25],[750,2.00],[999,2.00],[1000,1.75]],
  embroidery: [[1,8.00],[8,8.00],[9,6.00],[24,6.00],[25,4.75],[99,4.75],[100,3.75],[249,3.75],[250,2.50],[499,2.50],[500,2.25],[749,2.25],[750,2.00],[999,2.00],[1000,1.75]],
};

for (const [method, boundaries] of Object.entries(expected)) {
  test(`${method} resolves every PDF tier boundary`, () => {
    for (const [quantity, price] of boundaries) {
      assert.equal(resolveStaticPrice({ method, quantity }).unitPrice, price, `${method} quantity ${quantity}`);
    }
  });
}

test('legacy print resolves as DTF', () => {
  assert.equal(resolveStaticPrice({ method: 'print', quantity: 25 }).method, 'dtf');
  assert.equal(resolveStaticPrice({ method: 'print', quantity: 25 }).unitPrice, 4);
});

test('high-stitch embroidery uses its own complete price and always requires assessment', () => {
  const result = resolveStaticPrice({ method: 'embroidery', priceClass: 'high-stitch', quantity: 100 });
  assert.equal(result.unitPrice, 5.75);
  assert.equal(result.requiresArtworkAssessment, true);
  assert.equal(result.allowAutomaticCheckout, false);
});

test('250+ quantities require manual review while retaining an estimated price', () => {
  const result = resolveStaticPrice({ method: 'dtf', quantity: 250 });
  assert.equal(result.unitPrice, 2.50);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.allowAutomaticCheckout, false);
});

test('embroidery returns the separate digitising fee', () => {
  assert.equal(resolveStaticPrice({ method: 'embroidery', quantity: 20 }).digitisingFeePerDesign, 25);
  assert.equal(resolveStaticPrice({ method: 'dtf', quantity: 20 }).digitisingFeePerDesign, 0);
});

test('screen print remains unavailable for pricing', () => {
  assert.throws(() => resolveStaticPrice({ method: 'screen_print', quantity: 25 }), /not active/);
});

test('invalid quantities are rejected', () => {
  assert.throws(() => resolveStaticPrice({ method: 'dtf', quantity: 0 }), /positive whole number/);
  assert.throws(() => resolveStaticPrice({ method: 'dtf', quantity: 1.5 }), /positive whole number/);
});
