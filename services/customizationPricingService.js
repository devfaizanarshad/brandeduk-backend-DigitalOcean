const { pool, queryWithTimeout } = require('../config/database');
const { ensureCapabilityTables } = require('./customizationCapabilityService');
const rules = require('./customizationPricingRules');
const engine = require('./customizationPricingEngine');

let pricingTablesReady = false;

async function ensurePricingTables() {
  if (pricingTablesReady) return;
  await ensureCapabilityTables();
  await queryWithTimeout(`CREATE TABLE IF NOT EXISTS customization_decoration_price_tiers (
    method VARCHAR(40) NOT NULL REFERENCES customization_decoration_methods(method) ON DELETE CASCADE,
    price_class VARCHAR(40) NOT NULL DEFAULT 'standard', min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
    max_quantity INTEGER CHECK (max_quantity IS NULL OR max_quantity >= min_quantity), unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    source_count INTEGER NOT NULL DEFAULT 0, requires_manual_review BOOLEAN NOT NULL DEFAULT false,
    pricing_version VARCHAR(40) NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (method, price_class, min_quantity)
  )`, [], 10000);
  await queryWithTimeout(`CREATE TABLE IF NOT EXISTS customization_decoration_fees (
    method VARCHAR(40) NOT NULL REFERENCES customization_decoration_methods(method) ON DELETE CASCADE,
    fee_code VARCHAR(80) NOT NULL, label VARCHAR(160) NOT NULL, amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    per_unit VARCHAR(40) NOT NULL, pricing_version VARCHAR(40) NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (method, fee_code)
  )`, [], 10000);
  await seedPricing();
  pricingTablesReady = true;
}

async function seedPricing() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [method, classes] of Object.entries(rules.PRICE_TIERS)) {
      for (const [priceClass, tiers] of Object.entries(classes)) {
        for (const item of tiers) {
          await client.query(`INSERT INTO customization_decoration_price_tiers
            (method,price_class,min_quantity,max_quantity,unit_price,source_count,requires_manual_review,pricing_version,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP)
            ON CONFLICT (method,price_class,min_quantity) DO UPDATE SET max_quantity=EXCLUDED.max_quantity,
            unit_price=EXCLUDED.unit_price,source_count=EXCLUDED.source_count,requires_manual_review=EXCLUDED.requires_manual_review,
            pricing_version=EXCLUDED.pricing_version,updated_at=CURRENT_TIMESTAMP`,
          [method, priceClass, item.minQuantity, item.maxQuantity, item.unitPrice, item.sourceCount, item.requiresManualReview, rules.PRICING_VERSION]);
        }
      }
    }
    await client.query(`INSERT INTO customization_decoration_fees
      (method,fee_code,label,amount,per_unit,pricing_version,updated_at) VALUES
      ('embroidery','digitising','Embroidery digitising', $1,'unique_design',$2,CURRENT_TIMESTAMP)
      ON CONFLICT (method,fee_code) DO UPDATE SET label=EXCLUDED.label,amount=EXCLUDED.amount,
      per_unit=EXCLUDED.per_unit,pricing_version=EXCLUDED.pricing_version,updated_at=CURRENT_TIMESTAMP`,
    [rules.DIGITISING_FEE_PER_DESIGN, rules.PRICING_VERSION]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolvePrice(input) {
  await ensurePricingTables();
  const requested = engine.resolveStaticPrice(input);
  const result = await queryWithTimeout(`SELECT unit_price, min_quantity, max_quantity, source_count, requires_manual_review
    FROM customization_decoration_price_tiers WHERE method=$1 AND price_class=$2 AND min_quantity <= $3
    AND (max_quantity IS NULL OR max_quantity >= $3) ORDER BY min_quantity DESC LIMIT 1`,
  [requested.method, requested.priceClass, requested.quantity], 10000);
  if (!result.rows[0]) {
    const error = new Error('No matching customization price tier found');
    error.status = 404;
    throw error;
  }
  const row = result.rows[0];
  const unitPrice = Number(row.unit_price);
  const requiresArtworkAssessment = requested.priceClass === 'high_stitch';
  const requiresManualReview = Boolean(row.requires_manual_review) || requiresArtworkAssessment;
  return {
    ...requested,
    unitPrice,
    applicationTotal: Number((unitPrice * requested.quantity).toFixed(2)),
    tier: { minQuantity: row.min_quantity, maxQuantity: row.max_quantity, sourceCount: row.source_count },
    requiresArtworkAssessment,
    requiresManualReview,
    allowAutomaticCheckout: !requiresManualReview,
  };
}

module.exports = { ensurePricingTables, resolvePrice };
