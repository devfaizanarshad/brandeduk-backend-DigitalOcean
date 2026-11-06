const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PRICE_BREAK_TIERS,
  FINAL_TIER_DISCOUNT_PERCENT
} = require('../services/priceBreakDefaults');

test('the final global quantity tier saves 23 percent', () => {
  const finalTier = DEFAULT_PRICE_BREAK_TIERS.at(-1);
  assert.equal(FINAL_TIER_DISCOUNT_PERCENT, 23);
  assert.deepEqual(finalTier, {
    min_qty: 250,
    max_qty: 99999,
    discount_percent: 23
  });
});
