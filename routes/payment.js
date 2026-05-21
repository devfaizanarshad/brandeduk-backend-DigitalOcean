const express = require('express');
const crypto = require('crypto');
const { optionalAuth } = require('../utils/auth');
const {
  createOrderPaymentIntent,
  createOrderPaymentSession,
  updateOrderPaymentFromStripe,
} = require('../services/customerCheckoutService');

const router = express.Router();

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
  const secret = process.env.STRIPE_ORDER_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const error = new Error('Stripe webhook secret is not configured');
    error.status = 500;
    throw error;
  }

  const parts = parseStripeSignature(signatureHeader);
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) {
    const error = new Error('Invalid Stripe signature header');
    error.status = 400;
    throw error;
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  const isValid = signatures.some(signature => {
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

router.post('/create-session', optionalAuth, async (req, res, next) => {
  try {
    const result = await createOrderPaymentSession(
      req.body || {},
      req.user || null,
      req.get('Idempotency-Key')
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/create-intent', optionalAuth, async (req, res, next) => {
  try {
    const result = await createOrderPaymentIntent(
      req.body || {},
      req.user || null,
      req.get('Idempotency-Key')
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const event = verifyWebhookPayload(req.body, req.get('stripe-signature'));

    if (
      event.type === 'checkout.session.completed'
      || event.type === 'payment_intent.succeeded'
      || event.type === 'payment_intent.payment_failed'
      || event.type === 'payment_intent.canceled'
      || event.type === 'payment_intent.processing'
    ) {
      await updateOrderPaymentFromStripe(event);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[PAYMENT] Webhook error:', error.message);
    res.status(error.status || 400).json({ received: false, message: error.message });
  }
});

module.exports = router;
