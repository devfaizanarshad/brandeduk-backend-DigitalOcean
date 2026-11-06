const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addVariantDiscounts,
  addColourDiscounts,
  buildDiscountSummary,
  majorityPrice
} = require('../services/variantDiscounts');

test('uses the majority sell price and marks only cheaper variants', () => {
  const variants = addVariantDiscounts([
    { color: 'Black', size: 'One size', sell_price: 2.35 },
    { color: 'Red', size: 'One size', sell_price: 2.35 },
    { color: 'White', size: 'One size', sell_price: 2.35 },
    { color: 'Royal Blue', size: 'One size', sell_price: 2.35 },
    { color: 'Natural Raw', size: 'One size', sell_price: 2.00 },
    { color: 'Stem Green', size: 'One size', sell_price: 1.18 }
  ]);

  assert.deepEqual(
    variants.map(({ color, regularPrice, discountPercent, isDiscounted }) =>
      ({ color, regularPrice, discountPercent, isDiscounted })),
    [
      { color: 'Black', regularPrice: 2.35, discountPercent: 0, isDiscounted: false },
      { color: 'Red', regularPrice: 2.35, discountPercent: 0, isDiscounted: false },
      { color: 'White', regularPrice: 2.35, discountPercent: 0, isDiscounted: false },
      { color: 'Royal Blue', regularPrice: 2.35, discountPercent: 0, isDiscounted: false },
      { color: 'Natural Raw', regularPrice: 2.35, discountPercent: 15, isDiscounted: true },
      { color: 'Stem Green', regularPrice: 2.35, discountPercent: 50, isDiscounted: true }
    ]
  );
});

test('compares like-for-like sizes instead of mixing size surcharges', () => {
  const variants = addVariantDiscounts([
    { color: 'Black', size: 'S', sell_price: 5 },
    { color: 'Red', size: 'S', sell_price: 5 },
    { color: 'Green', size: 'S', sell_price: 4 },
    { color: 'Black', size: '3XL', sell_price: 7 },
    { color: 'Red', size: '3XL', sell_price: 7 },
    { color: 'Green', size: '3XL', sell_price: 5.6 }
  ]);

  assert.deepEqual(
    variants.filter(variant => variant.color === 'Green').map(variant =>
      ({ size: variant.size, regularPrice: variant.regularPrice, discountPercent: variant.discountPercent })),
    [
      { size: 'S', regularPrice: 5, discountPercent: 20 },
      { size: '3XL', regularPrice: 7, discountPercent: 20 }
    ]
  );
});

test('returns no discount when there is no clear majority comparison price', () => {
  assert.equal(majorityPrice([
    { sell_price: 5 },
    { sell_price: 5 },
    { sell_price: 4 },
    { sell_price: 4 }
  ]), null);

  const variants = addVariantDiscounts([
    { color: 'Black', size: 'M', sell_price: 5 },
    { color: 'Green', size: 'M', sell_price: 4 }
  ]);
  assert.ok(variants.every(variant => !variant.isDiscounted && variant.regularPrice === null));
});

test('adds frontend-ready colour badges and product summary', () => {
  const variants = addVariantDiscounts([
    { color: 'Black', size: 'S', sell_price: 5 },
    { color: 'Red', size: 'S', sell_price: 5 },
    { color: 'Green', size: 'S', sell_price: 4 },
    { color: 'Black', size: '3XL', sell_price: 7 },
    { color: 'Red', size: '3XL', sell_price: 7 },
    { color: 'Green', size: '3XL', sell_price: 6.3 }
  ]);
  const colors = addColourDiscounts([{ name: 'model' }, { name: 'Black' }, { name: 'Green' }], variants);

  assert.equal(colors[0].discountPercent, undefined);
  assert.deepEqual(colors[1], {
    name: 'Black',
    fromPrice: 5,
    isDiscounted: false,
    discountPercent: 0,
    discountIsUpTo: false,
    discountLabel: null
  });
  assert.equal(colors[2].fromPrice, 4);
  assert.equal(colors[2].discountPercent, 20);
  assert.equal(colors[2].discountIsUpTo, true);
  assert.equal(colors[2].discountLabel, 'Up to 20% lower than standard colours');
  assert.deepEqual(buildDiscountSummary(variants), {
    comparisonBasis: 'majority_sell_price_by_size',
    hasDiscountedVariants: true,
    discountedVariantCount: 2,
    maxDiscountPercent: 20
  });
});
