const fs = require('fs');
const path = require('path');

require('dotenv').config();

const {
  getCustomizationConfigByProductTypeSlug,
  normalizeSlug,
  saveCustomizationConfig,
} = require('../services/customizationConfigService');

const APPLY = process.argv.includes('--apply');
const MANIFEST_PATH = path.join(__dirname, 'new-category-templates.json');
const ASSET_ROOT = path.join(__dirname, '..', 'assets', 'customization', 'new-categories');
const apiBase = String(process.env.API_PUBLIC_URL || 'https://api.brandeduk.com').replace(/\/+$/, '');
const IMAGE_BASE_URL = `${apiBase}/assets/customization/new-categories`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readManifest() {
  const source = fs.readFileSync(MANIFEST_PATH, 'utf8').replace(/^\uFEFF/, '');
  const manifest = JSON.parse(source);
  const templates = Array.isArray(manifest.templates) ? manifest.templates : [];
  assert(templates.length === 64, `Expected 64 new category templates, found ${templates.length}`);

  const slugs = new Set();
  return templates.map((template, index) => {
    const productTypeSlug = normalizeSlug(template.productTypeSlug);
    const position = String(template.position || '').trim();
    const image = path.basename(String(template.image || ''));
    assert(productTypeSlug, `Template ${index + 1} has no product type slug`);
    assert(position, `Template ${productTypeSlug} has no position label`);
    assert(image && image.endsWith('.webp'), `Template ${productTypeSlug} has an invalid image`);
    assert(!slugs.has(productTypeSlug), `Duplicate product type slug: ${productTypeSlug}`);
    slugs.add(productTypeSlug);

    const assetPath = path.join(ASSET_ROOT, image);
    assert(fs.existsSync(assetPath), `Missing asset for ${productTypeSlug}: ${assetPath}`);
    assert(fs.statSync(assetPath).size > 0, `Empty asset for ${productTypeSlug}: ${assetPath}`);

    return {
      category: String(template.category || productTypeSlug),
      productTypeSlug,
      position,
      image,
    };
  });
}

function defaultMethods(positionLabel) {
  const largePlacement = /large|panel/i.test(positionLabel);
  const centrePlacement = /centre|center/i.test(positionLabel);

  return [
    {
      method: 'embroidery',
      priceType: largePlacement ? 'poa' : 'fixed',
      price: largePlacement ? null : 5,
      enabled: true,
    },
    {
      method: 'print',
      priceType: 'fixed',
      price: largePlacement ? 8 : (centrePlacement ? 6.5 : 3.5),
      enabled: true,
    },
  ];
}

function createPayload(template) {
  return {
    positions: [{
      slug: normalizeSlug(template.position, 'front'),
      label: template.position,
      imageUrl: `${IMAGE_BASE_URL}/${encodeURIComponent(template.image)}`,
      productImageType: 'reference',
      sortOrder: 0,
      isActive: true,
      methods: defaultMethods(template.position),
    }],
  };
}

async function main() {
  const templates = readManifest();
  const summary = { create: [], skipConfigured: [] };

  for (const template of templates) {
    const existing = await getCustomizationConfigByProductTypeSlug(template.productTypeSlug);
    assert(existing, `Unknown product type: ${template.productTypeSlug}`);

    if (existing.positions.length > 0) {
      summary.skipConfigured.push({
        ...template,
        positionCount: existing.positions.length,
      });
    } else {
      summary.create.push(template);
    }
  }

  console.log(`PREFLIGHT_OK templates=${templates.length} assets=${templates.length}`);
  for (const template of summary.skipConfigured) {
    console.log(`SKIP_CONFIGURED ${template.productTypeSlug} positions=${template.positionCount}`);
  }

  if (!APPLY) {
    console.log(`DRY_RUN_COMPLETE wouldCreate=${summary.create.length} skipConfigured=${summary.skipConfigured.length}`);
    return summary;
  }

  for (const template of summary.create) {
    const saved = await saveCustomizationConfig(template.productTypeSlug, createPayload(template));
    assert(saved.positions.length === 1, `Save verification failed for ${template.productTypeSlug}`);
    assert(saved.positions[0].imageUrl === `${IMAGE_BASE_URL}/${encodeURIComponent(template.image)}`,
      `Image URL verification failed for ${template.productTypeSlug}`);
    console.log(`CREATED ${template.productTypeSlug} position=${template.position}`);
  }

  console.log(`SEED_COMPLETE created=${summary.create.length} skipConfigured=${summary.skipConfigured.length}`);
  return summary;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`FATAL ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createPayload,
  defaultMethods,
  main,
  readManifest,
};
