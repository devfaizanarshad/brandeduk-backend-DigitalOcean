const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateAuthoritativeQuote,
  validatePaymentInput,
} = require('../services/stripeQuoteService');

test('Stripe quote pricing ignores browser totals and uses server prices', async () => {
  const result = await calculateAuthoritativeQuote({
    basket: [{ code: 'GD002', quantity: 10, unitPrice: 0.01, itemTotal: 0.10 }],
    customizations: [{
      productCode: 'GD002',
      method: 'print',
      position: 'Front',
      quantity: 10,
      unitPrice: 0.01,
      lineTotal: 0.10,
    }],
    summary: { totalIncVat: 0.24 },
  }, {
    buildProductDetailQuery: async () => ({
      code: 'GD002',
      basePrice: 5.92,
      priceBreaks: [
        { min: 1, max: 9, price: 5.92 },
        { min: 10, max: 24, price: 5.27 },
      ],
    }),
    resolveCustomizationPrice: async ({ quantity }) => ({
      method: 'dtf',
      unitPrice: 5.25,
      applicationTotal: 5.25 * quantity,
      pricingVersion: 'test',
      allowAutomaticCheckout: true,
      digitisingFeePerDesign: 0,
    }),
  });

  assert.equal(result.quoteData.summary.garmentCost, 52.70);
  assert.equal(result.quoteData.summary.customizationCost, 52.50);
  assert.equal(result.quoteData.summary.totalExVat, 105.20);
  assert.equal(result.quoteData.summary.vatAmount, 21.04);
  assert.equal(result.quoteData.summary.totalIncVat, 126.24);
  assert.equal(result.amount, 12624);
});

test('Stripe quote pricing blocks manual-review customisations', async () => {
  await assert.rejects(() => calculateAuthoritativeQuote({
    basket: [{ code: 'GD002', quantity: 250 }],
    customizations: [{ method: 'embroidery', quantity: 250, hasLogo: true }],
  }, {
    buildProductDetailQuery: async () => ({ code: 'GD002', basePrice: 4, priceBreaks: [] }),
    resolveCustomizationPrice: async () => ({
      method: 'embroidery',
      unitPrice: 2.5,
      applicationTotal: 625,
      allowAutomaticCheckout: false,
      digitisingFeePerDesign: 25,
    }),
  }), /require manual approval/i);
});

test('Stripe checkout temporarily charges the frontend total including VAT', async () => {
  const result = await validatePaymentInput({
    amount: 1,
    quoteData: {
      customer: {
        fullName: 'Checkout Test',
        email: 'checkout@example.com',
      },
      basket: [{ code: 'GD002', quantity: 10 }],
      summary: {
        totalExVat: 355.60,
        vatAmount: 71.12,
        totalIncVat: 426.72,
        displayTotal: 426.72,
      },
    },
  });

  assert.equal(result.amount, 42672);
  assert.equal(result.summary.totalIncVat, 426.72);
  assert.equal(result.quoteData.summary.pricingSource, 'frontend');
});

test('Stripe checkout rejects missing or invalid frontend totals', async () => {
  const customer = { fullName: 'Checkout Test', email: 'checkout@example.com' };

  await assert.rejects(
    () => validatePaymentInput({ quoteData: { customer, summary: {} } }),
    /displayed basket total is required/i,
  );

  await assert.rejects(
    () => validatePaymentInput({ quoteData: { customer, summary: { totalIncVat: 0.10 } } }),
    /at least/i,
  );
});
