const crypto = require('crypto');
const https = require('https');
const { queryWithTimeout } = require('../config/database');
const { sendPaymentSuccessEmail } = require('../utils/emailService');

const DEFAULT_CURRENCY = (process.env.STRIPE_CURRENCY || 'gbp').toLowerCase();
const MIN_PAYMENT_AMOUNT = parseInt(process.env.STRIPE_MIN_AMOUNT || '50', 10);
const MAX_PAYMENT_AMOUNT = parseInt(process.env.STRIPE_MAX_AMOUNT || '100000000', 10);
const WEBHOOK_TOLERANCE_SECONDS = parseInt(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || '300', 10);
const CHECKOUT_SUCCESS_URL = process.env.STRIPE_CHECKOUT_SUCCESS_URL || process.env.CHECKOUT_SUCCESS_URL;
const CHECKOUT_CANCEL_URL = process.env.STRIPE_CHECKOUT_CANCEL_URL || process.env.CHECKOUT_CANCEL_URL;

let stripePaymentsTableReady = false;

function getStripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_PRIVATE_KEY;
  if (!key) {
    const error = new Error('Stripe secret key is not configured');
    error.status = 500;
    throw error;
  }
  return key;
}

function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const error = new Error('Stripe webhook secret is not configured');
    error.status = 500;
    throw error;
  }
  return secret;
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function parseAmountToMinorUnits(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/[£,\s]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100);
  }

  return null;
}

function resolveQuoteAmount(summary = {}, explicitAmount) {
  const amountCandidates = [
    explicitAmount,
    summary.amount,
    summary.displayTotal,
    summary.totalIncVat,
    summary.total,
    summary.grandTotal,
    summary.subtotal,
    summary.totalExVat,
  ];

  for (const candidate of amountCandidates) {
    const amount = parseAmountToMinorUnits(candidate);
    if (amount != null) return amount;
  }

  return null;
}

function validatePaymentInput(body) {
  const quoteData = body.quoteData && typeof body.quoteData === 'object' ? body.quoteData : body;
  const customer = quoteData.customer || body.customer || {};
  const summary = quoteData.summary || body.summary || {};
  const amount = resolveQuoteAmount(summary, body.amount);
  const currency = normalizeString(body.currency || summary.currency, DEFAULT_CURRENCY).toLowerCase();
  const email = normalizeString(customer.email || body.customerEmail);
  const fullName = normalizeString(customer.fullName || customer.name || body.customerName);

  if (!email) {
    const error = new Error('customer.email is required');
    error.status = 400;
    throw error;
  }

  if (!amount || amount < MIN_PAYMENT_AMOUNT) {
    const error = new Error(`Payment amount must be at least ${MIN_PAYMENT_AMOUNT} minor currency units`);
    error.status = 400;
    throw error;
  }

  if (amount > MAX_PAYMENT_AMOUNT) {
    const error = new Error('Payment amount is above the configured maximum');
    error.status = 400;
    throw error;
  }

  if (!/^[a-z]{3}$/.test(currency)) {
    const error = new Error('currency must be a valid three-letter ISO currency code');
    error.status = 400;
    throw error;
  }

  return {
    quoteData,
    customer,
    summary,
    amount,
    currency,
    email,
    fullName,
  };
}

function getCheckoutUrls() {
  const successUrl = normalizeString(CHECKOUT_SUCCESS_URL);
  const cancelUrl = normalizeString(CHECKOUT_CANCEL_URL);

  if (!successUrl || !cancelUrl) {
    const error = new Error('Stripe Checkout success/cancel URLs are not configured');
    error.status = 500;
    throw error;
  }

  return { successUrl, cancelUrl };
}

