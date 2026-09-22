const express = require('express');
const { resolveCapabilities } = require('../services/customizationCapabilityService');

const router = express.Router();

router.get('/', async (req, res) => {
  if (!req.query.productType || !req.query.position) {
    return res.status(400).json({ success: false, message: 'productType and position are required' });
  }
  try {
    return res.json({ success: true, data: await resolveCapabilities(req.query) });
  } catch (error) {
    console.error('[CUSTOMIZATION CAPABILITIES]', error.message);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to resolve customization capabilities' });
  }
});

module.exports = router;
