const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, closePool } = require('../config/database');

const SOURCE_KEY = 'gocustom-2026-11-09';
const SOURCE_DATE = '2026-11-09';
const DEFAULT_SOURCE = path.join(__dirname, 'data', 'gocustom-bundles-2026-11-09.json');
const MIGRATION = path.join(__dirname, 'migrations', '003_fixed_bundles.sql');
const BENEFITS_SOURCE = path.join(__dirname, 'data', 'gocustom-bundle-benefits-2026-11-09.json');
const BENEFITS_MIGRATION = path.join(__dirname, 'migrations', '006_fixed_bundle_benefits.sql');

const STYLE_ALIASES = Object.freeze({
  HVW100: 'YK001',
  STSU168: 'SX789',
  STAU760: 'SX061',
  STTU170: 'SX236',
  STTU976: 'SX236',
  STAU117: 'SX762',
  T706: 'PW470',
  STTU169: 'SX701',
});

const MISSING_COMPONENTS = Object.freeze({
  13: [{ quantity: 12, requestedCode: 'B309' }],
  16: [{ quantity: 24, requestedCode: 'AS5001' }],
  25: [{ quantity: 3, requestedCode: 'B309' }],
  28: [{ quantity: 50, requestedCode: 'AS5001' }],
  35: [{ quantity: 6, requestedCode: 'DX412' }],
  36: [{ quantity: 6, requestedCode: 'LW72' }],
  38: [{ quantity: 6, requestedCode: 'T710' }],
});

function parseArguments(argv) {
  const fileArgument = argv.find(argument => argument.startsWith('--file='));
  return {
    sourcePath: path.resolve(fileArgument ? fileArgument.slice('--file='.length) : DEFAULT_SOURCE),
    dryRun: argv.includes('--dry-run'),
  };
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 170);
}

function normalizeComponent(component) {
  const requestedCode = String(component.requestedCode || component.code || '').trim().toUpperCase();
  if (!requestedCode) throw new Error('Bundle component is missing a product code');

  return {
    quantity: Number(component.quantity),
    requestedCode,
    canonicalCode: STYLE_ALIASES[requestedCode] || requestedCode,
    sourceUnitCost: component.documentUnitCost == null ? null : Number(component.documentUnitCost),
  };
}

function normalizeDeal(deal) {
  const sourceNumber = Number(deal.sourceNumber || deal.number);
  const rawComponents = Array.isArray(deal.components)
    ? deal.components
    : Array.isArray(deal.compositions)
      ? deal.compositions
      : [];
  const components = (rawComponents.length ? rawComponents : MISSING_COMPONENTS[sourceNumber] || [])
    .map(normalizeComponent);

  if (!Number.isInteger(sourceNumber) || sourceNumber < 1) {
    throw new Error(`Invalid source bundle number: ${deal.sourceNumber || deal.number}`);
  }
  if (!components.length) throw new Error(`Bundle ${sourceNumber} has no components`);

  const totalItemQuantity = components.reduce((total, component) => total + component.quantity, 0);
  const statedQuantity = Number(deal.quantity || totalItemQuantity);
  if (statedQuantity !== totalItemQuantity) {
    throw new Error(`Bundle ${sourceNumber} quantity mismatch: stated ${statedQuantity}, components ${totalItemQuantity}`);
  }

  return {
    sourceNumber,
    name: String(deal.title || deal.name || '').trim(),
    slug: `gocustom-${sourceNumber}-${slugify(deal.title || deal.name)}`,
    priceExVat: Number(deal.priceExVat ?? deal.brandedExVat),
    competitorPriceExVat: deal.competitorExVat == null ? null : Number(deal.competitorExVat),
    documentStatus: String(deal.documentStatus || deal.status || '').trim() || null,
    sourceProductText: deal.sourceProductText || null,
    totalItemQuantity,
    components,
  };
}

