const fs = require('fs');
const path = require('path');

const API_BASE = String(process.env.CUSTOMIZATION_API_BASE || 'https://api.brandeduk.com')
  .replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const INCLUDE_BAGS = process.argv.includes('--include-bags');
const PRODUCT_ARG = process.argv.find(argument => argument.startsWith('--product='));
const PRODUCT_FILTER = PRODUCT_ARG ? PRODUCT_ARG.slice('--product='.length).trim() : '';
const TEMPLATES_ROOT = path.join(__dirname, '..', 'customization-garments-tamplates');
const MANIFEST_PATH = path.join(TEMPLATES_ROOT, 'manifest.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_SAFE_UPLOAD_BYTES = 900 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.trim().replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`${context}: HTTP ${response.status}: ${preview || 'non-JSON response'}`);
  }
  if (!response.ok || body.success === false) {
    throw new Error(`${context}: HTTP ${response.status}: ${body.message || text.slice(0, 300)}`);
  }
  return body.data || body;
}

function configUrl(productTypeSlug, subtypeKey = '', admin = true) {
  const prefix = admin
    ? '/api/admin/customization/templates'
    : '/api/customization-config';
  const url = new URL(`${API_BASE}${prefix}/${productTypeSlug}`);
  if (subtypeKey) url.searchParams.set('subtype', subtypeKey);
  return url;
}

async function getConfig(productTypeSlug, subtypeKey = '', admin = true) {
  const response = await fetch(configUrl(productTypeSlug, subtypeKey, admin));
  return readJsonResponse(
    response,
    `Fetch ${productTypeSlug}/${subtypeKey || 'default'}`,
  );
}

async function uploadImage(productTypeSlug, subtypeKey, viewSlug, filePath) {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('productTypeSlug', productTypeSlug);
  form.append('subtypeKey', subtypeKey);
  form.append('viewSlug', viewSlug);
  form.append('image', new Blob([bytes], { type: 'image/png' }), `${viewSlug}.png`);

  const response = await fetch(
    `${API_BASE}/api/admin/customization-config/upload-image`,
    { method: 'POST', body: form },
  );
  const uploaded = await readJsonResponse(
    response,
    `Upload ${productTypeSlug}/${subtypeKey}/${viewSlug}`,
  );
  assert(uploaded.imageUrl, `${productTypeSlug}/${subtypeKey}/${viewSlug} returned no image URL`);
  return uploaded.imageUrl;
}

async function saveConfig(productTypeSlug, subtypeKey, positions) {
  const response = await fetch(configUrl(productTypeSlug, subtypeKey), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subtypeKey, positions }),
  });
  return readJsonResponse(response, `Save ${productTypeSlug}/${subtypeKey}`);
}

async function deleteConfig(productTypeSlug, subtypeKey) {
  const response = await fetch(configUrl(productTypeSlug, subtypeKey), { method: 'DELETE' });
  return readJsonResponse(response, `Delete ${productTypeSlug}/${subtypeKey}`);
}

function loadGroups() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const groups = [];

  for (const template of manifest.templates || []) {
    const productTypeSlug = String(template.productTypeSlug || '').trim();
    if (!productTypeSlug || !template.variants) continue;
    if (!INCLUDE_BAGS && productTypeSlug === 'bags') continue;
    if (PRODUCT_FILTER && productTypeSlug !== PRODUCT_FILTER) continue;

    const variants = Object.entries(template.variants).map(([subtypeKey, variant]) => {
      const views = Object.entries(variant.views || {}).map(([viewSlug, relativePath]) => {
        const filePath = path.join(TEMPLATES_ROOT, relativePath);
        assert(fs.existsSync(filePath), `Missing ${productTypeSlug}/${subtypeKey}/${viewSlug}: ${filePath}`);
        const bytes = fs.readFileSync(filePath);
        assert(
          bytes.length >= 8
            && bytes.subarray(0, 8).equals(
              Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            ),
          `Invalid PNG: ${filePath}`,
        );
        assert(
          bytes.length <= MAX_SAFE_UPLOAD_BYTES,
          `${productTypeSlug}/${subtypeKey}/${viewSlug} is ${bytes.length} bytes; `
            + `upload-safe limit is ${MAX_SAFE_UPLOAD_BYTES}`,
        );
        return { viewSlug, filePath, bytes: bytes.length };
      });
      assert(views.length > 0, `${productTypeSlug}/${subtypeKey} has no views`);
      return { subtypeKey, views };
    });

    if (variants.length > 0) groups.push({ productTypeSlug, variants });
  }

  assert(groups.length > 0, 'No matching customization subtype groups found');
  return groups;
}

