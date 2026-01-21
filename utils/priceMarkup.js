/**
 * Price Markup Utility
 * Applies tiered markup percentages to supplier prices
 */

// Tiered markup configuration (based on supplier/cost price)
const MARKUP_TIERS = [
  { from: 0.01, to: 1.99, markup: 200 },      // 200% markup for £0.01-£1.99
  { from: 2.00, to: 2.99, markup: 80 },       // 80% markup for £2.00-£2.99
  { from: 3.00, to: 4.99, markup: 150 },      // 150% markup for £3.00-£4.99
  { from: 5.00, to: 9.99, markup: 138 },        // 138% markup for £5.00-£9.99
  { from: 10.00, to: 14.99, markup: 132 },     // 132% markup for £10.00-£14.99
  { from: 15.00, to: 24.99, markup: 90 },       // 90% markup for £15.00-£24.99
  { from: 25.00, to: 29.99, markup: 105.5 },     // 105.5% markup for £25.00-£29.99
  { from: 30.00, to: 34.99, markup: 110.3 },    // 110.3% markup for £30.00-£34.99
  { from: 35.00, to: 39.99, markup: 90.8 },     // 90.8% markup for £35.00-£39.99
  { from: 40.00, to: 44.99, markup: 85.7 },     // 85.7% markup for £40.00-£44.99
  { from: 45.00, to: Infinity, markup: 60.8 },  // 60.8% markup for £45.00+
];

/**
 * Get markup percentage for a given price
 * @param {number} price - The supplier/cost price
 * @returns {number} - Markup percentage
 */
function getMarkupPercentage(price) {
  if (!price || price <= 0) return 0;
  
  const tier = MARKUP_TIERS.find(t => price >= t.from && price <= t.to);
  return tier ? tier.markup : 60.8;
}

/**
 * Apply markup to a single price
 * @param {number} costPrice - The supplier/cost price
 * @returns {number} - The marked up selling price (rounded to 2 decimal places)
 */
function applyMarkup(costPrice) {
  if (!costPrice || costPrice <= 0) return 0;
  
  const price = parseFloat(costPrice);
  const markupPercent = getMarkupPercentage(price);
  const markedUpPrice = price + (price * markupPercent / 100);
  
  return Math.round(markedUpPrice * 100) / 100; // Round to 2 decimal places
}

/**
 * Apply markup to a product object (mutates the object)
 * @param {object} product - Product object with price fields
 * @returns {object} - Product with marked up prices
 */
function applyMarkupToProduct(product) {
  if (!product) return product;
  
  // Apply markup to common price fields
  if (product.price !== undefined && product.price !== null) {
    product.original_price = product.price; // Store original for reference (optional)
    product.price = applyMarkup(product.price);
  }
  
  if (product.single_price !== undefined && product.single_price !== null) {
    product.single_price = applyMarkup(product.single_price);
  }
  
  if (product.sku_price !== undefined && product.sku_price !== null) {
    product.sku_price = applyMarkup(product.sku_price);
  }

  // Handle price ranges in product detail
  if (product.price_range) {
    if (product.price_range.min !== undefined) {
      product.price_range.min = applyMarkup(product.price_range.min);
    }
    if (product.price_range.max !== undefined) {
      product.price_range.max = applyMarkup(product.price_range.max);
    }
  }

  // Handle variants/skus array
  if (product.skus && Array.isArray(product.skus)) {
    product.skus = product.skus.map(sku => {
      if (sku.price !== undefined) {
        sku.price = applyMarkup(sku.price);
      }
      if (sku.single_price !== undefined) {
        sku.single_price = applyMarkup(sku.single_price);
      }
      return sku;
    });
  }

  // Handle variants array
  if (product.variants && Array.isArray(product.variants)) {
    product.variants = product.variants.map(variant => {
      if (variant.price !== undefined) {
        variant.price = applyMarkup(variant.price);
      }
      return variant;
    });
  }

  return product;
}

/**
 * Apply markup to an array of products
 * @param {array} products - Array of product objects
 * @returns {array} - Products with marked up prices
 */
function applyMarkupToProducts(products) {
  if (!products || !Array.isArray(products)) return products;
  return products.map(product => applyMarkupToProduct(product));
}

/**
 * Apply markup to price range object (for filters)
 * @param {object} priceRange - Object with min and max prices
 * @returns {object} - Price range with marked up values
 */
function applyMarkupToPriceRange(priceRange) {
  if (!priceRange) return priceRange;
  
  return {
    min: priceRange.min ? applyMarkup(priceRange.min) : 0,
    max: priceRange.max ? applyMarkup(priceRange.max) : 0
  };
}

