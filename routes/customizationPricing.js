const express = require('express');
const { resolvePrice } = require('../services/customizationPricingService');

const router = express.Router();

router.get('/', async (req, res) => {
  if (!req.query.method || !req.query.quantity) {
    return res.status(400).json({ success: false, message: 'method and quantity are required' });
  }
  try {
    return res.json({ success: true, data: await resolvePrice(req.query) });
  } catch (error) {
    console.error('[CUSTOMIZATION PRICING]', error.message);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to resolve customization pricing' });
  }
});

module.exports = router;