function loadDeals(sourcePath) {
  const sourceBuffer = fs.readFileSync(sourcePath);
  const parsed = JSON.parse(sourceBuffer.toString('utf8'));
  const rawDeals = Array.isArray(parsed) ? parsed : parsed.deals;
  if (!Array.isArray(rawDeals)) throw new Error('Bundle source must be an array or contain a deals array');

  const benefits = JSON.parse(fs.readFileSync(BENEFITS_SOURCE, 'utf8'));
  const benefitsByNumber = new Map(benefits.map(benefit => [benefit.sourceNumber, benefit]));
  const deals = rawDeals.map(normalizeDeal).map(deal => ({
    ...deal,
    benefits: benefitsByNumber.get(deal.sourceNumber),
  })).sort((left, right) => left.sourceNumber - right.sourceNumber);
  const sourceNumbers = new Set(deals.map(deal => deal.sourceNumber));
  if (sourceNumbers.size !== deals.length) throw new Error('Bundle source contains duplicate source numbers');
  if (deals.length !== 94) throw new Error(`Expected 94 bundles, received ${deals.length}`);
  if (deals.some(deal => !deal.benefits)) throw new Error('Bundle benefit data is incomplete');

  return {
    deals,
    sourceHash: crypto.createHash('sha256').update(sourceBuffer).digest('hex'),
  };
}

async function loadCatalogue(client, styleCodes) {
  const result = await client.query(`
    SELECT
      s.style_code,
      COUNT(*) FILTER (WHERE p.sku_status = 'Live')::integer AS live_skus,
      MIN(COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.pack_price, 0), NULLIF(p.single_price, 0)))
        FILTER (WHERE p.sku_status = 'Live') AS min_carton_price,
      MAX(COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.pack_price, 0), NULLIF(p.single_price, 0)))
        FILTER (WHERE p.sku_status = 'Live') AS max_carton_price
    FROM styles s
    LEFT JOIN products p ON p.style_code = s.style_code
    WHERE s.style_code = ANY($1::text[])
    GROUP BY s.style_code
  `, [styleCodes]);

  return new Map(result.rows.map(row => [row.style_code, row]));
}

function classifyBundle(deal, resolvedComponents) {
  const missingCodes = resolvedComponents
    .filter(component => component.componentStatus === 'missing_product')
    .map(component => component.requestedCode);

  if (missingCodes.length) {
    return {
      catalogueStatus: 'missing_products',
      pricingStatus: 'unpriced',
      publishBlockReason: `Missing exact catalogue product(s): ${missingCodes.join(', ')}`,
    };
  }

  if (resolvedComponents.some(component => component.requestedCode === 'BC640')) {
    return {
      catalogueStatus: 'complete',
      pricingStatus: 'cost_review',
      publishBlockReason: 'Confirm whether BC640 bundle cost is GBP 2.02 or the current database cost before publishing.',
    };
  }

  if (deal.documentStatus === 'unsafe') {
    return {
      catalogueStatus: 'complete',
      pricingStatus: 'margin_review',
      publishBlockReason: 'Garment margin needs review before customization costs are added.',
    };
  }

  return {
    catalogueStatus: 'complete',
    pricingStatus: 'pending_customization_review',
    publishBlockReason: 'Customization, labour and fulfilment costs are not configured yet.',
  };
}

async function upsertBundle(client, deal, classification, sourceHash) {
  const result = await client.query(`
    INSERT INTO bundles (
      bundle_type, source_key, source_bundle_number, slug, name, price_ex_vat, currency,
      status, catalogue_status, pricing_status, source_document_status, total_item_quantity,
      competitor_price_ex_vat, publish_block_reason, source_product_text, source_metadata,
      included_decoration_methods, included_logo_count, logo_position, free_delivery,
      free_gift, source_include_text
    )
    VALUES (
      'fixed', $1, $2, $3, $4, $5, 'GBP', 'draft', $6, $7, $8, $9, $10, $11, $12,
      jsonb_build_object('source_date', $13::text, 'source_hash', $14::text),
      $15::jsonb, $16, $17, $18, $19::jsonb, $20
    )
    ON CONFLICT (source_key, source_bundle_number) DO UPDATE SET
      slug = EXCLUDED.slug,
      name = EXCLUDED.name,
      price_ex_vat = EXCLUDED.price_ex_vat,
      catalogue_status = EXCLUDED.catalogue_status,
      pricing_status = EXCLUDED.pricing_status,
      source_document_status = EXCLUDED.source_document_status,
      total_item_quantity = EXCLUDED.total_item_quantity,
      competitor_price_ex_vat = EXCLUDED.competitor_price_ex_vat,
      publish_block_reason = EXCLUDED.publish_block_reason,
      source_product_text = EXCLUDED.source_product_text,
      source_metadata = EXCLUDED.source_metadata,
      included_decoration_methods = EXCLUDED.included_decoration_methods,
      included_logo_count = EXCLUDED.included_logo_count,
      logo_position = EXCLUDED.logo_position,
      free_delivery = EXCLUDED.free_delivery,
      free_gift = EXCLUDED.free_gift,
      source_include_text = EXCLUDED.source_include_text,
      status = 'draft',
      updated_at = CURRENT_TIMESTAMP
    WHERE bundles.status <> 'active'
    RETURNING id
  `, [
    SOURCE_KEY,
    deal.sourceNumber,
    deal.slug,
    deal.name,
    deal.priceExVat,
    classification.catalogueStatus,
    classification.pricingStatus,
    deal.documentStatus,
    deal.totalItemQuantity,
    deal.competitorPriceExVat,
    classification.publishBlockReason,
    deal.sourceProductText,
    SOURCE_DATE,
    sourceHash,
    JSON.stringify(deal.benefits.includedDecorationMethods),
    deal.benefits.includedLogoCount,
    deal.benefits.logoPosition,
    deal.benefits.freeDelivery,
    deal.benefits.freeGift == null ? null : JSON.stringify(deal.benefits.freeGift),
    deal.benefits.sourceIncludeText,
  ]);
  if (!result.rows[0]) {
    throw new Error(`Refusing to overwrite active bundle ${deal.sourceNumber}`);
  }
  return result.rows[0].id;
}