/**
 * Reverse markup calculation - convert marked-up price to cost price
 * This is used to convert user's priceMax filter (in marked-up price) to cost price for filtering
 * @param {number} markedUpPrice - The marked-up selling price
 * @returns {number} - The maximum cost price that, after markup, would be <= markedUpPrice
 */
function reverseMarkup(markedUpPrice) {
  if (!markedUpPrice || markedUpPrice <= 0) return 0;
  
  // Since markup is tiered based on cost price, we need to find the maximum cost price
  // that, after markup, would result in a price <= markedUpPrice.
  // For each tier: markedUpPrice = costPrice * (1 + markup/100)
  // So: costPrice = markedUpPrice / (1 + markup/100)
  // We check each tier and find the maximum valid cost price.
  
  let maxCostPrice = 0;
  
  // For each tier, find the maximum cost price that results in markedUpPrice after markup
  for (const tier of MARKUP_TIERS) {
    // Calculate what cost price would result in markedUpPrice after this tier's markup
    const costPriceForMarkedUp = markedUpPrice / (1 + tier.markup / 100);
    
    // Check what the marked-up price would be at the tier boundaries
    const markedUpAtTierMin = applyMarkup(tier.from);
    
    // If the tier's minimum (after markup) exceeds markedUpPrice, skip this tier
    if (markedUpAtTierMin > markedUpPrice) {
      continue;
    }
    
    // Calculate the maximum cost price in this tier that works
    // It's the minimum of: tier's max, or the calculated cost price for markedUpPrice
    const maxCostInTier = Math.min(tier.to, costPriceForMarkedUp);
    
    // Ensure it's at least the tier's minimum
    if (maxCostInTier >= tier.from) {
      maxCostPrice = Math.max(maxCostPrice, maxCostInTier);
    }
  }
  
  return Math.round(maxCostPrice * 100) / 100; // Round to 2 decimal places
}

/**
 * Reverse markup calculation for minimum price filter - convert marked-up price to minimum cost price
 * This is used to convert user's priceMin filter (in marked-up price) to cost price for filtering
 * @param {number} markedUpPrice - The marked-up selling price (minimum)
 * @returns {number} - The minimum cost price that, after markup, would be >= markedUpPrice
 */
function reverseMarkupMin(markedUpPrice) {
  if (!markedUpPrice || markedUpPrice <= 0) return 0;
  
  // Since markup is tiered based on cost price, we need to find the minimum cost price
  // that, after markup, would result in a price >= markedUpPrice.
  // The challenge is that the markup tier depends on the cost price itself.
  
  // Strategy: For each tier, calculate what cost price would result in markedUpPrice
  // using that tier's markup. Then verify that:
  // 1. The calculated cost price falls within that tier's range
  // 2. When we apply markup to that cost price (using its actual tier), we get >= markedUpPrice
  
  let minCostPrice = Infinity;
  
  // Check each tier from lowest to highest
  for (const tier of MARKUP_TIERS) {
    // Calculate what cost price would result in markedUpPrice using this tier's markup
    const costPriceForMarkedUp = markedUpPrice / (1 + tier.markup / 100);
    
    // Check if this cost price falls within the tier's range
    if (costPriceForMarkedUp >= tier.from && costPriceForMarkedUp <= tier.to) {
      // The calculated cost price is in this tier, so it will use this tier's markup
      // Verify that applying markup to it gives >= markedUpPrice (should be equal or very close)
      const actualMarkedUp = applyMarkup(costPriceForMarkedUp);
      if (actualMarkedUp >= markedUpPrice) {
        minCostPrice = Math.min(minCostPrice, costPriceForMarkedUp);
      }
    } else if (costPriceForMarkedUp < tier.from) {
      // The calculated cost price is below this tier, so we need at least tier.from
      // Check if tier.from (after markup) is >= markedUpPrice
      const markedUpAtTierMin = applyMarkup(tier.from);
      if (markedUpAtTierMin >= markedUpPrice) {
        minCostPrice = Math.min(minCostPrice, tier.from);
      }
    }
    // If costPriceForMarkedUp > tier.to, this tier can't help us (cost price too high for this tier)
  }
  
  return minCostPrice === Infinity ? 0 : Math.round(minCostPrice * 100) / 100; // Round to 2 decimal places
}

module.exports = {
  MARKUP_TIERS,
  getMarkupPercentage,
  applyMarkup,
  applyMarkupToProduct,
  applyMarkupToProducts,
  applyMarkupToPriceRange,
  reverseMarkup,
  reverseMarkupMin
};