function clonePositionsWithImages(defaultConfig, uploadedImages) {
  const bySlug = new Map((defaultConfig.positions || []).map(position => [position.slug, position]));
  return Object.entries(uploadedImages).map(([viewSlug, imageUrl], index) => {
    const source = bySlug.get(viewSlug) || {
      slug: viewSlug,
      label: viewSlug.charAt(0).toUpperCase() + viewSlug.slice(1),
      methods: [],
    };
    return {
      ...source,
      slug: viewSlug,
      imageUrl,
      sortOrder: source.sortOrder ?? index,
    };
  });
}

async function main() {
  const groups = loadGroups();
  const variantCount = groups.reduce((total, group) => total + group.variants.length, 0);
  const imageCount = groups.reduce(
    (total, group) => total + group.variants.reduce(
      (variantTotal, variant) => variantTotal + variant.views.length,
      0,
    ),
    0,
  );

  const defaults = {};
  for (const group of groups) {
    defaults[group.productTypeSlug] = await getConfig(group.productTypeSlug);
    assert(
      Array.isArray(defaults[group.productTypeSlug].positions)
        && defaults[group.productTypeSlug].positions.length > 0,
      `${group.productTypeSlug} default configuration has no positions`,
    );
  }

  const first = groups[0];
  const capabilityProbe = await getConfig(first.productTypeSlug, first.variants[0].subtypeKey);
  const backendSupportsSubtypes = Object.prototype.hasOwnProperty.call(
    capabilityProbe,
    'isSubtypeFallback',
  );
  console.log(
    `PREFLIGHT_OK groups=${groups.length} variants=${variantCount} images=${imageCount}`,
  );

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
  for (const group of groups) {
    existing[group.productTypeSlug] = {};
    for (const variant of group.variants) {
      const config = await getConfig(group.productTypeSlug, variant.subtypeKey);
      existing[group.productTypeSlug][variant.subtypeKey] = config.isSubtypeFallback ? null : config;
    }
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(
    BACKUP_DIR,
    `subtypes-before-seed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(
    backupPath,
    `${JSON.stringify({ createdAt: new Date().toISOString(), apiBase: API_BASE, existing }, null, 2)}\n`,
  );
  console.log(`BACKUP_SAVED ${backupPath}`);

  const updated = [];
  try {
    const uploadedByConfig = {};
    for (const group of groups) {
      for (const variant of group.variants) {
        const key = `${group.productTypeSlug}/${variant.subtypeKey}`;
        uploadedByConfig[key] = {};
        for (const view of variant.views) {
          uploadedByConfig[key][view.viewSlug] = await uploadImage(
            group.productTypeSlug,
            variant.subtypeKey,
            view.viewSlug,
            view.filePath,
          );
          console.log(`UPLOADED ${key}/${view.viewSlug}`);
        }
      }
    }

    for (const group of groups) {
      for (const variant of group.variants) {
        const key = `${group.productTypeSlug}/${variant.subtypeKey}`;
        const saved = await saveConfig(
          group.productTypeSlug,
          variant.subtypeKey,
          clonePositionsWithImages(defaults[group.productTypeSlug], uploadedByConfig[key]),
        );
        assert(saved.subtypeKey === variant.subtypeKey, `${key} saved as wrong subtype`);
        updated.push({ productTypeSlug: group.productTypeSlug, subtypeKey: variant.subtypeKey });
        console.log(`SAVED ${key}`);
      }
    }
  } catch (error) {
    console.error(`SEED_FAILED ${error.message}`);
    for (const item of updated.reverse()) {
      const prior = existing[item.productTypeSlug][item.subtypeKey];
      if (prior) {
        await saveConfig(item.productTypeSlug, item.subtypeKey, prior.positions);
      } else {
        await deleteConfig(item.productTypeSlug, item.subtypeKey);
      }
      console.error(`ROLLED_BACK ${item.productTypeSlug}/${item.subtypeKey}`);
    }
    throw error;
  }

  for (const group of groups) {
    for (const variant of group.variants) {
      const publicConfig = await getConfig(group.productTypeSlug, variant.subtypeKey, false);
      assert(
        publicConfig.subtypeKey === variant.subtypeKey && !publicConfig.isSubtypeFallback,
        `${group.productTypeSlug}/${variant.subtypeKey} public API returned a fallback`,
      );
      assert(
        publicConfig.positions.length === variant.views.length,
        `${group.productTypeSlug}/${variant.subtypeKey} position count mismatch`,
      );
      console.log(`PUBLIC_VERIFIED ${group.productTypeSlug}/${variant.subtypeKey}`);
    }
  }

  console.log(
    `SEED_COMPLETE groups=${groups.length} variants=${variantCount} images=${imageCount}`,
  );
  console.log(`ROLLBACK_BACKUP ${backupPath}`);
}

main().catch(error => {
  console.error(`FATAL ${error.stack || error.message}`);
  process.exitCode = 1;
});