function createQuoteId() {
  return `quote_pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function buildMetadata({ quoteId, email, fullName, quoteData }) {
  const basket = Array.isArray(quoteData.basket) ? quoteData.basket : [];
  const customizations = Array.isArray(quoteData.customizations) ? quoteData.customizations : [];

  return {
    quote_id: quoteId,
    customer_email: email.slice(0, 500),
    customer_name: fullName.slice(0, 500),
    basket_items: String(basket.length),
    customizations: String(customizations.length),
    source: 'brandeduk_quote_api',
  };
}

function parseJsonResponse(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function sendStripeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || '';
    const request = https.request({
      hostname: 'api.stripe.com',
      path: `/v1${path}`,
      method: options.method || 'POST',
      headers: {
        Authorization: `Bearer ${getStripeSecretKey()}`,
        ...(body ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        const data = parseJsonResponse(responseBody);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(data?.error?.message || 'Stripe request failed');
          error.status = response.statusCode >= 500 ? 502 : response.statusCode;
          error.stripeError = data.error || data;
          reject(error);
          return;
        }

        resolve(data);
      });
    });

    request.on('error', (error) => {
      const wrapped = new Error(`Stripe network request failed: ${error.message}`);
      wrapped.status = 502;
      reject(wrapped);
    });

    if (body) request.write(body);
    request.end();
  });
}

async function stripeRequest(path, params, options = {}) {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;

    if (key === 'metadata' && typeof value === 'object') {
      for (const [metadataKey, metadataValue] of Object.entries(value)) {
        body.append(`metadata[${metadataKey}]`, String(metadataValue));
      }
      continue;
    }

    if (typeof value === 'object') {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        body.append(`${key}[${nestedKey}]`, String(nestedValue));
      }
      continue;
    }

    body.append(key, String(value));
  }

  return sendStripeRequest(path, {
    method: options.method || 'POST',
    body: body.toString(),
    idempotencyKey: options.idempotencyKey,
  });
}

async function ensureStripePaymentsTable() {
  if (stripePaymentsTableReady) return;

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS stripe_quote_payments (
      id SERIAL PRIMARY KEY,
      quote_id VARCHAR(80) UNIQUE NOT NULL,
      stripe_payment_intent_id VARCHAR(120) UNIQUE NOT NULL,
      stripe_customer_id VARCHAR(120),
      customer_name TEXT,
      customer_email TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'gbp',
      status VARCHAR(80) NOT NULL,
      quote_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_webhook_event_id VARCHAR(120),
      payment_email_sent_at TIMESTAMP WITHOUT TIME ZONE,
      payment_email_last_error TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP WITHOUT TIME ZONE
    )
  `, [], 10000);

  await queryWithTimeout(`
    ALTER TABLE stripe_quote_payments
    ADD COLUMN IF NOT EXISTS payment_email_sent_at TIMESTAMP WITHOUT TIME ZONE
  `, [], 10000);

  await queryWithTimeout(`
    ALTER TABLE stripe_quote_payments
    ADD COLUMN IF NOT EXISTS payment_email_last_error TEXT
  `, [], 10000);

  stripePaymentsTableReady = true;
}

async function savePaymentRecord(paymentIntent, paymentInput) {
  await ensureStripePaymentsTable();

  await queryWithTimeout(`
    INSERT INTO stripe_quote_payments (
      quote_id,
      stripe_payment_intent_id,
      customer_name,
      customer_email,
      amount,
      currency,
      status,
      quote_data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    ON CONFLICT (quote_id) DO UPDATE SET
      stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
      customer_name = EXCLUDED.customer_name,
      customer_email = EXCLUDED.customer_email,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      quote_data = EXCLUDED.quote_data,
      updated_at = CURRENT_TIMESTAMP
  `, [
    paymentIntent.metadata.quote_id,
    paymentIntent.id,
    paymentInput.fullName || null,
    paymentInput.email,
    paymentInput.amount,
    paymentInput.currency,
    paymentIntent.status,
    JSON.stringify(paymentInput.quoteData),
  ], 10000);
}