async function importDeals(sourcePath, dryRun = false) {
  const { deals, sourceHash } = loadDeals(sourcePath);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(MIGRATION, 'utf8'));
    await client.query(fs.readFileSync(BENEFITS_MIGRATION, 'utf8'));

    const styleCodes = [...new Set(deals.flatMap(deal => deal.components.map(component => component.canonicalCode)))];
    const catalogue = await loadCatalogue(client, styleCodes);
    let linkedComponents = 0;
    let missingComponents = 0;

    for (const deal of deals) {
      const components = deal.components.map(component => {
        const catalogueEntry = catalogue.get(component.canonicalCode);
        const linked = catalogueEntry && catalogueEntry.live_skus > 0;
        if (linked) linkedComponents += 1;
        else missingComponents += 1;
        return {
          ...component,
          catalogueStyleCode: linked ? component.canonicalCode : null,
          componentStatus: linked ? 'linked' : 'missing_product',
          minCartonPrice: catalogueEntry?.min_carton_price ?? null,
          maxCartonPrice: catalogueEntry?.max_carton_price ?? null,
        };
      });
      const classification = classifyBundle(deal, components);
      const bundleId = await upsertBundle(client, deal, classification, sourceHash);

      await client.query('DELETE FROM bundle_components WHERE bundle_id = $1', [bundleId]);
      for (const [index, component] of components.entries()) {
        await client.query(`
          INSERT INTO bundle_components (
            bundle_id, line_order, requested_style_code, catalogue_style_code, quantity,
            source_unit_cost, observed_min_carton_price, observed_max_carton_price,
            component_status, source_metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
            jsonb_build_object('canonical_code', $10::text))
        `, [
          bundleId,
          index + 1,
          component.requestedCode,
          component.catalogueStyleCode,
          component.quantity,
          component.sourceUnitCost,
          component.minCartonPrice,
          component.maxCartonPrice,
          component.componentStatus,
          component.canonicalCode,
        ]);
      }
    }

    const summary = await client.query(`
      SELECT
        COUNT(*)::integer AS bundles,
        COUNT(*) FILTER (WHERE catalogue_status = 'missing_products')::integer AS missing_product_bundles,
        COUNT(*) FILTER (WHERE pricing_status = 'margin_review')::integer AS margin_review_bundles,
        COUNT(*) FILTER (WHERE pricing_status = 'cost_review')::integer AS cost_review_bundles,
        COUNT(*) FILTER (WHERE status = 'active')::integer AS active_bundles
      FROM bundles
      WHERE source_key = $1
    `, [SOURCE_KEY]);

    if (dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');

    return {
      mode: dryRun ? 'dry-run' : 'applied',
      sourcePath,
      sourceHash,
      ...summary.rows[0],
      linkedComponents,
      missingComponents,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const { sourcePath, dryRun } = parseArguments(process.argv.slice(2));
  importDeals(sourcePath, dryRun)
    .then(summary => console.log(JSON.stringify(summary, null, 2)))
    .catch(error => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

module.exports = {
  classifyBundle,
  loadDeals,
  normalizeDeal,
};
