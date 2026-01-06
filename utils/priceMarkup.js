/**
 * Price Markup Utility
 * Applies tiered markup percentages to supplier prices
 */

// Tiered markup configuration (based on supplier/cost price)
const MARKUP_TIERS = [
  { from: 0.01, to: 1.99, markup: 200 },
  { from: 2.00, to: 2.99, markup: 80 },
  { from: 3.00, to: 4.99, markup: 150 },
  { from: 5.00, to: 9.99, markup: 138 },
  { from: 10.00, to: 14.99, markup: 132 },
  { from: 15.00, to: 24.99, markup: 90 },
  { from: 25.00, to: 29.99, markup: 105.5 },
  { from: 30.00, to: 34.99, markup: 110.3 },
  { from: 35.00, to: 39.99, markup: 90.8 },
  { from: 40.00, to: 44.99, markup: 85.7 },
  { from: 45.00, to: Infinity, markup: 60.8 },
];

/**
 * Get markup percentage for a given price
 * @param {number} price - The supplier/cost price
 * @returns {number} - Markup percentage
 */
function getMarkupPercentage(price) {
  if (!price || price <= 0) return 0;
  
  const tier = MARKUP_TIERS.find(t => price >= t.from && price <= t.to);
  return tier ? tier.markup : 60.8; // Default to last tier if not found
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

module.exports = {
  MARKUP_TIERS,
  getMarkupPercentage,
  applyMarkup,
  applyMarkupToProduct,
  applyMarkupToProducts,
  applyMarkupToPriceRange
};

