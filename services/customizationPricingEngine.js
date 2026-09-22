const rules = require('./customizationPricingRules');
const { normalizeMethod } = require('./customizationCapabilityEngine');

function normalizePriceClass(method, value) {
  const normalized = String(value || 'standard').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (method === 'dtf') return 'standard';
  if (method === 'embroidery' && ['standard', 'high_stitch'].includes(normalized)) return normalized;
  const error = new Error(`Unsupported price class "${value}" for ${method}`);
  error.status = 400;
  throw error;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1) {
    const error = new Error('quantity must be a positive whole number');
    error.status = 400;
    throw error;
  }
  return quantity;
}

function findTier(tiers, quantity) {
  return tiers.find(item => quantity >= item.minQuantity && (item.maxQuantity == null || quantity <= item.maxQuantity));
}

function resolveStaticPrice(input) {
  const method = normalizeMethod(input.method);
  if (method === 'screen_print') {
    const error = new Error('Screen Print pricing is not active');
    error.status = 400;
    throw error;
  }
  const quantity = normalizeQuantity(input.quantity);
  const priceClass = normalizePriceClass(method, input.priceClass);
  const tiers = rules.PRICE_TIERS[method]?.[priceClass];
  if (!tiers) {
    const error = new Error(`No pricing configured for ${method}/${priceClass}`);
    error.status = 404;
    throw error;
  }
  const selectedTier = findTier(tiers, quantity);
  const requiresArtworkAssessment = priceClass === 'high_stitch';
  const requiresManualReview = selectedTier.requiresManualReview || requiresArtworkAssessment;
  return {
    pricingVersion: rules.PRICING_VERSION,
    method,
    priceClass,
    quantity,
    unitPrice: selectedTier.unitPrice,
    applicationTotal: Number((selectedTier.unitPrice * quantity).toFixed(2)),
    currency: 'GBP',
    vatIncluded: rules.VAT_INCLUDED,
    tier: {
      minQuantity: selectedTier.minQuantity,
      maxQuantity: selectedTier.maxQuantity,
      sourceCount: selectedTier.sourceCount,
    },
    requiresArtworkAssessment,
    requiresManualReview,
    allowAutomaticCheckout: !requiresManualReview,
    digitisingFeePerDesign: method === 'embroidery' ? rules.DIGITISING_FEE_PER_DESIGN : 0,
  };
}

module.exports = { normalizePriceClass, normalizeQuantity, findTier, resolveStaticPrice };