async function createQuotePaymentIntent(body, idempotencyKey) {
  const paymentInput = validatePaymentInput(body);
  const quoteId = normalizeString(body.quoteId) || createQuoteId();
  const metadata = buildMetadata({ quoteId, ...paymentInput });

  const paymentIntent = await stripeRequest('/payment_intents', {
    amount: paymentInput.amount,
    currency: paymentInput.currency,
    receipt_email: paymentInput.email,
    description: `Branded UK quote payment ${quoteId}`,
    'automatic_payment_methods[enabled]': 'true',
    metadata,
  }, {
    idempotencyKey: idempotencyKey || quoteId,
  });

  try {
    await savePaymentRecord(paymentIntent, paymentInput);
  } catch (error) {
    console.error('[STRIPE] Failed to save payment record:', error.message);
  }

  return {
    quoteId,
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status: paymentIntent.status,
  };
}

async function createQuoteCheckoutSession(body, idempotencyKey) {
  const paymentInput = validatePaymentInput(body);
  const { successUrl, cancelUrl } = getCheckoutUrls();
  const quoteId = normalizeString(body.quoteId) || createQuoteId();
  const metadata = buildMetadata({ quoteId, ...paymentInput });

  const basket = Array.isArray(paymentInput.quoteData?.basket) ? paymentInput.quoteData.basket : [];
  const productName = basket.length === 1
    ? (normalizeString(basket[0]?.name) || 'Branded UK Quote')
    : `Branded UK Quote (${basket.length} items)`;

  // Create Stripe Checkout Session
  // Note: We put metadata on the resulting PaymentIntent via payment_intent_data[metadata]
  // so our existing webhook handler can correlate by quote_id.
  const session = await stripeRequest('/checkout/sessions', {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: paymentInput.email,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': paymentInput.currency,
    'line_items[0][price_data][unit_amount]': paymentInput.amount,
    'line_items[0][price_data][product_data][name]': productName,
    'payment_intent_data[receipt_email]': paymentInput.email,
    ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`payment_intent_data[metadata][${k}]`, v])),
  }, {
    idempotencyKey: idempotencyKey || quoteId,
  });

  // Save a record early (status may be "requires_payment_method" etc. once PaymentIntent exists).
  // Checkout Session may not immediately include payment_intent; webhook will finalize.
  try {
    await ensureStripePaymentsTable();
    await queryWithTimeout(`
      INSERT INTO stripe_quote_payments (
        quote_id,
        stripe_payment_intent_id,
        customer_name,
        customer_email,
        amount,
        currency,
        status,
        quote_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (quote_id) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        customer_email = EXCLUDED.customer_email,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        status = EXCLUDED.status,
        quote_data = EXCLUDED.quote_data,
        updated_at = CURRENT_TIMESTAMP
    `, [
      quoteId,
      // placeholder until we get the PI from webhook; keep unique-ish to avoid null constraint
      // Stripe PaymentIntent id will overwrite later via webhook update (matched by quote_id).
      normalizeString(session.payment_intent) || `pending_session_${session.id}`,
      paymentInput.fullName || null,
      paymentInput.email,
      paymentInput.amount,
      paymentInput.currency,
      normalizeString(session.status) || 'created',
      JSON.stringify(paymentInput.quoteData),
    ], 10000);
  } catch (error) {
    console.error('[STRIPE] Failed to save checkout session record:', error.message);
  }

  return {
    quoteId,
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
    amount: paymentInput.amount,
    currency: paymentInput.currency,
  };
}

function parseStripeSignature(signatureHeader) {
  return String(signatureHeader || '')
    .split(',')
    .reduce((parts, item) => {
      const [key, value] = item.split('=');
      if (key && value) {
        parts[key] = parts[key] || [];
        parts[key].push(value);
      }
      return parts;
    }, {});
}

