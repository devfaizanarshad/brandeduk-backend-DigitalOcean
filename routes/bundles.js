const express = require('express');
const {
  getBundle,
  getComponentOptions,
  listBundles,
  validateBundleSelection,
} = require('../services/fixedBundleService');

const router = express.Router();

// The public API is read by browsers, so it must never carry supplier costs,
// competitor prices or internal review notes. (Admin routes use the full rows.)
const PREVIEW_MESSAGE = 'This bundle is currently available for preview only.';

function toPublicComponent(component) {
  const { sourceUnitCost, observedMinCartonPrice, observedMaxCartonPrice, ...safe } = component;
  return safe;
}

function toPublicBundle(bundle) {
  const { competitorPriceExVat, publishBlockReason, ...safe } = bundle;
  return {
    ...safe,
    // Checkout discount-code offers are promotions, not fixed product bundles.
    promotionOnly: /discount code/i.test(publishBlockReason || ''),
    availabilityMessage: bundle.orderable ? null : PREVIEW_MESSAGE,
    ...(bundle.components ? { components: bundle.components.map(toPublicComponent) } : {}),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const result = await listBundles({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      include: req.query.include === 'components' ? 'components' : undefined,
    });
    return res.json({ success: true, ...result, bundles: result.bundles.map(toPublicBundle) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const bundle = await getBundle(req.params.slug);
    if (!bundle) return res.status(404).json({ success: false, message: 'Bundle not found' });
    return res.json({ success: true, bundle: toPublicBundle(bundle) });
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
