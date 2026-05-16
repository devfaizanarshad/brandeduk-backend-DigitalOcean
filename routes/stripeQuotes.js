const express = require('express');
const {
  createQuoteCheckoutSession,
  createQuotePaymentIntent,
  getPaymentStatus,
  updatePaymentFromWebhook,
  verifyWebhookPayload,
} = require('../services/stripeQuoteService');

const router = express.Router();

/**
 * POST /api/quotes/stripe/payment-intent
 * Creates a Stripe PaymentIntent for a quote and returns the client secret.
 */
router.post('/payment-intent', async (req, res) => {
  try {
    const result = await createQuotePaymentIntent(
      req.body || {},
      req.get('Idempotency-Key')
    );

    return res.status(201).json({
      success: true,
      message: 'Stripe payment intent created',
      data: result,
    });
  } catch (error) {
    console.error('[STRIPE] Failed to create quote payment intent:', error.message);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status && error.status < 500 ? error.message : 'Unable to create payment intent',
    });
  }
});

/**
 * POST /api/quotes/stripe/checkout-session
 * Creates a Stripe Checkout Session URL for redirect-based payment.
 */
router.post('/checkout-session', async (req, res) => {
  try {
    const result = await createQuoteCheckoutSession(
      req.body || {},
      req.get('Idempotency-Key')
    );

    return res.status(201).json({
      success: true,
      message: 'Stripe checkout session created',
      data: result,
    });
  } catch (error) {
    console.error('[STRIPE] Failed to create checkout session:', error.message);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status && error.status < 500 ? error.message : 'Unable to create checkout session',
    });
  }
});

/**
 * GET /api/quotes/stripe/payment-intent/:id
 * Fetches the current Stripe status for a quote payment intent.
 */
router.get('/payment-intent/:id', async (req, res) => {
  try {
    const status = await getPaymentStatus(req.params.id);
    return res.json({ success: true, data: status });
  } catch (error) {
    console.error('[STRIPE] Failed to fetch payment intent:', error.message);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status && error.status < 500 ? error.message : 'Unable to fetch payment status',
    });
  }
});

/**
 * POST /api/quotes/stripe/webhook
 * Receives Stripe webhook events. Requires raw body middleware in server.js.
 */
router.post('/webhook', async (req, res) => {
  try {
    const event = verifyWebhookPayload(req.body, req.get('stripe-signature'));

    if (
      event.type === 'payment_intent.succeeded'
      || event.type === 'payment_intent.payment_failed'
      || event.type === 'payment_intent.canceled'
      || event.type === 'payment_intent.processing'
      || event.type === 'payment_intent.requires_action'
    ) {
      await updatePaymentFromWebhook(event);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('[STRIPE] Webhook error:', error.message);
    return res.status(error.status || 400).json({
      received: false,
      message: error.message,
    });
  }
});

module.exports = router;
