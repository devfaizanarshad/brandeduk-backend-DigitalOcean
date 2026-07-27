const { pool, queryWithTimeout } = require('../config/database');

let customizationTablesReady = false;

function normalizeSlug(value, fallback = '') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeProductTypeRow(row) {
  if (row && row.slug === 'safety-vests') {
    return { ...row, name: 'Hi Vis' };
  }
  return row;
}

function normalizeMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  if (!['embroidery', 'print'].includes(method)) {
    throw new Error(`Unsupported customization method: ${value}`);
  }
  return method;
}

function normalizePriceType(value) {
  const priceType = String(value || 'fixed').trim().toLowerCase();
  if (!['fixed', 'poa'].includes(priceType)) {
    throw new Error(`Unsupported price type: ${value}`);
  }
  return priceType;
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function parseOptionalPrice(value, priceType) {
  if (priceType === 'poa') return null;
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid price value: ${value}`);
  }
  return Number(numeric.toFixed(2));
}

async function ensureCustomizationTables() {
  if (customizationTablesReady) return;

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS customization_configs (
      id SERIAL PRIMARY KEY,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
      scope_type VARCHAR(40) NOT NULL DEFAULT 'product_type',
      subtype_key VARCHAR(120) NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (product_type_id, scope_type, subtype_key)
    )
  `, [], 10000);

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS customization_config_positions (
      id SERIAL PRIMARY KEY,
      config_id INTEGER NOT NULL REFERENCES customization_configs(id) ON DELETE CASCADE,
      slug VARCHAR(120) NOT NULL,
      label VARCHAR(120) NOT NULL,
      image_url TEXT,
      product_image_type VARCHAR(80),
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (config_id, slug)
    )
  `, [], 10000);

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS customization_config_methods (
      id SERIAL PRIMARY KEY,
      position_id INTEGER NOT NULL REFERENCES customization_config_positions(id) ON DELETE CASCADE,
      method VARCHAR(40) NOT NULL,
      price NUMERIC(10, 2),
      price_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (position_id, method)
    )
  `, [], 10000);

  await queryWithTimeout(`
    CREATE INDEX IF NOT EXISTS idx_customization_configs_product_type
    ON customization_configs(product_type_id, scope_type, subtype_key)
  `, [], 10000);

  await queryWithTimeout(`
    CREATE INDEX IF NOT EXISTS idx_customization_positions_config
    ON customization_config_positions(config_id, sort_order)
  `, [], 10000);

  await queryWithTimeout(`
    CREATE INDEX IF NOT EXISTS idx_customization_methods_position
    ON customization_config_methods(position_id)
  `, [], 10000);

  customizationTablesReady = true;
}

async function resolveProductTypeBySlug(productTypeSlug) {
  await ensureCustomizationTables();

  const normalized = normalizeSlug(productTypeSlug);
  const result = await queryWithTimeout(`
    SELECT id, name, slug, display_order
    FROM product_types
    WHERE LOWER(COALESCE(slug, '')) = $1
       OR LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) = $1
       OR LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '', 'g')) = REPLACE($1, '-', '')
    ORDER BY display_order ASC, name ASC
    LIMIT 1
  `, [normalized], 10000);

  return normalizeProductTypeRow(result.rows[0] || null);
}

async function resolveProductTypeById(productTypeId) {
  await ensureCustomizationTables();

  const result = await queryWithTimeout(`
    SELECT id, name, slug, display_order
    FROM product_types
    WHERE id = $1
    LIMIT 1
  `, [productTypeId], 10000);

  return normalizeProductTypeRow(result.rows[0] || null);
}

function mapConfigRows(productType, rows, metadata = {}) {
  const positionMap = new Map();

  for (const row of rows) {
    if (!positionMap.has(row.position_id)) {
      positionMap.set(row.position_id, {
        id: row.position_id,
        slug: row.position_slug,
        label: row.position_label,
        imageUrl: row.image_url,
        productImageType: row.product_image_type,
        sortOrder: row.position_sort_order || 0,
        isActive: row.position_is_active,
        methods: [],
      });
    }

    if (row.method_id) {
      positionMap.get(row.position_id).methods.push({
        id: row.method_id,
        method: row.method,
        price: row.price == null ? null : Number(row.price),
        priceType: row.price_type,
        enabled: row.method_is_enabled,
      });
    }
  }

  const positions = Array.from(positionMap.values())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map(position => ({
      ...position,
      methods: position.methods.sort((a, b) => a.method.localeCompare(b.method)),
    }));

  return {
    productType: {
      id: productType.id,
      name: productType.name,
      slug: productType.slug,
      displayOrder: productType.display_order || 0,
    },
    subtypeKey: metadata.subtypeKey || '',
    requestedSubtypeKey: metadata.requestedSubtypeKey || metadata.subtypeKey || '',
    isSubtypeFallback: Boolean(metadata.isSubtypeFallback),
    positions,
  };
}

