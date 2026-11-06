'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addVerifiedVariantPromotions,
  addVerifiedColourPromotions,
  buildPromotionSummary
} = require('../services/supplierPromotions');

test('does not invent promotions from lower colour prices', () => {
  const variants = addVerifiedVariantPromotions([
    { color: 'Black', size: 'One size', sell_price: 2.35 },
    { color: 'Natural Raw', size: 'One size', sell_price: 2.00 },
    { color: 'Stem Green', size: 'One size', sell_price: 1.18 }
  ]);
  const colors = addVerifiedColourPromotions([
    { name: 'Black' },
    { name: 'Natural Raw' },
    { name: 'Stem Green' }
  ], variants);

  assert.ok(variants.every(variant => variant.promotion === null));
  assert.ok(colors.every(color => color.promotion === null));
  assert.deepEqual(colors.map(color => color.fromPrice), [2.35, 2, 1.18]);
  assert.deepEqual(buildPromotionSummary(variants), {
    basis: 'verified_supplier_metadata_only',
    hasVerifiedPromotions: false,
    promotedVariantCount: 0,
    maxDiscountPercent: 0
  });
});

test('accepts only explicit, verified supplier promotion metadata', () => {
  const variants = addVerifiedVariantPromotions([
    {
      color: 'Royal Blue',
      size: 'One size',
      sell_price: 2.35,
      supplierPromotion: {
        verified: true,
        discountPercent: 30,
        originalPrice: 1.67,
        offerPrice: 1.17,
        source: 'Ralawise'
      }
    },
    {
      color: 'Stem Green',
      size: 'One size',
      sell_price: 1.18,
      supplierPromotion: {
        verified: false,
        discountPercent: 50,
        source: 'unverified-import'
      }
    }
  ]);
  const colors = addVerifiedColourPromotions([
    { name: 'Royal Blue' },
    { name: 'Stem Green' }
  ], variants);

  assert.deepEqual(variants[0].promotion, {
    verified: true,
    discountPercent: 30,
    label: '30% Off',
    source: 'Ralawise',
    originalPrice: 1.67,
    offerPrice: 1.17,
    startsAt: null,
    endsAt: null
  });
  assert.equal(variants[0].supplierPromotion, undefined);
  assert.equal(variants[1].promotion, null);
  assert.equal(colors[0].promotion.label, '30% Off');
  assert.equal(colors[1].promotion, null);
  assert.deepEqual(buildPromotionSummary(variants), {
    basis: 'verified_supplier_metadata_only',
    hasVerifiedPromotions: true,
    promotedVariantCount: 1,
    maxDiscountPercent: 30
  });
});

test('removes retired inferred discount fields', () => {
  const [variant] = addVerifiedVariantPromotions([{
    color: 'Natural',
    sell_price: 0.49,
    regularPrice: 0.70,
    discountPercent: 30,
    isDiscounted: true,
    discountComparison: 'majority_sell_price_for_size'
  }]);

  assert.equal(variant.regularPrice, undefined);
  assert.equal(variant.discountPercent, undefined);
  assert.equal(variant.isDiscounted, undefined);
  assert.equal(variant.discountComparison, undefined);
  assert.equal(variant.promotion, null);
});
