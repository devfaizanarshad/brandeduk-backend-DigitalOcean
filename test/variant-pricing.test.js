const test = require('node:test');
const assert = require('node:assert/strict');
const { priceLine } = require('../services/variantPricing');
const { validatePaymentInput } = require('../services/stripeQuoteService');
const product = {
  price: 1.18,
  priceBreaks: [{ min: 1, max: 49, percentage: 0, price: 1.18 }, { min: 50, max: 99, percentage: 15, price: 1 }],
  variants: [
    { color: 'Stem Green', size: 'One size', sell_price: 1.18 },
    { color: 'Black', size: 'One size', sell_price: 2.35 },
    { color: 'Black', size: 'XL', sell_price: 3.1 },
  ],
};
test('SX148 Black never receives the sale colour price', () => {
  assert.equal(priceLine(product, { color: 'Black', size: 'One Size', quantity: 50 }, 50).unitPrice, 2);
  assert.equal(priceLine(product, { color: 'Stem Green', size: 'One Size', quantity: 50 }, 50).unitPrice, 1);
});
test('quantity discount is shared across colours but each SKU keeps its own price', () => {
  assert.equal(priceLine(product, { color: 'Black', size: 'XL', quantity: 25 }, 50).unitPrice, 2.64);
  assert.equal(priceLine(product, { color: 'Stem Green', size: 'One size', quantity: 25 }, 50).itemTotal, 25);
});
test('mixed size totals round each SKU before summing', () => {
  const result = priceLine(product, { color: 'Black', quantities: { 'One size': 25, XL: 25 } }, 50);
  assert.equal(result.itemTotal, 116);
  assert.equal(result.unitPrice, 2.32);
});
test('missing variants, unknown colour/size and missing prices fail closed', () => {
  for (const item of [{ color: 'White', size: 'One size' }, { color: 'Black', size: 'XXL' }, { color: 'Black' }]) {
    assert.throws(() => priceLine(product, item, 50));
  }
  assert.throws(() => priceLine({ price: 1 }, { color: 'Black', size: 'One size' }, 50));
  assert.throws(() => priceLine({ ...product, variants: [{ color: 'Black', size: 'M', sell_price: null }] }, { color: 'Black', size: 'M' }, 50));
});
test('bulk discounts cannot reduce the selected SKU below its supplier cost', () => {
  const product = { variants: [{ color: 'Black', size: 'One size', sell_price: 2.35, minimumPrice: 1.67, priceBreaks: [{ min: 250, max: 99999, price: 1.65 }] }] };
  assert.equal(priceLine(product, { color: 'Black', size: 'One size', quantity: 250 }, 250).unitPrice, 1.67);
});
test('payment rejects stale or manipulated cheapest-colour prices and requests uncached detail', async () => {
  const dependencies = { buildProductDetailQuery: async (code, options) => { assert.equal(options.fresh, true); return product; } };
  const body = { quoteData: { customer: { email: 'test@example.com' }, basket: [{ code: 'SX148', color: 'Black', size: 'One size', quantity: 50, unitPrice: 1, itemTotal: 50 }], summary: { garmentCost: 50, totalIncVat: 60 } } };
  await assert.rejects(() => validatePaymentInput(body, dependencies), /price.*changed/i);
  Object.assign(body.quoteData.basket[0], { unitPrice: 2, itemTotal: 100 });
  Object.assign(body.quoteData.summary, { garmentCost: 100, totalIncVat: 120 });
  assert.equal((await validatePaymentInput(body, dependencies)).amount, 12000);
});
