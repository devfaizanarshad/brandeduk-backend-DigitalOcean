const express = require('express');
const { requireAuth } = require('../utils/auth');
const {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} = require('../services/customerCheckoutService');

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const addresses = await listAddresses(req.user.id);
    res.json({ success: true, data: addresses });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const address = await createAddress(req.user.id, req.body || {});
    res.status(201).json({ success: true, data: address });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const address = await updateAddress(req.user.id, req.params.id, req.body || {});
    res.json({ success: true, data: address });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteAddress(req.user.id, req.params.id);
    res.json({ success: true, message: 'Address deleted' });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/default', async (req, res, next) => {
  try {
    const address = await setDefaultAddress(req.user.id, req.params.id);
    res.json({ success: true, data: address });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
