const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../config/database');
const { broadcastCacheInvalidation } = require('../services/cacheSync');

/**
 * GET /api/pricing/rules
 * List pricing rules (optionally only active ones)
 */
router.get('/rules', async (req, res) => {
  try {
    const { active } = req.query;
    const showOnlyActive = active === 'true';

    const query = `
      SELECT 
        version,
        from_price,
        to_price,
        markup_percent,
        active
      FROM pricing_rules
      ${showOnlyActive ? 'WHERE active = true' : ''}
      ORDER BY from_price ASC
    `;

    const result = await queryWithTimeout(query, [], 10000);
    res.json({ items: result.rows });
  } catch (error) {
    console.error('[ERROR] Failed to fetch pricing rules:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * POST /api/pricing/rules
 * Create a new pricing rule
 */
router.post('/rules', async (req, res) => {
  try {
    const {
      version = '1.0',
      from_price,
      to_price,
      markup_percent,
      active = false
    } = req.body;

    if (from_price == null || to_price == null || markup_percent == null) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'from_price, to_price and markup_percent are required'
      });
    }

    const parsedFrom = parseFloat(from_price);
    const parsedTo = parseFloat(to_price);
    const parsedMarkup = parseFloat(markup_percent);

    if (Number.isNaN(parsedFrom) || Number.isNaN(parsedTo) || Number.isNaN(parsedMarkup)) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'from_price, to_price and markup_percent must be valid numbers'
      });
    }

    if (parsedTo < parsedFrom) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'to_price must be greater than or equal to from_price'
      });
    }

    const query = `
      INSERT INTO pricing_rules (version, from_price, to_price, markup_percent, active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING version, from_price, to_price, markup_percent, active
    `;

    const params = [
      version,
      parsedFrom,
      parsedTo,
      parsedMarkup,
      !!active
    ];

    const result = await queryWithTimeout(query, params, 10000);

    res.status(201).json({
      message: 'Pricing rule created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[ERROR] Failed to create pricing rule:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/pricing/rules/:id
 * Update an existing pricing rule
 */
router.put('/rules/:id', async (req, res) => {
  try {
    // NOTE: The pricing_rules table now uses a composite primary key:
    // (version, from_price, to_price) and no longer has an integer id column.
    // To keep backward compatibility with the route shape, we interpret :id
    // as a composite key encoded as `${version}:${from_price}:${to_price}`.
    //
    // Example:
    //   PUT /api/pricing/rules/1.0:10.00:14.99
    //
    // Alternatively you can pass the full key explicitly in the body via
    // originalVersion/fromPrice/toPrice which will take precedence.
    const { id } = req.params;
    const {
      // optional new values
      from_price,
      to_price,
      markup_percent,
      active,
      version,
      // original key (if you want to move a band)
      originalVersion,
      originalFromPrice,
      originalToPrice
    } = req.body;

    const fields = [];
    const params = [];
    let idx = 1;

    if (version !== undefined) {
      fields.push(`version = $${idx++}`);
      params.push(version);
    }
    if (from_price !== undefined) {
      fields.push(`from_price = $${idx++}`);
      params.push(parseFloat(from_price));
    }
    if (to_price !== undefined) {
      fields.push(`to_price = $${idx++}`);
      params.push(parseFloat(to_price));
    }
    if (markup_percent !== undefined) {
      fields.push(`markup_percent = $${idx++}`);
      params.push(parseFloat(markup_percent));
    }
    if (active !== undefined) {
      fields.push(`active = $${idx++}`);
      params.push(!!active);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'At least one field must be provided to update'
      });
    }

    // Determine which row to update based on the composite key
    let keyVersion = originalVersion;
    let keyFrom = originalFromPrice;
    let keyTo = originalToPrice;

    // If explicit original key not provided, try to parse from the :id path segment
    if (keyVersion == null || keyFrom == null || keyTo == null) {
      const parts = (id || '').split(':');
      if (parts.length === 3) {
        [keyVersion, keyFrom, keyTo] = parts;
      }
    }

    if (keyVersion == null || keyFrom == null || keyTo == null) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'You must provide the original rule key via originalVersion/originalFromPrice/originalToPrice or use id in the format "version:from_price:to_price".'
      });
    }

    const query = `
      UPDATE pricing_rules
      SET ${fields.join(', ')}
      WHERE version = $${idx++}
        AND from_price = $${idx++}
        AND to_price = $${idx++}
      RETURNING version, from_price, to_price, markup_percent, active
    `;

    params.push(
      keyVersion,
      parseFloat(keyFrom),
      parseFloat(keyTo)
    );

    const result = await queryWithTimeout(query, params, 10000);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Pricing rule not found' });
    }

    res.json({
      message: 'Pricing rule updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[ERROR] Failed to update pricing rule:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * POST /api/pricing/reprice
 * Recalculate sell_price for all products using active pricing_rules
 * and refresh the product_search_materialized view.
 */
router.post('/reprice', async (req, res) => {
  try {
    // Step 1: Update sell_price on products table
    const updateQuery = `
      UPDATE products p
      SET 
        sell_price = ROUND(
          COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
          * (1 + (
              COALESCE(
                (SELECT markup_percent / 100 FROM product_markup_overrides pmo WHERE pmo.style_code = p.style_code),
                (
                  SELECT markup_percent / 100
                  FROM pricing_rules r
                  WHERE r.active = true
                    AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
                        BETWEEN r.from_price AND r.to_price
                  ORDER BY r.from_price
                  LIMIT 1
                )
              )
          )), 2
        ),
        pricing_version = COALESCE(
          (SELECT 'OVERRIDE' FROM product_markup_overrides pmo WHERE pmo.style_code = p.style_code),
          (
            SELECT version 
            FROM pricing_rules r 
            WHERE r.active = true 
            ORDER BY version DESC, from_price ASC
            LIMIT 1
          )
        ),
        last_priced_at = NOW()
      WHERE COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) IS NOT NULL
    `;

    const updateResult = await queryWithTimeout(updateQuery, [], 300000); // up to 5 minutes
    const updatedCount = updateResult.rowCount || 0;

    // Step 2: Refresh materialized view
    let viewRefreshed = false;
    let refreshError = null;

    try {
      await queryWithTimeout('REFRESH MATERIALIZED VIEW CONCURRENTLY product_search_materialized;', [], 600000);
      viewRefreshed = true;
    } catch (err) {
      refreshError = err.message;
      console.error('[WARN] CONCURRENTLY refresh failed, falling back to non-concurrent refresh:', err.message);
      try {
        await queryWithTimeout('REFRESH MATERIALIZED VIEW product_search_materialized;', [], 600000);
        viewRefreshed = true;
      } catch (err2) {
        refreshError = err2.message;
        console.error('[ERROR] Failed to refresh materialized view:', err2.message);
      }
    }

    // Clear product list cache so new prices are visible immediately
    await broadcastCacheInvalidation({ refreshViews: false, reason: 'reprice' });

    res.json({
      message: 'Repricing job completed',
      updatedProducts: updatedCount,
      materializedViewRefreshed: viewRefreshed,
      refreshError: viewRefreshed ? null : refreshError
    });
  } catch (error) {
    console.error('[ERROR] Failed to reprice products:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * PUT /api/pricing/products/:code/sell-price
 * Direct sell_price updates are no longer supported.
 * Use the admin carton_price endpoint instead to keep pricing consistent with rules.
 */
router.put('/products/:code/sell-price', async (req, res) => {
  return res.status(400).json({
    error: 'DirectSellPriceDisabled',
    message: 'Direct sell_price updates are disabled. Please update carton_price via the admin API so sell_price can be recalculated from pricing rules.'
  });
});

module.exports = router;

