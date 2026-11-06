'use strict';

const normalize = value => String(value || '').trim().toLowerCase();
const toMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function validSellPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < 999.99 ? toMoney(price) : null;
}

function majorityPrice(variants) {
  const prices = variants
    .map(variant => validSellPrice(variant && variant.sell_price))
    .filter(price => price !== null);

  // One variant cannot establish a genuine comparison price.
  if (prices.length < 2) return null;

  const counts = new Map();
  prices.forEach(price => {
    const key = price.toFixed(2);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  let winner = null;
  let winnerCount = 0;
  counts.forEach((count, key) => {
    if (count > winnerCount) {
      winner = Number(key);
      winnerCount = count;
    }
  });

  // A mode is not enough: require more than half of comparable variants so
  // a split or mixed-price range never produces a misleading discount badge.
  return winnerCount > prices.length / 2 ? winner : null;
}

function addVariantDiscounts(variants) {
  const source = Array.isArray(variants) ? variants : [];
  const bySize = new Map();

  source.forEach(variant => {
    const price = validSellPrice(variant && variant.sell_price);
    const color = normalize(variant && (variant.color || variant.colour));
    if (price === null || !color || color === 'model') return;
    const size = normalize(variant && variant.size) || '__unsized__';
    if (!bySize.has(size)) bySize.set(size, []);
    bySize.get(size).push(variant);
  });

  const regularPriceBySize = new Map();
  bySize.forEach((sizeVariants, size) => {
    regularPriceBySize.set(size, majorityPrice(sizeVariants));
  });

  return source.map(variant => {
    const price = validSellPrice(variant && variant.sell_price);
    const size = normalize(variant && variant.size) || '__unsized__';
    const regularPrice = regularPriceBySize.get(size) || null;
    const rawDiscount = regularPrice && price !== null && price < regularPrice
      ? ((regularPrice - price) / regularPrice) * 100
      : 0;
    const discountPercent = Math.round(rawDiscount);
    const isDiscounted = discountPercent > 0;

    return {
      ...variant,
      regularPrice,
      discountPercent: isDiscounted ? discountPercent : 0,
      isDiscounted,
      discountComparison: regularPrice ? 'majority_sell_price_for_size' : null
    };
  });
}

function buildDiscountSummary(variants) {
  const source = Array.isArray(variants) ? variants : [];
  const discounted = source.filter(variant => variant && variant.isDiscounted);
  return {
    comparisonBasis: 'majority_sell_price_by_size',
    hasDiscountedVariants: discounted.length > 0,
    discountedVariantCount: discounted.length,
    maxDiscountPercent: discounted.length
      ? Math.max(...discounted.map(variant => Number(variant.discountPercent) || 0))
      : 0
  };
}

function addColourDiscounts(colors, variants) {
  const source = Array.isArray(colors) ? colors : [];
  const pricedVariants = Array.isArray(variants) ? variants : [];

  return source.map(color => {
    const colorName = normalize(color && color.name);
    if (!colorName || colorName === 'model') return color;

    const matches = pricedVariants.filter(variant =>
      normalize(variant && (variant.color || variant.colour)) === colorName
    );
    if (!matches.length) return color;

    const validPrices = matches
      .map(variant => validSellPrice(variant.sell_price))
      .filter(price => price !== null);
    const discounted = matches.filter(variant => variant.isDiscounted);
    const maxDiscountPercent = discounted.length
      ? Math.max(...discounted.map(variant => Number(variant.discountPercent) || 0))
      : 0;
    const allComparableVariantsDiscounted = discounted.length > 0 && discounted.length === matches.length;
    const distinctDiscounts = new Set(discounted.map(variant => Number(variant.discountPercent) || 0));
    const discountIsUpTo = maxDiscountPercent > 0 &&
      (!allComparableVariantsDiscounted || distinctDiscounts.size > 1);

    return {
      ...color,
      fromPrice: validPrices.length ? Math.min(...validPrices) : null,
      isDiscounted: maxDiscountPercent > 0,
      discountPercent: maxDiscountPercent,
      discountIsUpTo,
      discountLabel: maxDiscountPercent > 0
        ? `${discountIsUpTo ? 'Up to ' : ''}${maxDiscountPercent}% lower than standard colours`
        : null
    };
  });
}

module.exports = {
  addVariantDiscounts,
  addColourDiscounts,
  buildDiscountSummary,
  majorityPrice
};
