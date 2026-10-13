'use strict';

const express = require('express');
const { broadcastCacheInvalidation } = require('../services/cacheSync');
const { insertMissingPencarrieStyle } = require('../services/catalogInsertService');

const router = express.Router();

router.post('/missing-style', async (req, res) => {
  try {
    const result = await insertMissingPencarrieStyle(req.body);
    res.status(result.status === 'inserted' ? 201 : 200).json(result);
  } catch (error) {
    const status = /required|approved|between|must match/i.test(error.message) ? 400 : 500;
    console.error('[CATALOG IMPORT] Failed to insert style:', error.message);
    res.status(status).json({ error: status === 400 ? 'Bad request' : 'Internal server error', message: error.message });
  }
});

router.post('/finalize', async (_req, res) => {
  try {
    await broadcastCacheInvalidation({ refreshViews: true, reason: 'pencarrie_insert_only_import' });
    res.json({ success: true });
  } catch (error) {
    console.error('[CATALOG IMPORT] Finalize failed:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
