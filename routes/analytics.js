const express = require('express');
const { optionalAuth } = require('../utils/auth');
const { recordJourneyEvent } = require('../services/journeyAnalyticsService');

const router = express.Router();

router.post('/events', optionalAuth, async (req, res, next) => {
  try {
    const result = await recordJourneyEvent(req.body || {}, req.user || null);
    res.status(202).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
