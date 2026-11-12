const express = require('express');
const {
  getBundle,
  getComponentOptions,
  listBundles,
  validateBundleSelection,
} = require('../services/fixedBundleService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await listBundles({ page: req.query.page, limit: req.query.limit, search: req.query.search });
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const bundle = await getBundle(req.params.slug);
    if (!bundle) return res.status(404).json({ success: false, message: 'Bundle not found' });
    return res.json({ success: true, bundle });
  } catch (error) {
    return next(error);
  }
});

router.get('/:slug/components/:componentId/options', async (req, res, next) => {
  try {
    const result = await getComponentOptions(req.params.slug, req.params.componentId, req.query);
    if (!result) return res.status(404).json({ success: false, message: 'Bundle not found' });
    if (!result.component) return res.status(404).json({ success: false, message: 'Bundle component not found' });
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.post('/:slug/validate-selection', async (req, res, next) => {
  try {
    const result = await validateBundleSelection(req.params.slug, req.body);
    if (!result.found) return res.status(404).json({ success: false, message: 'Bundle not found' });
    return res.status(result.valid ? 200 : 400).json({ success: result.valid, ...result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
