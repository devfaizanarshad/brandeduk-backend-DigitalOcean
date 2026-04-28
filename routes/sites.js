const express = require('express');
const router = express.Router();
const {
  getSiteProductDetail,
  listSiteProducts,
} = require('../services/siteProductService');

/**
 * GET /api/sites/:siteSlug/products
 * Public curated product feed for a secondary site, e.g. humanitiees.
 */
router.get('/:siteSlug/products', async (req, res) => {
  try {
    const { siteSlug } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const result = await listSiteProducts(siteSlug, {
      activeOnly: true,
      limit,
      offset,
    });

    res.json(result);
  } catch (error) {
    console.error('[SITES] Failed to list site products:', error.message);
    res.status(error.status || 500).json({
      error: error.status ? 'Bad request' : 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /api/sites/:siteSlug/products/:code
 * Public product detail for a product that belongs to the requested site.
 */
router.get('/:siteSlug/products/:code', async (req, res) => {
  try {
    const { siteSlug, code } = req.params;
    const product = await getSiteProductDetail(siteSlug, code);

    if (!product) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Product not found for this site',
      });
    }

    res.json(product);
  } catch (error) {
    console.error('[SITES] Failed to get site product detail:', error.message);
    res.status(error.status || 500).json({
      error: error.status ? 'Bad request' : 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
