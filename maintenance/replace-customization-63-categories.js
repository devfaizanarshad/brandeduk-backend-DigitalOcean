const fs = require('fs');
const path = require('path');

const API_BASE = String(process.env.CUSTOMIZATION_API_BASE || 'https://api.brandeduk.com')
  .replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const PACKAGE_ROOT = process.env.CUSTOMIZATION_63_PACKAGE_ROOT
  || path.join(__dirname, '..', '..', 'BrandedUK_All_63_Categories', 'BrandedUK_Logo_Positions');
const ASSET_ROOT = process.env.CUSTOMIZATION_63_ASSET_ROOT
  || path.join(PACKAGE_ROOT, 'optimized-webp');
const INVENTORY_PATH = path.join(PACKAGE_ROOT, 'inventory.json');
const CATALOG_PATH = path.join(PACKAGE_ROOT, 'catalog.json');
const MAPPING_PATH = path.join(__dirname, 'customization-63-categories.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_UPLOAD_BYTES = 900 * 1024;
const REQUEST_DELAY_MS = Number(process.env.CUSTOMIZATION_REQUEST_DELAY_MS || 750);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${context}: HTTP ${response.status}: ${text.slice(0, 240)}`);
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
  const config = await readJsonResponse(response, `Fetch ${productTypeSlug}/${subtypeKey || 'default'}`);
  if (APPLY) await sleep(REQUEST_DELAY_MS);
  return config;
}

async function uploadImage(entry, position) {
  const bytes = fs.readFileSync(position.assetPath);
  const form = new FormData();
  form.append('productTypeSlug', entry.productTypeSlug);
  form.append('subtypeKey', entry.subtypeKey);
  form.append('viewSlug', position.slug);
  form.append('image', new Blob([bytes], { type: 'image/webp' }), `${position.slug}.webp`);

  const response = await fetch(`${API_BASE}/api/admin/customization-config/upload-image`, {
    method: 'POST',
    body: form,
  });
  const uploaded = await readJsonResponse(
    response,
    `Upload ${entry.productTypeSlug}/${entry.subtypeKey}/${position.slug}`,
  );
  assert(uploaded.imageUrl, `Upload returned no URL for ${position.assetPath}`);
  await sleep(REQUEST_DELAY_MS);
  return uploaded.imageUrl;
}

async function saveConfig(entry, subtypeKey, positions) {
  const response = await fetch(configUrl(entry.productTypeSlug, subtypeKey), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subtypeKey, positions }),
  });
  await sleep(REQUEST_DELAY_MS);
  return readJsonResponse(
    response,
    `Save ${entry.productTypeSlug}/${subtypeKey || 'default'}`,
  );
}

function methodsForPosition(label) {
  const large = /large|panel/i.test(label);
  const centre = /centre|center/i.test(label);
  return [
    large
      ? { method: 'embroidery', priceType: 'poa', price: null, enabled: true }
      : { method: 'embroidery', priceType: 'fixed', price: 5, enabled: true },
    {
      method: 'print',
      priceType: 'fixed',
      price: large ? 8 : (centre ? 6.5 : 3.5),
      enabled: true,
    },
  ];
}

function loadEntries() {
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  assert(mapping.length === 63, `Expected 63 mappings, found ${mapping.length}`);
  assert(catalog.length === 63, `Expected 63 catalogue categories, found ${catalog.length}`);
  assert(inventory.length === 339, `Expected 339 inventory items, found ${inventory.length}`);

  const catalogByNumber = new Map(catalog.map(item => [Number(item.number), item]));
  const inventoryByNumber = new Map();
  for (const item of inventory) {
    const number = Number(item.category_number);
    if (!inventoryByNumber.has(number)) inventoryByNumber.set(number, []);
    inventoryByNumber.get(number).push(item);
  }

  const defaults = new Set();
  return mapping.map(entry => {
    const category = catalogByNumber.get(Number(entry.number));
    assert(category, `Missing category ${entry.number}`);
    if (entry.isDefault) {
      assert(!defaults.has(entry.productTypeSlug), `Duplicate default for ${entry.productTypeSlug}`);
      defaults.add(entry.productTypeSlug);
    }
    const positions = (inventoryByNumber.get(Number(entry.number)) || []).map((item, index) => {
      const relativeWebp = item.file.replace(/\.png$/i, '.webp');
      const assetPath = path.join(ASSET_ROOT, relativeWebp);
      assert(fs.existsSync(assetPath), `Missing optimized asset: ${assetPath}`);
      const size = fs.statSync(assetPath).size;
      assert(size <= MAX_UPLOAD_BYTES, `Asset exceeds ${MAX_UPLOAD_BYTES} bytes: ${assetPath}`);
      return {
        slug: slugify(item.position),
        label: item.position,
        assetPath,
        sortOrder: index,
      };
    });
    assert(
      positions.length === category.positions.length,
      `${category.category} position count mismatch`,
    );
    assert(
      new Set(positions.map(position => position.slug)).size === positions.length,
      `${category.category} contains duplicate position slugs`,
    );
    return { ...entry, category: category.category, positions };
  });
}

async function main() {
  const entries = loadEntries();
  const productTypes = await fetch(`${API_BASE}/api/admin/customization-config/product-types`)
    .then(response => readJsonResponse(response, 'Fetch product types'));
  const liveSlugs = new Set((productTypes.items || []).map(item => item.slug));
  for (const entry of entries) {
    assert(liveSlugs.has(entry.productTypeSlug), `Unknown product type: ${entry.productTypeSlug}`);
  }

  console.log(`PREFLIGHT_OK categories=${entries.length} images=${entries.reduce((sum, entry) => sum + entry.positions.length, 0)}`);
  if (!APPLY) {
    console.log('DRY_RUN_COMPLETE Pass --apply to replace the live customization catalogue.');
    return;
  }

  const backup = { createdAt: new Date().toISOString(), apiBase: API_BASE, configs: {} };
  for (const entry of entries) {
    const key = `${entry.productTypeSlug}/${entry.subtypeKey}`;
    const existing = await getConfig(entry.productTypeSlug, entry.subtypeKey);
    backup.configs[key] = existing.isSubtypeFallback ? null : existing;
    if (entry.isDefault && !backup.configs[`${entry.productTypeSlug}/default`]) {
      backup.configs[`${entry.productTypeSlug}/default`] = await getConfig(entry.productTypeSlug);
    }
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(
    BACKUP_DIR,
    `customization-63-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);
  console.log(`BACKUP_SAVED ${backupPath}`);

  for (const entry of entries) {
    for (const position of entry.positions) {
      position.imageUrl = await uploadImage(entry, position);
      console.log(`UPLOADED ${entry.number}/${position.slug}`);
    }
  }

  for (const entry of entries) {
    const positions = entry.positions.map(position => ({
      slug: position.slug,
      label: position.label,
      imageUrl: position.imageUrl,
      sortOrder: position.sortOrder,
      isActive: true,
      methods: methodsForPosition(position.label),
    }));
    const saved = await saveConfig(entry, entry.subtypeKey, positions);
    assert(saved.positions.length === positions.length, `${entry.category} subtype save mismatch`);
    if (entry.isDefault) {
      const defaultSaved = await saveConfig(entry, '', positions);
      assert(defaultSaved.positions.length === positions.length, `${entry.category} default save mismatch`);
    }
    console.log(`SAVED ${entry.number} ${entry.productTypeSlug}/${entry.subtypeKey}`);
  }

  for (const entry of entries) {
    const config = await getConfig(entry.productTypeSlug, entry.subtypeKey, false);
    assert(!config.isSubtypeFallback, `${entry.category} returned a fallback`);
    assert(config.positions.length === entry.positions.length, `${entry.category} public count mismatch`);
    for (let index = 0; index < config.positions.length; index += 1) {
      assert(config.positions[index].label === entry.positions[index].label, `${entry.category} label mismatch`);
      const imageResponse = await fetch(config.positions[index].imageUrl, { cache: 'no-store' });
      assert(imageResponse.ok, `${entry.category}/${entry.positions[index].slug} image unavailable`);
    }
    console.log(`VERIFIED ${entry.number} ${entry.category}`);
  }

  console.log('MIGRATION_COMPLETE categories=63 images=339');
  console.log(`ROLLBACK_BACKUP ${backupPath}`);
}

main().catch(error => {
  console.error(`FATAL ${error.stack || error.message}`);
  process.exitCode = 1;
});
