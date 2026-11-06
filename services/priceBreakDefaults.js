'use strict';

const FINAL_TIER_DISCOUNT_PERCENT = 23;

const DEFAULT_PRICE_BREAK_TIERS = Object.freeze([
  Object.freeze({ min_qty: 1, max_qty: 9, discount_percent: 0 }),
  Object.freeze({ min_qty: 10, max_qty: 24, discount_percent: 8 }),
  Object.freeze({ min_qty: 25, max_qty: 49, discount_percent: 10 }),
  Object.freeze({ min_qty: 50, max_qty: 99, discount_percent: 15 }),
  Object.freeze({ min_qty: 100, max_qty: 249, discount_percent: 25 }),
  Object.freeze({ min_qty: 250, max_qty: 99999, discount_percent: FINAL_TIER_DISCOUNT_PERCENT })
]);

module.exports = {
  DEFAULT_PRICE_BREAK_TIERS,
  FINAL_TIER_DISCOUNT_PERCENT
};
