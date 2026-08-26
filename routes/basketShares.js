const express = require('express');
const crypto = require('crypto');
const { queryWithTimeout } = require('../config/database');

const router = express.Router();
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const SHARE_LIFETIME_DAYS = 30;
const SENSITIVE_KEYS = new Set([
  'customer', 'customeremail', 'customerphone', 'email', 'phone', 'address',
  'address1', 'address2', 'deliveryaddress', 'billingaddress', 'authToken', 'token'
].map((key) => key.toLowerCase()));
let schemaPromise;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = queryWithTimeout(`
      CREATE TABLE IF NOT EXISTS shared_baskets (
        token VARCHAR(64) PRIMARY KEY,
        basket_data JSONB NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0
      )
    `, [], 10000).then(() => queryWithTimeout(
      'CREATE INDEX IF NOT EXISTS idx_shared_baskets_expires_at ON shared_baskets(expires_at)',
      [],
      10000
    )).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function cleanString(value, key) {
  const text = String(value || '');
  const mediaKey = /(?:image|logo|preview|data|src|url)$/i.test(key || '');
  if (mediaKey && /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(text)) return text;
  if (mediaKey && /^https?:\/\//i.test(text)) return text.slice(0, 4000);
  return text.replace(/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 20000);
}

function sanitizeSnapshot(value, depth = 0, key = '') {
  if (depth > 14) return null;
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return cleanString(value, key);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeSnapshot(item, depth + 1, key));
  if (typeof value !== 'object') return null;

  const output = {};
  Object.entries(value).slice(0, 150).forEach(([property, child]) => {
    if (property === '__proto__' || property === 'constructor' || property === 'prototype') return;
    if (SENSITIVE_KEYS.has(String(property).toLowerCase())) return;
    output[property] = sanitizeSnapshot(child, depth + 1, property);
  });
  return output;
}

router.post('/', async (req, res) => {
  try {
    const basket = req.body && req.body.basket;
    if (!Array.isArray(basket) || basket.length === 0) {
      return res.status(400).json({ success: false, message: 'Basket must contain at least one item.' });
    }
    if (basket.length > 50) {
      return res.status(400).json({ success: false, message: 'Basket is too large to share.' });
    }

    const sanitizedBasket = sanitizeSnapshot(basket);
    const serialized = JSON.stringify(sanitizedBasket);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
      return res.status(413).json({ success: false, message: 'Basket artwork is too large to share.' });
    }

    await ensureSchema();
    await queryWithTimeout('DELETE FROM shared_baskets WHERE expires_at <= NOW()', [], 10000).catch(() => {});

    const token = crypto.randomBytes(18).toString('base64url');
    await queryWithTimeout(`
      INSERT INTO shared_baskets (token, basket_data, notes, expires_at)
      VALUES ($1, $2::jsonb, $3, NOW() + ($4::integer * INTERVAL '1 day'))
    `, [token, serialized, '', SHARE_LIFETIME_DAYS], 10000);

    return res.status(201).json({ success: true, token, expiresInDays: SHARE_LIFETIME_DAYS });
  } catch (error) {
    console.error('[BASKET SHARE] Create failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to create a share link.' });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      return res.status(400).json({ success: false, message: 'Invalid share link.' });
    }

    await ensureSchema();
    const result = await queryWithTimeout(`
      UPDATE shared_baskets
      SET access_count = access_count + 1
      WHERE token = $1 AND expires_at > NOW()
      RETURNING basket_data, notes, expires_at
    `, [token], 10000);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'This shared basket has expired or is unavailable.' });
    }

    const row = result.rows[0];
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      basket: row.basket_data,
      notes: row.notes || '',
      expiresAt: row.expires_at,
    });
  } catch (error) {
    console.error('[BASKET SHARE] Load failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load the shared basket.' });
  }
});

module.exports = router;
