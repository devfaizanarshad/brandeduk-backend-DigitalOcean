const fs = require('fs');
const path = require('path');
const { pool, queryWithTimeout } = require('../config/database');
const { validateBundleInput, validateComponentsInput } = require('./fixedBundleService');

const MIGRATIONS = [
  path.join(__dirname, '..', 'maintenance', 'migrations', '005_fixed_bundle_bulk_api.sql'),
  path.join(__dirname, '..', 'maintenance', 'migrations', '006_fixed_bundle_benefits.sql'),
];
const MAX_BULK_BUNDLES = 100;
let schemaPromise;

function ensureBulkSchema() {
  if (!schemaPromise) {
    schemaPromise = queryWithTimeout(MIGRATIONS.map(file => fs.readFileSync(file, 'utf8')).join('\n'), [], 30000)
      .catch(error => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

function normalizeReference(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function validateBulkPayload(input) {
  const bundles = input?.bundles;
  if (!Array.isArray(bundles) || bundles.length === 0) {
    return { valid: false, errors: ['bundles must be a non-empty array'], bundles: [] };
  }
  if (bundles.length > MAX_BULK_BUNDLES) {
    return { valid: false, errors: [`A maximum of ${MAX_BULK_BUNDLES} bundles is allowed per request`], bundles: [] };
  }

  const errors = [];
  const references = new Set();
  const slugs = new Set();
  const normalized = bundles.map((bundle, index) => {
    const reference = normalizeReference(bundle.reference);
    const bundleValidation = validateBundleInput(bundle);
    const componentValidation = validateComponentsInput(bundle.components);
    if (!reference) errors.push(`bundles[${index}].reference is required`);
    if (reference && references.has(reference)) errors.push(`bundles[${index}].reference is duplicated`);
    references.add(reference);
    if (bundleValidation.value.slug && slugs.has(bundleValidation.value.slug)) errors.push(`bundles[${index}].slug is duplicated`);
    if (bundleValidation.value.slug) slugs.add(bundleValidation.value.slug);
    errors.push(...bundleValidation.errors.map(error => `bundles[${index}].${error}`));
    errors.push(...componentValidation.errors.map(error => `bundles[${index}].${error}`));
    return {
      reference,
      ...bundleValidation.value,
      components: componentValidation.value,
    };
  });

  return { valid: errors.length === 0, errors, bundles: normalized };
}

async function inspectBulkBundles(client, bundles) {
  const references = bundles.map(bundle => bundle.reference);
  const styleCodes = [...new Set(bundles.flatMap(bundle => bundle.components.map(component => component.styleCode)))];
  const slugs = bundles.map(bundle => bundle.slug).filter(Boolean);
  const [existingResult, catalogueResult, slugResult] = await Promise.all([
    client.query(`
      SELECT id, external_reference, slug, status
      FROM bundles
      WHERE external_reference = ANY($1::text[])
    `, [references]),
    client.query(`
      SELECT style.style_code, COUNT(product.id) FILTER (WHERE product.sku_status = 'Live')::integer AS live_skus
      FROM styles style
      LEFT JOIN products product ON product.style_code = style.style_code
      WHERE style.style_code = ANY($1::text[])
      GROUP BY style.style_code
    `, [styleCodes]),
    slugs.length ? client.query(`
      SELECT id, slug, external_reference
      FROM bundles
      WHERE slug = ANY($1::text[])
    `, [slugs]) : { rows: [] },
  ]);

  const existing = new Map(existingResult.rows.map(row => [row.external_reference, row]));
  const liveStyles = new Map(catalogueResult.rows.map(row => [row.style_code, Number(row.live_skus)]));
  const slugOwners = new Map(slugResult.rows.map(row => [row.slug, row]));

  return bundles.map(bundle => {
    const current = existing.get(bundle.reference);
    const missingStyleCodes = bundle.components
      .filter(component => !liveStyles.get(component.styleCode))
      .map(component => component.styleCode);
    const slugOwner = bundle.slug ? slugOwners.get(bundle.slug) : null;
    const errors = [];
    if (current?.status === 'active') errors.push('Unpublish this bundle before bulk updating it');
    if (current?.status === 'archived') errors.push('Archived bundles cannot be bulk updated');
    if (slugOwner && slugOwner.external_reference !== bundle.reference) errors.push(`Slug is already used by bundle ${slugOwner.id}`);
    if (missingStyleCodes.length) errors.push(`Unknown or unavailable product codes: ${missingStyleCodes.join(', ')}`);
    return {
      reference: bundle.reference,
      action: current ? 'update' : 'create',
      bundleId: current ? Number(current.id) : null,
      valid: errors.length === 0,
      errors,
      missingStyleCodes,
    };
  });
}

async function validateBulkBundles(input) {
  await ensureBulkSchema();
  const parsed = validateBulkPayload(input);
  if (!parsed.valid) return { valid: false, errors: parsed.errors, results: [] };
  const client = await pool.connect();
  try {
    const results = await inspectBulkBundles(client, parsed.bundles);
    return {
      valid: results.every(result => result.valid),
      errors: results.flatMap(result => result.errors.map(error => `${result.reference}: ${error}`)),
      results,
      normalizedBundles: parsed.bundles,
    };
  } finally {
    client.release();
  }
}

async function upsertBulkBundles(input, adminUserId) {
  await ensureBulkSchema();
  const parsed = validateBulkPayload(input);
  if (!parsed.valid) return { valid: false, errors: parsed.errors, results: [] };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const inspection = await inspectBulkBundles(client, parsed.bundles);
    const inspectionErrors = inspection.flatMap(result => result.errors.map(error => `${result.reference}: ${error}`));
    if (inspectionErrors.length) {
      await client.query('ROLLBACK');
      return { valid: false, errors: inspectionErrors, results: inspection };
    }

    const results = [];
    for (const bundle of parsed.bundles) {
      const current = inspection.find(result => result.reference === bundle.reference);
      const totalItemQuantity = bundle.components.reduce((sum, component) => sum + component.quantity, 0);
      let bundleId;

      if (current.action === 'create') {
        const result = await client.query(`
          INSERT INTO bundles (
            bundle_type, source_key, source_bundle_number, external_reference, slug,
            name, description, price_ex_vat, currency, status, catalogue_status,
            pricing_status, total_item_quantity, publish_block_reason,
            featured_image_url, is_featured, display_order, included_decoration_methods,
            included_logo_count, logo_position, free_delivery, free_gift
          ) VALUES (
            'fixed', $1, 1, $2, $3, $4, $5, $6, 'GBP', 'draft', 'complete',
            'pending_customization_review', $7, 'Customization and pricing approval required.',
            $8, $9, $10, $11::jsonb, $12, $13, $14, $15::jsonb
          ) RETURNING id
        `, [
          `bulk:${bundle.reference}`,
          bundle.reference,
          bundle.slug || bundle.reference,
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
        bundleId = result.rows[0].id;
      } else {
        bundleId = current.bundleId;
        await client.query(`
          UPDATE bundles SET
            slug = COALESCE($2, slug),
            name = $3,
            description = $4,
            price_ex_vat = $5,
            status = 'draft',
            catalogue_status = 'complete',
            pricing_status = 'pending_customization_review',
            total_item_quantity = $6,
            publish_block_reason = 'Customization and pricing approval required.',
            featured_image_url = $7,
            is_featured = $8,
            display_order = $9,
            included_decoration_methods = $10::jsonb,
            included_logo_count = $11,
            logo_position = $12,
            free_delivery = $13,
            free_gift = $14::jsonb,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [
          bundleId,
          bundle.slug || null,
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
        await client.query('DELETE FROM bundle_components WHERE bundle_id = $1', [bundleId]);
      }

      for (const [index, component] of bundle.components.entries()) {
        await client.query(`
          INSERT INTO bundle_components (
            bundle_id, line_order, requested_style_code, catalogue_style_code,
            quantity, component_status, source_metadata
          ) VALUES ($1, $2, $3, $3, $4, 'linked', jsonb_build_object('source', 'bulk-api'))
        `, [bundleId, index + 1, component.styleCode, component.quantity]);
      }
      await client.query(`
        INSERT INTO bundle_admin_audit (bundle_id, admin_user_id, action, changes)
        VALUES ($1, $2, $3, $4::jsonb)
      `, [
        bundleId,
        adminUserId || null,
        current.action === 'create' ? 'bulk_created' : 'bulk_updated',
        JSON.stringify({ reference: bundle.reference, components: bundle.components.length }),
      ]);
      results.push({ reference: bundle.reference, action: current.action, bundleId: Number(bundleId), valid: true });
    }

    await client.query('COMMIT');
    return {
      valid: true,
      created: results.filter(result => result.action === 'create').length,
      updated: results.filter(result => result.action === 'update').length,
      results,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return { valid: false, errors: ['A reference or slug already exists'], results: [] };
    throw error;
  } finally {
    client.release();
  }
}

function getBulkTemplate() {
  return {
    bundles: [{
      reference: 'starter-polo-10',
      name: '10 Polo Shirt Starter Bundle',
      slug: '10-polo-shirt-starter-bundle',
      description: 'A simple fixed bundle.',
      priceExVat: 99.99,
      featuredImageUrl: null,
      isFeatured: false,
      displayOrder: 0,
      includedDecorationMethods: ['print'],
      includedLogoCount: 1,
      logoPosition: null,
      freeDelivery: true,
      freeGift: null,
      components: [{ styleCode: 'UC101', quantity: 10 }],
    }],
  };
}

module.exports = {
  getBulkTemplate,
  normalizeReference,
  upsertBulkBundles,
  validateBulkBundles,
  validateBulkPayload,
};
