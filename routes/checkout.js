const express = require('express');
const { optionalAuth } = require('../utils/auth');
const { createOrder } = require('../services/customerCheckoutService');

const router = express.Router();

router.post('/create-order', optionalAuth, async (req, res, next) => {
  try {
    const order = await createOrder(req.body || {}, req.user || null);
    res.status(201).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
