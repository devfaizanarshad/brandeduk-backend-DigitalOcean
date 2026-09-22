const PRICING_VERSION = '2026-09-22.1';
const VAT_INCLUDED = false;
const DIGITISING_FEE_PER_DESIGN = 25;

const tier = (minQuantity, maxQuantity, unitPrice, sourceCount) => ({
  minQuantity,
  maxQuantity,
  unitPrice,
  sourceCount,
  requiresManualReview: minQuantity >= 250,
});

const PRICE_TIERS = Object.freeze({
  dtf: Object.freeze({
    standard: Object.freeze([
      tier(1, 8, 7.50, 3),
      tier(9, 24, 5.25, 3),
      tier(25, 99, 4.00, 3),
      tier(100, 249, 3.00, 3),
      tier(250, 499, 2.50, 2),
      tier(500, 749, 2.25, 2),
      tier(750, 999, 2.00, 2),
      tier(1000, null, 1.75, 2),
    ]),
  }),
  embroidery: Object.freeze({
    standard: Object.freeze([
      tier(1, 8, 8.00, 3),
      tier(9, 24, 6.00, 3),
      tier(25, 99, 4.75, 3),
      tier(100, 249, 3.75, 3),
      tier(250, 499, 2.50, 2),
      tier(500, 749, 2.25, 2),
      tier(750, 999, 2.00, 2),
      tier(1000, null, 1.75, 2),
    ]),
    high_stitch: Object.freeze([
      tier(1, 8, 11.25, 2),
      tier(9, 24, 8.75, 2),
      tier(25, 99, 6.75, 2),
      tier(100, 249, 5.75, 2),
      tier(250, 499, 4.50, 1),
      tier(500, 749, 4.50, 1),
      tier(750, 999, 4.50, 1),
      tier(1000, null, 4.50, 1),
    ]),
  }),
});

module.exports = {
  PRICING_VERSION,
  VAT_INCLUDED,
  DIGITISING_FEE_PER_DESIGN,
  PRICE_TIERS,
};
