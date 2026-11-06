'use strict';

const normalize = value => String(value || '').trim().toLowerCase();
const toMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function validPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < 999.99 ? toMoney(price) : null;
}

function verifiedPromotion(variant) {
  const candidate = variant && variant.supplierPromotion;
  if (!candidate || candidate.verified !== true) return null;

  const discountPercent = Number(candidate.discountPercent);
  const source = String(candidate.source || '').trim();
  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100 || !source) {
    return null;
  }

  const originalPrice = validPrice(candidate.originalPrice);
  const offerPrice = validPrice(candidate.offerPrice);

  return {
    verified: true,
    discountPercent: Math.round(discountPercent),
    label: `${Math.round(discountPercent)}% Off`,
    source,
    originalPrice,
    offerPrice,
    startsAt: candidate.startsAt || null,
    endsAt: candidate.endsAt || null
  };
}

function addVerifiedVariantPromotions(variants) {
  const source = Array.isArray(variants) ? variants : [];
  return source.map(variant => {
    // Remove the retired inferred-discount fields if an older caller supplies
    // them. They must never leak back into the public API.
    const {
      regularPrice,
      discountPercent,
      isDiscounted,
      discountComparison,
      supplierPromotion,
      ...safeVariant
    } = variant || {};

    return {
      ...safeVariant,
      promotion: verifiedPromotion(variant)
    };
  });
}

function addVerifiedColourPromotions(colors, variants) {
  const source = Array.isArray(colors) ? colors : [];
  const pricedVariants = Array.isArray(variants) ? variants : [];

  return source.map(color => {
    const colorName = normalize(color && color.name);
    if (!colorName || colorName === 'model') return color;

    const matches = pricedVariants.filter(variant =>
      normalize(variant && (variant.color || variant.colour)) === colorName
    );
    const prices = matches
      .map(variant => validPrice(variant && variant.sell_price))
      .filter(price => price !== null);
    const verified = matches
      .map(variant => variant && variant.promotion)
      .filter(promotion => promotion && promotion.verified === true);

    if (!verified.length) {
      return {
        ...color,
        fromPrice: prices.length ? Math.min(...prices) : null,
        promotion: null
      };
    }

    const maxDiscountPercent = Math.max(...verified.map(promotion => promotion.discountPercent));
    const allVariantsPromoted = verified.length === matches.length;
    const onePercentage = new Set(verified.map(promotion => promotion.discountPercent)).size === 1;
    const upTo = !allVariantsPromoted || !onePercentage;

    return {
      ...color,
      fromPrice: prices.length ? Math.min(...prices) : null,
      promotion: {
        verified: true,
        discountPercent: maxDiscountPercent,
        label: `${upTo ? 'Up to ' : ''}${maxDiscountPercent}% Off`,
        upTo,
        source: verified[0].source
      }
    };
  });
}

function buildPromotionSummary(variants) {
  const source = Array.isArray(variants) ? variants : [];
  const promoted = source.filter(variant => variant && variant.promotion && variant.promotion.verified === true);

  return {
    basis: 'verified_supplier_metadata_only',
    hasVerifiedPromotions: promoted.length > 0,
    promotedVariantCount: promoted.length,
    maxDiscountPercent: promoted.length
      ? Math.max(...promoted.map(variant => variant.promotion.discountPercent))
      : 0
  };
}

module.exports = {
  addVerifiedVariantPromotions,
  addVerifiedColourPromotions,
  buildPromotionSummary,
  verifiedPromotion
};
