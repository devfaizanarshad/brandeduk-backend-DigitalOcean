const { pool, queryWithTimeout } = require('../config/database');
const rules = require('./customizationCapabilityRules');
const engine = require('./customizationCapabilityEngine');

let tablesReady = false;

async function ensureCapabilityTables() {
  if (tablesReady) return;
  await queryWithTimeout(`CREATE TABLE IF NOT EXISTS customization_decoration_methods (
    method VARCHAR(40) PRIMARY KEY, label VARCHAR(120) NOT NULL, method_type VARCHAR(40) NOT NULL,
    global_status VARCHAR(20) NOT NULL CHECK (global_status IN ('AVAILABLE','POA','UNAVAILABLE','HIDDEN')),
    customer_facing BOOLEAN NOT NULL DEFAULT true, ruleset_version VARCHAR(40) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`, [], 10000);
  await queryWithTimeout(`CREATE TABLE IF NOT EXISTS customization_product_capabilities (
    product_type_key VARCHAR(120) NOT NULL, method VARCHAR(40) NOT NULL REFERENCES customization_decoration_methods(method) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('AVAILABLE','POA','UNAVAILABLE','HIDDEN')),
    ruleset_version VARCHAR(40) NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_type_key, method)
  )`, [], 10000);
  await queryWithTimeout(`CREATE TABLE IF NOT EXISTS customization_position_capabilities (
    position_key VARCHAR(120) NOT NULL, method VARCHAR(40) NOT NULL REFERENCES customization_decoration_methods(method) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('AVAILABLE','POA','UNAVAILABLE','HIDDEN')),
    ruleset_version VARCHAR(40) NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (position_key, method)
  )`, [], 10000);
  await queryWithTimeout(`CREATE TABLE IF NOT EXISTS customization_sku_capability_overrides (
    sku VARCHAR(120) NOT NULL, position_key VARCHAR(120) NOT NULL DEFAULT '', method VARCHAR(40) NOT NULL REFERENCES customization_decoration_methods(method) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('AVAILABLE','POA','UNAVAILABLE','HIDDEN')),
    notes TEXT, updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sku, position_key, method)
  )`, [], 10000);
  await seedCapabilityRules();
  tablesReady = true;
}

async function seedCapabilityRules() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [method, config] of Object.entries(rules.METHODS)) {
      await client.query(`INSERT INTO customization_decoration_methods (method,label,method_type,global_status,customer_facing,ruleset_version,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP) ON CONFLICT (method) DO UPDATE SET
        label=EXCLUDED.label, method_type=EXCLUDED.method_type, global_status=EXCLUDED.global_status,
        customer_facing=EXCLUDED.customer_facing, ruleset_version=EXCLUDED.ruleset_version, updated_at=CURRENT_TIMESTAMP`,
      [method, config.label, config.type, config.globalStatus, config.customerFacing, rules.RULESET_VERSION]);
    }
    for (const [productType, methods] of Object.entries(rules.PRODUCT_CAPABILITIES)) {
      for (const [method, status] of Object.entries(methods)) {
        await client.query(`INSERT INTO customization_product_capabilities (product_type_key,method,status,ruleset_version,updated_at)
          VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT (product_type_key,method) DO UPDATE SET
          status=EXCLUDED.status, ruleset_version=EXCLUDED.ruleset_version, updated_at=CURRENT_TIMESTAMP`,
        [productType, method, status, rules.RULESET_VERSION]);
      }
    }
    for (const [position, methods] of Object.entries(rules.POSITION_CAPABILITIES)) {
      for (const [method, status] of Object.entries(methods)) {
        await client.query(`INSERT INTO customization_position_capabilities (position_key,method,status,ruleset_version,updated_at)
          VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT (position_key,method) DO UPDATE SET
          status=EXCLUDED.status, ruleset_version=EXCLUDED.ruleset_version, updated_at=CURRENT_TIMESTAMP`,
        [position, method, status, rules.RULESET_VERSION]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolveCapabilities(input) {
  await ensureCapabilityTables();
  const productType = engine.normalizeKey(input.productType);
  const position = engine.normalizeKey(input.position);
  const sku = String(input.sku || '').trim().toUpperCase();
  const requestedMethod = input.method ? engine.normalizeMethod(input.method) : null;
  const methods = requestedMethod ? [requestedMethod] : Object.keys(rules.METHODS);

  const result = await queryWithTimeout(`SELECT m.method, m.label, m.method_type, m.global_status, m.customer_facing,
      pc.status AS product_status, pos.status AS position_status,
      COALESCE(specific.status, general.status) AS sku_status
    FROM customization_decoration_methods m
    LEFT JOIN customization_product_capabilities pc ON pc.product_type_key=$1 AND pc.method=m.method
    LEFT JOIN customization_position_capabilities pos ON pos.position_key=$2 AND pos.method=m.method
    LEFT JOIN customization_sku_capability_overrides specific ON specific.sku=$3 AND specific.position_key=$2 AND specific.method=m.method
    LEFT JOIN customization_sku_capability_overrides general ON general.sku=$3 AND general.position_key='' AND general.method=m.method
    WHERE m.method = ANY($4::varchar[]) ORDER BY m.method`, [productType, position, sku, methods], 10000);

  if (result.rows.length !== methods.length) {
    const error = new Error('One or more decoration methods are not configured');
    error.status = 400;
    throw error;
  }
  const resolved = result.rows.map(row => ({
    rulesetVersion: rules.RULESET_VERSION, productType, position, sku,
    ...engine.resolveFromStatuses({ method: row.method, productStatus: row.product_status, positionStatus: row.position_status, skuStatus: row.sku_status }),
  }));
  const byMethod = engine.addAlternatives(resolved);
  return requestedMethod ? byMethod[requestedMethod] : { rulesetVersion: rules.RULESET_VERSION, productType, position, sku, methods: byMethod };
}

module.exports = { ensureCapabilityTables, resolveCapabilities };
