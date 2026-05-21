const express = require('express');
const { optionalAuth, requireAuth } = require('../utils/auth');
const {
  getOrderForViewer,
  listOrdersForUser,
  trackGuestOrder,
} = require('../services/customerCheckoutService');

const router = express.Router();

router.get('/my-orders', requireAuth, async (req, res, next) => {
  try {
    const orders = await listOrdersForUser(req.user.id);
    res.json({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
});

router.post('/guest-track', async (req, res, next) => {
  try {
    const order = await trackGuestOrder(req.body || {});
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const order = await getOrderForViewer(req.params.id, req.user || null, req.query || {});
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
