const express = require('express');
const router = express.Router();
const { getCustomizationConfigByProductTypeSlug } = require('../services/customizationConfigService');

router.get('/:productTypeSlug', async (req, res) => {
  try {
    const config = await getCustomizationConfigByProductTypeSlug(req.params.productTypeSlug);
    if (!config) {
      return res.status(404).json({
        success: false,
        message: `No customization configuration found for product type "${req.params.productTypeSlug}"`,
      });
    }

    return res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('[CUSTOMIZATION] Failed to fetch public configuration:', error.message);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch customization configuration',
    });
  }
});

module.exports = router;