async function getCustomizationConfigByProductTypeSlug(productTypeSlug, subtypeKey = '') {
  const productType = await resolveProductTypeBySlug(productTypeSlug);
  if (!productType) return null;
  return getCustomizationConfigByProductTypeId(productType.id, subtypeKey);
}

async function getCustomizationConfigByProductTypeId(
  productTypeId,
  subtypeKey = '',
  options = {},
) {
  await ensureCustomizationTables();

  const productType = await resolveProductTypeById(productTypeId);
  if (!productType) return null;
  const normalizedSubtypeKey = normalizeSlug(subtypeKey);
  const scopeType = normalizedSubtypeKey ? 'product_subtype' : 'product_type';
  const fallbackToDefault = options.fallbackToDefault !== false;

  const result = await queryWithTimeout(`
    SELECT
      cc.id AS config_id,
      ccp.id AS position_id,
      ccp.slug AS position_slug,
      ccp.label AS position_label,
      ccp.image_url,
      ccp.product_image_type,
      ccp.sort_order AS position_sort_order,
      ccp.is_active AS position_is_active,
      ccm.id AS method_id,
      ccm.method,
      ccm.price,
      ccm.price_type,
      ccm.is_enabled AS method_is_enabled
    FROM customization_configs cc
    LEFT JOIN customization_config_positions ccp
      ON ccp.config_id = cc.id
    LEFT JOIN customization_config_methods ccm
      ON ccm.position_id = ccp.id
    WHERE cc.product_type_id = $1
      AND cc.scope_type = $2
      AND cc.subtype_key = $3
      AND cc.is_active = true
      AND (ccp.id IS NULL OR ccp.is_active = true)
    ORDER BY ccp.sort_order ASC NULLS LAST, ccp.id ASC, ccm.method ASC
  `, [productTypeId, scopeType, normalizedSubtypeKey], 10000);

  if (
    normalizedSubtypeKey
    && fallbackToDefault
    && (result.rows.length === 0 || !result.rows[0].position_id)
  ) {
    const fallback = await getCustomizationConfigByProductTypeId(
      productTypeId,
      '',
      { fallbackToDefault: false },
    );
    return {
      ...fallback,
      requestedSubtypeKey: normalizedSubtypeKey,
      isSubtypeFallback: true,
    };
  }

  if (result.rows.length === 0 || !result.rows[0].position_id) {
    return {
      productType: {
        id: productType.id,
        name: productType.name,
        slug: productType.slug,
        displayOrder: productType.display_order || 0,
      },
      subtypeKey: normalizedSubtypeKey,
      requestedSubtypeKey: normalizedSubtypeKey,
      isSubtypeFallback: false,
      positions: [],
    };
  }

  return mapConfigRows(productType, result.rows, {
    subtypeKey: normalizedSubtypeKey,
    requestedSubtypeKey: normalizedSubtypeKey,
    isSubtypeFallback: false,
  });
}

async function listCustomizationProductTypes() {
  await ensureCustomizationTables();

  const result = await queryWithTimeout(`
    SELECT
      pt.id,
      pt.name,
      pt.slug,
      pt.display_order,
      COUNT(DISTINCT ccp.id) FILTER (WHERE ccp.is_active = true) AS position_count,
      COUNT(DISTINCT cc.id) FILTER (
        WHERE cc.scope_type = 'product_type'
          AND cc.subtype_key = ''
          AND cc.is_active = true
      ) AS config_count
    FROM product_types pt
    LEFT JOIN customization_configs cc
      ON cc.product_type_id = pt.id
      AND cc.scope_type = 'product_type'
      AND cc.subtype_key = ''
    LEFT JOIN customization_config_positions ccp
      ON ccp.config_id = cc.id
    GROUP BY pt.id, pt.name, pt.slug, pt.display_order
    ORDER BY pt.display_order ASC, pt.name ASC
  `, [], 10000);

  return result.rows.map(row => {
    const normalized = normalizeProductTypeRow(row);
    return {
      id: normalized.id,
      name: normalized.name,
      slug: normalized.slug,
      displayOrder: normalized.display_order || 0,
      hasCustomization: Number(normalized.config_count || 0) > 0,
      positionCount: Number(normalized.position_count || 0),
    };
  });
}

