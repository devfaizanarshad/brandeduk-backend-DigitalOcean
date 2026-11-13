const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool, queryWithTimeout } = require('../config/database');

const API_MIGRATIONS = [
  path.join(__dirname, '..', 'maintenance', 'migrations', '004_fixed_bundle_api.sql'),
  path.join(__dirname, '..', 'maintenance', 'migrations', '006_fixed_bundle_benefits.sql'),
];
const BUNDLE_STATUSES = new Set(['draft', 'active', 'archived']);
const PRICING_STATUSES = new Set([
  'pending_customization_review',
  'margin_review',
  'cost_review',
  'unpriced',
  'approved',
]);

let schemaPromise;

function ensureBundleApiSchema() {
  if (!schemaPromise) {
    schemaPromise = queryWithTimeout(API_MIGRATIONS.map(file => fs.readFileSync(file, 'utf8')).join('\n'), [], 30000)
      .catch(error => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190);
}

function money(value) {
  return value == null ? null : Number(value);
}

function normalizeBundleRow(row) {
  const orderable = row.status === 'active'
    && row.catalogue_status === 'complete'
    && row.pricing_status === 'approved';
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceExVat: money(row.price_ex_vat),
    currency: row.currency,
    status: row.status,
    catalogueStatus: row.catalogue_status,
    pricingStatus: row.pricing_status,
    totalItemQuantity: Number(row.total_item_quantity),
    featuredImageUrl: row.featured_image_url,
    isFeatured: Boolean(row.is_featured),
    displayOrder: Number(row.display_order || 0),
    includedDecorationMethods: Array.isArray(row.included_decoration_methods) ? row.included_decoration_methods : [],
    includedLogoCount: Number(row.included_logo_count || 0),
    logoPosition: row.logo_position,
    freeDelivery: Boolean(row.free_delivery),
    freeGift: row.free_gift,
    sourceIncludeText: row.source_include_text,
    orderable,
    availabilityMessage: orderable ? null : (row.publish_block_reason || 'This bundle is currently available for preview only.'),
    publishBlockReason: row.publish_block_reason,
    sourceKey: row.source_key,
    sourceBundleNumber: Number(row.source_bundle_number),
    sourceDocumentStatus: row.source_document_status,
    competitorPriceExVat: money(row.competitor_price_ex_vat),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeComponentRow(row) {
  return {
    id: Number(row.id),
    lineOrder: Number(row.line_order),
    requestedStyleCode: row.requested_style_code,
    styleCode: row.catalogue_style_code,
    quantity: Number(row.quantity),
    componentStatus: row.component_status,
    sourceUnitCost: money(row.source_unit_cost),
    observedMinCartonPrice: money(row.observed_min_carton_price),
    observedMaxCartonPrice: money(row.observed_max_carton_price),
    product: row.catalogue_style_code ? {
      name: row.style_name,
      brand: row.brand_name,
      productType: row.product_type_name,
      image: row.product_image,
      liveSkuCount: Number(row.live_sku_count || 0),
    } : null,
  };
}

function validateBundleInput(input, { partial = false } = {}) {
  const errors = [];
  const output = {};

  if (!partial || Object.hasOwn(input, 'name')) {
    const name = String(input.name || '').trim();
    if (name.length < 3 || name.length > 500) errors.push('name must contain 3 to 500 characters');
    else output.name = name;
  }

  if (!partial || Object.hasOwn(input, 'priceExVat')) {
    const price = Number(input.priceExVat);
    if (!Number.isFinite(price) || price < 0) errors.push('priceExVat must be a non-negative number');
    else output.priceExVat = Math.round(price * 100) / 100;
  }

  if (Object.hasOwn(input, 'slug')) {
    const slug = slugify(input.slug);
    if (!slug) errors.push('slug is invalid');
    else output.slug = slug;
  }
  if (Object.hasOwn(input, 'description')) output.description = input.description == null ? null : String(input.description).trim();
  if (Object.hasOwn(input, 'featuredImageUrl')) output.featuredImageUrl = input.featuredImageUrl == null ? null : String(input.featuredImageUrl).trim();
  if (Object.hasOwn(input, 'isFeatured')) output.isFeatured = Boolean(input.isFeatured);
  if (Object.hasOwn(input, 'displayOrder')) {
    const displayOrder = Number.parseInt(input.displayOrder, 10);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) errors.push('displayOrder must be a non-negative integer');
    else output.displayOrder = displayOrder;
  }
  if (Object.hasOwn(input, 'includedDecorationMethods')) {
    const methods = input.includedDecorationMethods;
    const allowedMethods = new Set(['print', 'embroidery']);
    if (!Array.isArray(methods) || methods.some(method => !allowedMethods.has(method))) {
      errors.push('includedDecorationMethods may contain only print and embroidery');
    } else {
      output.includedDecorationMethods = [...new Set(methods)];
    }
  }
  if (Object.hasOwn(input, 'includedLogoCount')) {
    const count = Number.parseInt(input.includedLogoCount, 10);
    if (!Number.isInteger(count) || count < 0 || count > 10) errors.push('includedLogoCount must be between 0 and 10');
    else output.includedLogoCount = count;
  }
  if (Object.hasOwn(input, 'logoPosition')) {
    const position = input.logoPosition == null ? null : String(input.logoPosition).trim();
    if (position && position.length > 160) errors.push('logoPosition must not exceed 160 characters');
    else output.logoPosition = position || null;
  }
  if (Object.hasOwn(input, 'freeDelivery')) output.freeDelivery = Boolean(input.freeDelivery);
  if (Object.hasOwn(input, 'freeGift')) {
    const gift = input.freeGift;
    if (gift == null) {
      output.freeGift = null;
    } else {
      const name = String(gift.name || '').trim();
      const quantity = Number.parseInt(gift.quantity, 10);
      if (!name || name.length > 200 || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        errors.push('freeGift must contain a valid name and quantity');
      } else {
        output.freeGift = { name, quantity };
      }
    }
  }

  return { valid: errors.length === 0, errors, value: output };
}

function validateComponentsInput(components) {
  if (!Array.isArray(components) || components.length === 0) {
    return { valid: false, errors: ['components must be a non-empty array'], value: [] };
  }

  const errors = [];
  const value = components.map((component, index) => {
    const styleCode = String(component.styleCode || component.requestedStyleCode || '').trim().toUpperCase();
    const quantity = Number.parseInt(component.quantity, 10);
    if (!styleCode || styleCode.length > 100) errors.push(`components[${index}].styleCode is invalid`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) errors.push(`components[${index}].quantity is invalid`);
    return { styleCode, quantity };
  });

  return { valid: errors.length === 0, errors, value };
}

async function listBundles({ admin = false, page = 1, limit = 24, status, search } = {}) {
  await ensureBundleApiSchema();
  const safePage = parsePositiveInteger(page, 1);
  const safeLimit = parsePositiveInteger(limit, 24, 100);
  const offset = (safePage - 1) * safeLimit;
  const conditions = [];
  const values = [];

  if (admin) {
    if (status && BUNDLE_STATUSES.has(status)) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
  } else {
    conditions.push(`status <> 'archived'`);
  }

  if (search) {
    values.push(`%${String(search).trim()}%`);
    conditions.push(`(name ILIKE $${values.length} OR slug ILIKE $${values.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await queryWithTimeout(`SELECT COUNT(*)::integer AS total FROM bundles ${where}`, values, 10000);
  values.push(safeLimit, offset);
  const rowsResult = await queryWithTimeout(`
    SELECT *
    FROM bundles
    ${where}
    ORDER BY is_featured DESC, display_order, id
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values, 15000);
  const total = countResult.rows[0].total;

  return {
    bundles: rowsResult.rows.map(normalizeBundleRow),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit),
  };
}

async function getBundle(identifier, { admin = false } = {}) {
  await ensureBundleApiSchema();
  const isId = admin && /^\d+$/.test(String(identifier));
  const values = [isId ? Number(identifier) : String(identifier).toLowerCase()];
  const visibility = admin ? '' : `AND status <> 'archived'`;
  const result = await queryWithTimeout(`
    SELECT *
    FROM bundles
    WHERE ${isId ? 'id' : 'slug'} = $1 ${visibility}
    LIMIT 1
  `, values, 10000);
  if (!result.rows.length) return null;

  const bundle = normalizeBundleRow(result.rows[0]);
  const componentsResult = await queryWithTimeout(`
    SELECT
      component.*,
      style.style_name,
      brand.name AS brand_name,
      product_type.name AS product_type_name,
      COUNT(product.id) FILTER (WHERE product.sku_status = 'Live')::integer AS live_sku_count,
      (ARRAY_AGG(COALESCE(NULLIF(product.colour_image_url, ''), product.primary_image_url)
        ORDER BY product.id) FILTER (
          WHERE product.sku_status = 'Live'
            AND COALESCE(NULLIF(product.colour_image_url, ''), product.primary_image_url) IS NOT NULL
        ))[1] AS product_image
    FROM bundle_components component
    LEFT JOIN styles style ON style.style_code = component.catalogue_style_code
    LEFT JOIN brands brand ON brand.id = style.brand_id
    LEFT JOIN product_types product_type ON product_type.id = style.product_type_id
    LEFT JOIN products product ON product.style_code = component.catalogue_style_code
    WHERE component.bundle_id = $1
    GROUP BY component.id, style.style_name, brand.name, product_type.name
    ORDER BY component.line_order
  `, [bundle.id], 15000);

  return { ...bundle, components: componentsResult.rows.map(normalizeComponentRow) };
}

async function getComponentOptions(slug, componentId, { page = 1, limit = 100 } = {}) {
  const bundle = await getBundle(slug);
  if (!bundle) return null;
  const component = bundle.components.find(entry => entry.id === Number(componentId));
  if (!component || !component.styleCode) return { bundle, component: null, options: [] };

  const safePage = parsePositiveInteger(page, 1);
  const safeLimit = parsePositiveInteger(limit, 100, 250);
  const offset = (safePage - 1) * safeLimit;
  const countResult = await queryWithTimeout(`
    SELECT COUNT(*)::integer AS total
    FROM products
    WHERE style_code = $1 AND sku_status = 'Live'
  `, [component.styleCode], 10000);
  const result = await queryWithTimeout(`
    SELECT
      product.sku_code AS "skuCode",
      product.colour_name AS "colourName",
      product.primary_colour AS "primaryColour",
      size.name AS "sizeName",
      size.size_order AS "sizeOrder",
      product.stock_quantity AS "stockQuantity",
      COALESCE(NULLIF(product.colour_image_url, ''), product.primary_image_url) AS image
    FROM products product
    LEFT JOIN sizes size ON size.id = product.size_id
    WHERE product.style_code = $1 AND product.sku_status = 'Live'
    ORDER BY product.colour_name, size.size_order NULLS LAST, size.name, product.sku_code
    LIMIT $2 OFFSET $3
  `, [component.styleCode, safeLimit, offset], 15000);

  return {
    bundle: { id: bundle.id, slug: bundle.slug, name: bundle.name },
    component,
    options: result.rows.map(row => ({ ...row, stockQuantity: Number(row.stockQuantity || 0) })),
    page: safePage,
    limit: safeLimit,
    total: countResult.rows[0].total,
    totalPages: Math.ceil(countResult.rows[0].total / safeLimit),
  };
}

function validateSelectionInput(input) {
  const components = input?.components;
  if (!Array.isArray(components) || components.length === 0) {
    return { valid: false, errors: ['components must be a non-empty array'], value: [] };
  }

  const errors = [];
  const value = components.map((component, componentIndex) => {
    const componentId = Number.parseInt(component.componentId, 10);
    if (!Number.isInteger(componentId) || componentId < 1) errors.push(`components[${componentIndex}].componentId is invalid`);
    if (!Array.isArray(component.selections) || component.selections.length === 0) {
      errors.push(`components[${componentIndex}].selections must be a non-empty array`);
      return { componentId, selections: [] };
    }
    const selections = component.selections.map((selection, selectionIndex) => {
      const skuCode = String(selection.skuCode || '').trim().toUpperCase();
      const quantity = Number.parseInt(selection.quantity, 10);
      if (!skuCode) errors.push(`components[${componentIndex}].selections[${selectionIndex}].skuCode is required`);
      if (!Number.isInteger(quantity) || quantity < 1) errors.push(`components[${componentIndex}].selections[${selectionIndex}].quantity is invalid`);
      return { skuCode, quantity };
    });
    return { componentId, selections };
  });

  return { valid: errors.length === 0, errors, value };
}

async function validateBundleSelection(slug, input) {
  const parsed = validateSelectionInput(input);
  if (!parsed.valid) return { found: true, valid: false, errors: parsed.errors };
  const bundle = await getBundle(slug);
  if (!bundle) return { found: false, valid: false, errors: ['Bundle not found'] };
  if (!bundle.orderable) {
    return {
      found: true,
      valid: false,
      errors: ['Bundle is available for preview but is not approved for ordering'],
      bundle: {
        id: bundle.id,
        slug: bundle.slug,
        name: bundle.name,
        orderable: false,
      },
    };
  }

  const errors = [];
  const submittedComponents = new Map();
  for (const submitted of parsed.value) {
    if (submittedComponents.has(submitted.componentId)) errors.push(`Component ${submitted.componentId} was submitted more than once`);
    submittedComponents.set(submitted.componentId, submitted);
  }

  const skuCodes = [...new Set(parsed.value.flatMap(component => component.selections.map(selection => selection.skuCode)))];
  const skuResult = skuCodes.length ? await queryWithTimeout(`
    SELECT sku_code, style_code
    FROM products
    WHERE sku_code = ANY($1::text[]) AND sku_status = 'Live'
  `, [skuCodes], 10000) : { rows: [] };
  const skuStyles = new Map(skuResult.rows.map(row => [String(row.sku_code).toUpperCase(), row.style_code]));

  for (const component of bundle.components) {
    const submitted = submittedComponents.get(component.id);
    if (!submitted) {
      errors.push(`Component ${component.id} is required`);
      continue;
    }
    const selectedQuantity = submitted.selections.reduce((sum, selection) => sum + selection.quantity, 0);
    if (selectedQuantity !== component.quantity) {
      errors.push(`Component ${component.id} requires exactly ${component.quantity} items`);
    }
    const seenSkus = new Set();
    for (const selection of submitted.selections) {
      if (seenSkus.has(selection.skuCode)) errors.push(`SKU ${selection.skuCode} is duplicated in component ${component.id}`);
      seenSkus.add(selection.skuCode);
      if (skuStyles.get(selection.skuCode) !== component.styleCode) {
        errors.push(`SKU ${selection.skuCode} is not a live option for component ${component.id}`);
      }
    }
  }

  for (const componentId of submittedComponents.keys()) {
    if (!bundle.components.some(component => component.id === componentId)) errors.push(`Component ${componentId} does not belong to this bundle`);
  }

  return {
    found: true,
    valid: errors.length === 0,
    errors,
    bundle: {
      id: bundle.id,
      slug: bundle.slug,
      name: bundle.name,
      priceExVat: bundle.priceExVat,
      currency: bundle.currency,
      totalItemQuantity: bundle.totalItemQuantity,
    },
  };
}

async function resolveComponents(client, components) {
  const styleCodes = [...new Set(components.map(component => component.styleCode))];
  const result = await client.query(`
    SELECT style.style_code, COUNT(product.id) FILTER (WHERE product.sku_status = 'Live')::integer AS live_skus
    FROM styles style
    LEFT JOIN products product ON product.style_code = style.style_code
    WHERE style.style_code = ANY($1::text[])
    GROUP BY style.style_code
  `, [styleCodes]);
  const catalogue = new Map(result.rows.map(row => [row.style_code, row.live_skus]));
  return components.map(component => ({
    ...component,
    linked: Number(catalogue.get(component.styleCode) || 0) > 0,
  }));
}

async function replaceComponents(client, bundleId, components) {
  const resolved = await resolveComponents(client, components);
  await client.query('DELETE FROM bundle_components WHERE bundle_id = $1', [bundleId]);
  for (const [index, component] of resolved.entries()) {
    await client.query(`
      INSERT INTO bundle_components (
        bundle_id, line_order, requested_style_code, catalogue_style_code,
        quantity, component_status, source_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)
    `, [
      bundleId,
      index + 1,
      component.styleCode,
      component.linked ? component.styleCode : null,
      component.quantity,
      component.linked ? 'linked' : 'missing_product',
    ]);
  }
  return resolved;
}

async function addAudit(client, bundleId, adminUserId, action, changes = {}) {
  await client.query(`
    INSERT INTO bundle_admin_audit (bundle_id, admin_user_id, action, changes)
    VALUES ($1, $2, $3, $4::jsonb)
  `, [bundleId, adminUserId || null, action, JSON.stringify(changes)]);
}

async function createBundle(input, adminUserId) {
  await ensureBundleApiSchema();
  const bundleValidation = validateBundleInput(input);
  const componentsValidation = validateComponentsInput(input.components);
  const errors = [...bundleValidation.errors, ...componentsValidation.errors];
  if (errors.length) return { valid: false, errors };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bundle = bundleValidation.value;
    const slug = bundle.slug || `${slugify(bundle.name)}-${crypto.randomBytes(3).toString('hex')}`;
    const sourceKey = `admin-${crypto.randomUUID()}`;
    const totalItemQuantity = componentsValidation.value.reduce((sum, component) => sum + component.quantity, 0);
    const result = await client.query(`
      INSERT INTO bundles (
        bundle_type, source_key, source_bundle_number, slug, name, description,
        price_ex_vat, currency, status, catalogue_status, pricing_status,
        total_item_quantity, publish_block_reason, featured_image_url, is_featured, display_order,
        included_decoration_methods, included_logo_count, logo_position, free_delivery, free_gift
      ) VALUES (
        'fixed', $1, 1, $2, $3, $4, $5, 'GBP', 'draft', 'pending',
        'pending_customization_review', $6, 'Customization and pricing approval required.', $7, $8, $9,
        $10::jsonb, $11, $12, $13, $14::jsonb
      ) RETURNING id
    `, [
      sourceKey,
      slug,
      bundle.name,
      bundle.description || null,
      bundle.priceExVat,
      totalItemQuantity,
      bundle.featuredImageUrl || null,
      bundle.isFeatured || false,
      bundle.displayOrder || 0,
      JSON.stringify(bundle.includedDecorationMethods || []),
      bundle.includedLogoCount || 0,
      bundle.logoPosition || null,
      bundle.freeDelivery || false,
      bundle.freeGift == null ? null : JSON.stringify(bundle.freeGift),
    ]);
    const bundleId = result.rows[0].id;
    const resolved = await replaceComponents(client, bundleId, componentsValidation.value);
    const missingCodes = resolved.filter(component => !component.linked).map(component => component.styleCode);
    await client.query(`
      UPDATE bundles SET
        catalogue_status = $2,
        pricing_status = $3,
        publish_block_reason = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [
      bundleId,
      missingCodes.length ? 'missing_products' : 'complete',
      missingCodes.length ? 'unpriced' : 'pending_customization_review',
      missingCodes.length
        ? `Missing exact catalogue product(s): ${missingCodes.join(', ')}`
        : 'Customization and pricing approval required.',
    ]);
    await addAudit(client, bundleId, adminUserId, 'created', { sourceKey });
    await client.query('COMMIT');
    return { valid: true, bundle: await getBundle(bundleId, { admin: true }) };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return { valid: false, errors: ['slug already exists'] };
    throw error;
  } finally {
    client.release();
  }
}

async function updateBundle(bundleId, input, adminUserId) {
  await ensureBundleApiSchema();
  const validation = validateBundleInput(input, { partial: true });
  if (!validation.valid) return validation;
  const fields = [];
  const values = [];
  const mappings = {
    name: 'name',
    slug: 'slug',
    description: 'description',
    priceExVat: 'price_ex_vat',
    featuredImageUrl: 'featured_image_url',
    isFeatured: 'is_featured',
    displayOrder: 'display_order',
    includedLogoCount: 'included_logo_count',
    logoPosition: 'logo_position',
    freeDelivery: 'free_delivery',
  };
  for (const [key, column] of Object.entries(mappings)) {
    if (!Object.hasOwn(validation.value, key)) continue;
    values.push(validation.value[key]);
    fields.push(`${column} = $${values.length}`);
  }
  if (Object.hasOwn(validation.value, 'includedDecorationMethods')) {
    values.push(JSON.stringify(validation.value.includedDecorationMethods));
    fields.push(`included_decoration_methods = $${values.length}::jsonb`);
  }
  if (Object.hasOwn(validation.value, 'freeGift')) {
    values.push(validation.value.freeGift == null ? null : JSON.stringify(validation.value.freeGift));
    fields.push(`free_gift = $${values.length}::jsonb`);
  }
  if (!fields.length) return { valid: false, errors: ['No supported fields were supplied'] };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT status FROM bundles WHERE id = $1 FOR UPDATE', [bundleId]);
    if (!currentResult.rows.length || currentResult.rows[0].status === 'archived') {
      await client.query('ROLLBACK');
      return { valid: false, notFound: true, errors: ['Bundle not found or archived'] };
    }
    if (
      currentResult.rows[0].status === 'active'
      && [
        'priceExVat',
        'slug',
        'includedDecorationMethods',
        'includedLogoCount',
        'logoPosition',
        'freeDelivery',
        'freeGift',
      ].some(field => Object.hasOwn(validation.value, field))
    ) {
      await client.query('ROLLBACK');
      return { valid: false, errors: ['Unpublish the bundle before changing its price, slug or included benefits'] };
    }
    values.push(Number(bundleId));
    const result = await client.query(`
      UPDATE bundles SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${values.length}
      RETURNING id
    `, values);
    await addAudit(client, bundleId, adminUserId, 'updated', validation.value);
    await client.query('COMMIT');
    return { valid: true, bundle: await getBundle(bundleId, { admin: true }) };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return { valid: false, errors: ['slug already exists'] };
    throw error;
  } finally {
    client.release();
  }
}

async function updateBundleComponents(bundleId, components, adminUserId) {
  await ensureBundleApiSchema();
  const validation = validateComponentsInput(components);
  if (!validation.valid) return validation;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockResult = await client.query('SELECT id, status FROM bundles WHERE id = $1 FOR UPDATE', [bundleId]);
    if (!lockResult.rows.length) {
      await client.query('ROLLBACK');
      return { valid: false, notFound: true, errors: ['Bundle not found'] };
    }
    if (lockResult.rows[0].status === 'active') {
      await client.query('ROLLBACK');
      return { valid: false, errors: ['Unpublish the bundle before changing components'] };
    }
    const resolved = await replaceComponents(client, bundleId, validation.value);
    const totalItemQuantity = resolved.reduce((sum, component) => sum + component.quantity, 0);
    const missingCodes = resolved.filter(component => !component.linked).map(component => component.styleCode);
    await client.query(`
      UPDATE bundles SET
        total_item_quantity = $2,
        catalogue_status = $3,
        pricing_status = $4,
        publish_block_reason = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [
      bundleId,
      totalItemQuantity,
      missingCodes.length ? 'missing_products' : 'complete',
      missingCodes.length ? 'unpriced' : 'pending_customization_review',
      missingCodes.length
        ? `Missing exact catalogue product(s): ${missingCodes.join(', ')}`
        : 'Customization and pricing approval required.',
    ]);
    await addAudit(client, bundleId, adminUserId, 'components_replaced', { components: validation.value });
    await client.query('COMMIT');
    return { valid: true, bundle: await getBundle(bundleId, { admin: true }) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setPricingStatus(bundleId, pricingStatus, adminUserId) {
  await ensureBundleApiSchema();
  if (!PRICING_STATUSES.has(pricingStatus)) return { valid: false, errors: ['Invalid pricing status'] };
  if (pricingStatus === 'approved') {
    const bundle = await getBundle(bundleId, { admin: true });
    if (!bundle) return { valid: false, notFound: true, errors: ['Bundle not found'] };
    if (bundle.catalogueStatus !== 'complete') return { valid: false, errors: ['Missing catalogue products must be resolved first'] };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT status FROM bundles WHERE id = $1 FOR UPDATE', [bundleId]);
    if (!currentResult.rows.length || currentResult.rows[0].status === 'archived') {
      await client.query('ROLLBACK');
      return { valid: false, notFound: true, errors: ['Bundle not found or archived'] };
    }
    if (currentResult.rows[0].status === 'active' && pricingStatus !== 'approved') {
      await client.query('ROLLBACK');
      return { valid: false, errors: ['Unpublish the bundle before changing its pricing approval'] };
    }
    const reason = pricingStatus === 'approved' ? null : 'Pricing requires review before publishing.';
    const result = await client.query(`
      UPDATE bundles SET pricing_status = $2, publish_block_reason = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id
    `, [bundleId, pricingStatus, reason]);
    await addAudit(client, bundleId, adminUserId, 'pricing_status_changed', { pricingStatus });
    await client.query('COMMIT');
    return { valid: true, bundle: await getBundle(bundleId, { admin: true }) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function changeBundleStatus(bundleId, targetStatus, adminUserId) {
  await ensureBundleApiSchema();
  if (!BUNDLE_STATUSES.has(targetStatus)) return { valid: false, errors: ['Invalid bundle status'] };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bundleResult = await client.query('SELECT * FROM bundles WHERE id = $1 FOR UPDATE', [bundleId]);
    if (!bundleResult.rows.length) {
      await client.query('ROLLBACK');
      return { valid: false, notFound: true, errors: ['Bundle not found'] };
    }
    const validationResult = await client.query(`
      SELECT
        COUNT(*)::integer AS component_count,
        COUNT(*) FILTER (WHERE component_status <> 'linked')::integer AS invalid_components,
        COUNT(*) FILTER (
          WHERE catalogue_style_code IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM products product
              WHERE product.style_code = bundle_components.catalogue_style_code AND product.sku_status = 'Live'
            )
        )::integer AS components_without_live_skus
      FROM bundle_components
      WHERE bundle_id = $1
    `, [bundleId]);
    const bundle = bundleResult.rows[0];
    const validation = validationResult.rows[0];
    const errors = [];
    if (targetStatus === 'active') {
      if (bundle.catalogue_status !== 'complete') errors.push('Catalogue products are incomplete');
      if (bundle.pricing_status !== 'approved') errors.push('Pricing must be approved');
      if (validation.component_count < 1) errors.push('At least one component is required');
      if (validation.invalid_components > 0) errors.push('Every component must be linked');
      if (validation.components_without_live_skus > 0) errors.push('Every component needs a live SKU');
    }
    if (errors.length) {
      await client.query('ROLLBACK');
      return { valid: false, errors };
    }
    await client.query(`
      UPDATE bundles SET status = $2, publish_block_reason = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [bundleId, targetStatus, targetStatus === 'active' ? null : bundle.publish_block_reason]);
    await addAudit(client, bundleId, adminUserId, `status_changed_to_${targetStatus}`);
    await client.query('COMMIT');
    return { valid: true, bundle: await getBundle(bundleId, { admin: true }) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getBundleAudit(bundleId) {
  await ensureBundleApiSchema();
  const result = await queryWithTimeout(`
    SELECT audit.id, audit.action, audit.changes, audit.created_at,
      customer.name AS admin_name, customer.email AS admin_email
    FROM bundle_admin_audit audit
    LEFT JOIN customer_users customer ON customer.id = audit.admin_user_id
    WHERE audit.bundle_id = $1
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT 200
  `, [bundleId], 10000);
  return result.rows;
}

module.exports = {
  changeBundleStatus,
  createBundle,
  getBundle,
  getBundleAudit,
  getComponentOptions,
  listBundles,
  setPricingStatus,
  updateBundle,
  updateBundleComponents,
  validateBundleInput,
  validateBundleSelection,
  validateComponentsInput,
  validateSelectionInput,
};
