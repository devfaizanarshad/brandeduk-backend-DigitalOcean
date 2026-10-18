const express = require('express');
const { getJourneyAnalytics } = require('../services/journeyAnalyticsService');

const router = express.Router();

router.get('/abandoned-baskets', async (req, res, next) => {
  try {
    const data = await getJourneyAnalytics(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