function normalizePositionInput(position, index) {
  const label = String(position?.label || '').trim();
  if (!label) {
    throw new Error(`Position ${index + 1} is missing a label`);
  }

  const slug = normalizeSlug(position?.slug || label);
  if (!slug) {
    throw new Error(`Position ${index + 1} is missing a valid slug`);
  }

  const methodsInput = Array.isArray(position?.methods) ? position.methods : [];
  const methods = methodsInput.map((methodInput) => {
    const method = normalizeMethod(methodInput?.method);
    const priceType = normalizePriceType(methodInput?.priceType || methodInput?.price_type);
    return {
      method,
      priceType,
      price: parseOptionalPrice(methodInput?.price, priceType),
      enabled: normalizeBoolean(methodInput?.enabled ?? methodInput?.is_enabled, true),
    };
  });

  const dedupe = new Set();
  for (const method of methods) {
    if (dedupe.has(method.method)) {
      throw new Error(`Position "${label}" has duplicate method "${method.method}"`);
    }
    dedupe.add(method.method);
  }

  return {
    slug,
    label,
    imageUrl: position?.imageUrl || position?.image_url || null,
    productImageType: position?.productImageType || position?.product_image_type || null,
    sortOrder: Number.isFinite(Number(position?.sortOrder)) ? Number(position.sortOrder) : index,
    isActive: normalizeBoolean(position?.isActive ?? position?.is_active, true),
    methods,
  };
}

async function saveCustomizationConfig(productTypeSlug, payload = {}, subtypeKey = '') {
  await ensureCustomizationTables();

  const productType = await resolveProductTypeBySlug(productTypeSlug);
  if (!productType) {
    const error = new Error(`Unknown product type: ${productTypeSlug}`);
    error.status = 404;
    throw error;
  }

  const positionsInput = Array.isArray(payload.positions) ? payload.positions : [];
  const positions = positionsInput.map(normalizePositionInput);
  // The route query identifies the configuration being edited. Fall back to
  // the body value for API clients that do not send the query parameter.
  const normalizedSubtypeKey = normalizeSlug(subtypeKey || payload.subtypeKey);
  const scopeType = normalizedSubtypeKey ? 'product_subtype' : 'product_type';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const configResult = await client.query(`
      INSERT INTO customization_configs (
        product_type_id,
        scope_type,
        subtype_key,
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (product_type_id, scope_type, subtype_key)
      DO UPDATE SET
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [productType.id, scopeType, normalizedSubtypeKey]);

    const configId = configResult.rows[0].id;

    await client.query(`
      DELETE FROM customization_config_methods
      WHERE position_id IN (
        SELECT id
        FROM customization_config_positions
        WHERE config_id = $1
      )
    `, [configId]);

    await client.query(`
      DELETE FROM customization_config_positions
      WHERE config_id = $1
    `, [configId]);

    for (const position of positions) {
      const positionResult = await client.query(`
        INSERT INTO customization_config_positions (
          config_id,
          slug,
          label,
          image_url,
          product_image_type,
          sort_order,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        configId,
        position.slug,
        position.label,
        position.imageUrl,
        position.productImageType,
        position.sortOrder,
        position.isActive,
      ]);

      const positionId = positionResult.rows[0].id;

      for (const method of position.methods) {
        await client.query(`
          INSERT INTO customization_config_methods (
            position_id,
            method,
            price,
            price_type,
            is_enabled,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [
          positionId,
          method.method,
          method.price,
          method.priceType,
          method.enabled,
        ]);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getCustomizationConfigByProductTypeId(
    productType.id,
    normalizedSubtypeKey,
    { fallbackToDefault: false },
  );
}

async function deleteCustomizationConfig(productTypeSlug, subtypeKey = '') {
  await ensureCustomizationTables();

  const productType = await resolveProductTypeBySlug(productTypeSlug);
  if (!productType) {
    const error = new Error(`Unknown product type: ${productTypeSlug}`);
    error.status = 404;
    throw error;
  }

  const normalizedSubtypeKey = normalizeSlug(subtypeKey);
  const scopeType = normalizedSubtypeKey ? 'product_subtype' : 'product_type';

  await queryWithTimeout(`
    DELETE FROM customization_configs
    WHERE product_type_id = $1
      AND scope_type = $2
      AND subtype_key = $3
  `, [productType.id, scopeType, normalizedSubtypeKey], 10000);

  return { success: true, productType, subtypeKey: normalizedSubtypeKey };
}

module.exports = {
  ensureCustomizationTables,
  getCustomizationConfigByProductTypeId,
  getCustomizationConfigByProductTypeSlug,
  listCustomizationProductTypes,
  normalizeSlug,
  saveCustomizationConfig,
  deleteCustomizationConfig,
};
