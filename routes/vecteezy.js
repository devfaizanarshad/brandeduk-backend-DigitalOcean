const express = require('express');
const {
  getAccountInfo,
  getResource,
  getSimilarResources,
  searchResources,
} = require('../services/vecteezyService');

const router = express.Router();

function sendError(res, error, fallbackMessage) {
  console.error('[VECTEEZY]', error.message);
  return res.status(error.status || 500).json({
    success: false,
    message: error.status && error.status < 500 ? error.message : fallbackMessage,
  });
}

/**
 * GET /api/vecteezy/search
 * Search Vecteezy resources for frontend preview and selected image URLs.
 */
router.get('/search', async (req, res) => {
  try {
    const results = await searchResources(req.query || {});
    return res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    return sendError(res, error, 'Unable to search Vecteezy resources');
  }
});

/**
 * GET /api/vecteezy/resources/:id
 * Retrieve frontend-safe metadata for a single Vecteezy resource.
 */
router.get('/resources/:id', async (req, res) => {
  try {
    const result = await getResource(req.params.id);
    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return sendError(res, error, 'Unable to fetch Vecteezy resource');
  }
});

/**
 * GET /api/vecteezy/resources/:id/similar
 * Retrieve visually similar resources.
 */
router.get('/resources/:id/similar', async (req, res) => {
  try {
    const results = await getSimilarResources(req.params.id, req.query || {});
    return res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    return sendError(res, error, 'Unable to fetch similar Vecteezy resources');
  }
});

/**
 * GET /api/vecteezy/account/info
 * Account quota information for backend/admin checks.
 */
router.get('/account/info', async (req, res) => {
  try {
    const info = await getAccountInfo(req.query.months);
    return res.json({
      success: true,
      data: info,
    });
  } catch (error) {
    return sendError(res, error, 'Unable to fetch Vecteezy account info');
  }
});

module.exports = router;
