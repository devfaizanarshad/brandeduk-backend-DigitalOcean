const fs = require('fs');
const path = require('path');

const API_BASE = String(process.env.CUSTOMIZATION_API_BASE || 'https://api.brandeduk.com')
  .replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const PRODUCT_TYPE_SLUG = 'bags';
const TEMPLATES_ROOT = path.join(__dirname, '..', 'customization-garments-tamplates');
const MANIFEST_PATH = path.join(TEMPLATES_ROOT, 'manifest.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${context}: invalid JSON response (${response.status})`);
  }
  if (!response.ok || body.success === false) {
    throw new Error(`${context}: HTTP ${response.status}: ${body.message || text.slice(0, 300)}`);
  }
  return body.data || body;
}

function configUrl(subtypeKey = '', admin = true) {
  const prefix = admin
    ? '/api/admin/customization/templates'
    : '/api/customization-config';
  const url = new URL(`${API_BASE}${prefix}/${PRODUCT_TYPE_SLUG}`);
  if (subtypeKey) url.searchParams.set('subtype', subtypeKey);
  return url;
}

async function getConfig(subtypeKey = '', admin = true) {
  const response = await fetch(configUrl(subtypeKey, admin));
  return readJsonResponse(response, `Fetch ${PRODUCT_TYPE_SLUG}/${subtypeKey || 'default'}`);
}

async function uploadImage(subtypeKey, viewSlug, filePath) {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('productTypeSlug', PRODUCT_TYPE_SLUG);
  form.append('subtypeKey', subtypeKey);
  form.append('viewSlug', viewSlug);
  form.append('image', new Blob([bytes], { type: 'image/png' }), `${viewSlug}.png`);

  const response = await fetch(
    `${API_BASE}/api/admin/customization-config/upload-image`,
    { method: 'POST', body: form },
  );
  const uploaded = await readJsonResponse(response, `Upload ${subtypeKey}/${viewSlug}`);
  assert(uploaded.imageUrl, `Upload ${subtypeKey}/${viewSlug} returned no image URL`);
  return uploaded.imageUrl;
}

async function saveConfig(subtypeKey, positions) {
  const response = await fetch(configUrl(subtypeKey), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subtypeKey, positions }),
  });
  return readJsonResponse(response, `Save ${PRODUCT_TYPE_SLUG}/${subtypeKey}`);
}

async function deleteConfig(subtypeKey) {
  const response = await fetch(configUrl(subtypeKey), { method: 'DELETE' });
  return readJsonResponse(response, `Delete ${PRODUCT_TYPE_SLUG}/${subtypeKey}`);
}

function loadVariants() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const bags = manifest.templates.find(
    template => template.productTypeSlug === PRODUCT_TYPE_SLUG,
  );
  assert(bags?.variants && typeof bags.variants === 'object', 'Bag variants are missing');

  return Object.entries(bags.variants).map(([subtypeKey, variant]) => {
    const views = Object.entries(variant.views || {}).map(([viewSlug, relativePath]) => {
      const filePath = path.join(TEMPLATES_ROOT, relativePath);
      assert(fs.existsSync(filePath), `Missing ${subtypeKey}/${viewSlug}: ${filePath}`);
      const bytes = fs.readFileSync(filePath);
      assert(
        bytes.length >= 8
          && bytes.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          ),
        `Invalid PNG: ${filePath}`,
      );
      return { viewSlug, filePath };
    });
    assert(views.length > 0, `Bag variant ${subtypeKey} has no views`);
    return { subtypeKey, views };
  });
}

function clonePositionsWithImages(defaultConfig, uploadedImages) {
  return defaultConfig.positions.map((position, index) => ({
    ...position,
    imageUrl: uploadedImages[position.slug] || position.imageUrl,
    sortOrder: position.sortOrder ?? index,
  }));
}

async function main() {
  const variants = loadVariants();
  const imageCount = variants.reduce((total, variant) => total + variant.views.length, 0);
  assert(variants.length === 4, `Expected 4 bag variants, found ${variants.length}`);
  assert(imageCount === 4, `Expected 4 bag variant images, found ${imageCount}`);

  const defaultConfig = await getConfig();
  assert(
    Array.isArray(defaultConfig.positions) && defaultConfig.positions.length > 0,
    'The default bags configuration has no positions to copy',
  );
  const capabilityProbe = await getConfig(variants[0].subtypeKey);
  const backendSupportsSubtypes = Object.prototype.hasOwnProperty.call(
    capabilityProbe,
    'isSubtypeFallback',
  );
  console.log(`PREFLIGHT_OK variants=${variants.length} images=${imageCount}`);

  if (!APPLY) {
    console.log(
      backendSupportsSubtypes
        ? 'DRY_RUN_COMPLETE Backend supports subtypes; pass --apply to seed them.'
        : 'DRY_RUN_COMPLETE BACKEND_NOT_READY deploy the subtype-aware backend before --apply.',
    );
    return;
  }

  assert(
    backendSupportsSubtypes,
    'The deployed API does not support customization subtypes yet. Deploy the backend first.',
  );

  const existing = {};
  for (const variant of variants) {
    const config = await getConfig(variant.subtypeKey);
    existing[variant.subtypeKey] = config.isSubtypeFallback ? null : config;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(
    BACKUP_DIR,
    `bag-variants-before-seed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(
    backupPath,
    `${JSON.stringify({ createdAt: new Date().toISOString(), apiBase: API_BASE, existing }, null, 2)}\n`,
  );
  console.log(`BACKUP_SAVED ${backupPath}`);

  const updated = [];
  try {
    for (const variant of variants) {
      const uploadedImages = {};
      for (const view of variant.views) {
        uploadedImages[view.viewSlug] = await uploadImage(
          variant.subtypeKey,
          view.viewSlug,
          view.filePath,
        );
      }
      const saved = await saveConfig(
        variant.subtypeKey,
        clonePositionsWithImages(defaultConfig, uploadedImages),
      );
      assert(saved.subtypeKey === variant.subtypeKey, `${variant.subtypeKey} saved as wrong subtype`);
      updated.push(variant.subtypeKey);
      console.log(`SAVED ${variant.subtypeKey}`);
    }
  } catch (error) {
    console.error(`SEED_FAILED ${error.message}`);
    for (const subtypeKey of updated.reverse()) {
      const prior = existing[subtypeKey];
      if (prior) {
        await saveConfig(subtypeKey, prior.positions);
      } else {
        await deleteConfig(subtypeKey);
      }
      console.error(`ROLLED_BACK ${subtypeKey}`);
    }
    throw error;
  }

  for (const variant of variants) {
    const publicConfig = await getConfig(variant.subtypeKey, false);
    assert(
      publicConfig.subtypeKey === variant.subtypeKey && !publicConfig.isSubtypeFallback,
      `${variant.subtypeKey} public API did not return its own configuration`,
    );
    assert(
      publicConfig.positions.length === variant.views.length,
      `${variant.subtypeKey} position count mismatch`,
    );
    console.log(`PUBLIC_VERIFIED ${variant.subtypeKey}`);
  }

  console.log(`SEED_COMPLETE variants=${variants.length} images=${imageCount}`);
  console.log(`ROLLBACK_BACKUP ${backupPath}`);
}

main().catch(error => {
  console.error(`FATAL ${error.stack || error.message}`);
  process.exitCode = 1;
});