function verifyWebhookPayload(rawBody, signatureHeader) {
  const secret = getStripeWebhookSecret();
  const parts = parseStripeSignature(signatureHeader);
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];

  if (!timestamp || signatures.length === 0) {
    const error = new Error('Invalid Stripe signature header');
    error.status = 400;
    throw error;
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > WEBHOOK_TOLERANCE_SECONDS) {
    const error = new Error('Stripe webhook signature timestamp is outside tolerance');
    error.status = 400;
    throw error;
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const isValid = signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, 'hex');
    return signatureBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });

  if (!isValid) {
    const error = new Error('Stripe webhook signature verification failed');
    error.status = 400;
    throw error;
  }

  return JSON.parse(payload);
}

async function updatePaymentFromWebhook(event) {
  const paymentIntent = event?.data?.object;
  if (!paymentIntent?.id || paymentIntent.object !== 'payment_intent') {
    return;
  }

  const quoteId = paymentIntent.metadata?.quote_id;
  if (!quoteId) return;

  await ensureStripePaymentsTable();

  await queryWithTimeout(`
    UPDATE stripe_quote_payments
    SET
      stripe_payment_intent_id = $5,
      status = $1,
      last_webhook_event_id = $2,
      updated_at = CURRENT_TIMESTAMP,
      paid_at = CASE WHEN $1 = 'succeeded' THEN CURRENT_TIMESTAMP ELSE paid_at END
    WHERE quote_id = $3 OR stripe_payment_intent_id = $4
  `, [
    paymentIntent.status,
    event.id || null,
    quoteId,
    paymentIntent.id,
    paymentIntent.id,
  ], 10000);

  if (paymentIntent.status === 'succeeded') {
    await sendPaymentSuccessNotification(paymentIntent);
  }
}

async function sendPaymentSuccessNotification(paymentIntent) {
  const quoteId = paymentIntent.metadata?.quote_id;
  if (!quoteId) return;

  const result = await queryWithTimeout(`
    SELECT
      quote_id,
      stripe_payment_intent_id,
      customer_name,
      customer_email,
      amount,
      currency,
      status,
      quote_data,
      paid_at,
      payment_email_sent_at
    FROM stripe_quote_payments
    WHERE quote_id = $1 OR stripe_payment_intent_id = $2
    ORDER BY updated_at DESC
    LIMIT 1
  `, [quoteId, paymentIntent.id], 10000);

  const row = result.rows[0];
  if (row?.payment_email_sent_at) return;

  try {
    await sendPaymentSuccessEmail({
      quoteId,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      customerName: row?.customer_name || paymentIntent.metadata?.customer_name || null,
      customerEmail: row?.customer_email || paymentIntent.receipt_email || paymentIntent.metadata?.customer_email || null,
      paidAt: row?.paid_at || new Date().toISOString(),
      quoteData: row?.quote_data || {},
    });

    await queryWithTimeout(`
      UPDATE stripe_quote_payments
      SET
        payment_email_sent_at = CURRENT_TIMESTAMP,
        payment_email_last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE quote_id = $1 OR stripe_payment_intent_id = $2
    `, [quoteId, paymentIntent.id], 10000);
  } catch (error) {
    console.error('[STRIPE] Failed to send payment success email:', error.message);
    await queryWithTimeout(`
      UPDATE stripe_quote_payments
      SET
        payment_email_last_error = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE quote_id = $1 OR stripe_payment_intent_id = $2
    `, [quoteId, paymentIntent.id, error.message], 10000);
  }
}

async function getPaymentStatus(paymentIntentId) {
  if (!paymentIntentId || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
    const error = new Error('A valid Stripe payment intent id is required');
    error.status = 400;
    throw error;
  }

  const data = await sendStripeRequest(`/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    method: 'GET',
  });

  return {
    paymentIntentId: data.id,
    amount: data.amount,
    currency: data.currency,
    status: data.status,
    quoteId: data.metadata?.quote_id || null,
    customerEmail: data.metadata?.customer_email || null,
  };
}

module.exports = {
  createQuoteCheckoutSession,
  createQuotePaymentIntent,
  getPaymentStatus,
  updatePaymentFromWebhook,
  verifyWebhookPayload,
};
