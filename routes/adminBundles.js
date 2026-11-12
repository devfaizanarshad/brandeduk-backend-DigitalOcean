const express = require('express');
const {
  changeBundleStatus,
  createBundle,
  getBundle,
  getBundleAudit,
  listBundles,
  setPricingStatus,
  updateBundle,
  updateBundleComponents,
} = require('../services/fixedBundleService');
const {
  getBulkTemplate,
  upsertBulkBundles,
  validateBulkBundles,
} = require('../services/fixedBundleBulkService');

const router = express.Router();

function sendMutationResult(res, result, successStatus = 200) {
  if (result.valid) return res.status(successStatus).json({ success: true, bundle: result.bundle });
  return res.status(result.notFound ? 404 : 400).json({ success: false, errors: result.errors });
}

router.get('/bulk/template', (req, res) => {
  return res.json({ success: true, template: getBulkTemplate() });
});

router.post('/bulk/validate', async (req, res, next) => {
  try {
    const result = await validateBulkBundles(req.body);
    return res.status(result.valid ? 200 : 400).json({ success: result.valid, ...result });
  } catch (error) {
    return next(error);
  }
});

router.post('/bulk/upsert', async (req, res, next) => {
  try {
    const result = await upsertBulkBundles(req.body, req.user.id);
    return res.status(result.valid ? 200 : 400).json({ success: result.valid, ...result });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await listBundles({
      admin: true,
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      search: req.query.search,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    return sendMutationResult(res, await createBundle(req.body, req.user.id), 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const bundle = await getBundle(req.params.id, { admin: true });
    if (!bundle) return res.status(404).json({ success: false, message: 'Bundle not found' });
    return res.json({ success: true, bundle });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    return sendMutationResult(res, await updateBundle(req.params.id, req.body, req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.put('/:id/components', async (req, res, next) => {
  try {
    return sendMutationResult(res, await updateBundleComponents(req.params.id, req.body.components, req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/pricing-status', async (req, res, next) => {
  try {
    return sendMutationResult(res, await setPricingStatus(req.params.id, req.body.pricingStatus, req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/publish', async (req, res, next) => {
  try {
    return sendMutationResult(res, await changeBundleStatus(req.params.id, 'active', req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/unpublish', async (req, res, next) => {
  try {
    return sendMutationResult(res, await changeBundleStatus(req.params.id, 'draft', req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/archive', async (req, res, next) => {
  try {
    return sendMutationResult(res, await changeBundleStatus(req.params.id, 'archived', req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/audit', async (req, res, next) => {
  try {
    const bundle = await getBundle(req.params.id, { admin: true });
    if (!bundle) return res.status(404).json({ success: false, message: 'Bundle not found' });
    return res.json({ success: true, audit: await getBundleAudit(req.params.id) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
