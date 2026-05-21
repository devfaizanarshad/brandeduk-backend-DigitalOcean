const express = require('express');
const { requireAuth } = require('../utils/auth');
const { publicUser, updateProfile } = require('../services/customerCheckoutService');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ success: true, data: publicUser(req.user) });
});

router.put('/', async (req, res, next) => {
  try {
    const user = await updateProfile(req.user.id, req.body || {});
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
