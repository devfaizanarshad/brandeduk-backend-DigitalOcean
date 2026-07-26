const fs = require('fs');
const path = require('path');

const API_BASE = String(
  process.env.PRODUCT_TYPE_API_BASE || 'https://api.brandeduk.com',
).replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const CORRECTIONS_PATH = path.join(
  __dirname,
  'hi-vis-and-supplier-product-type-corrections.json',
);
const BACKUP_DIR = path.join(__dirname, 'backups');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response, context) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `${context}: invalid JSON (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `${context}: HTTP ${response.status}: ${body.message || body.error || text.slice(0, 300)}`,
    );
  }
  return body;
}

async function getProductTypes() {
  const response = await fetch(`${API_BASE}/api/filters/product-types`);
  const body = await readJson(response, 'Fetch product types');
  return body.productTypes || [];
}

async function getAllStyles() {
  const styles = [];
  for (let offset = 0; ; offset += 500) {
    const response = await fetch(
      `${API_BASE}/api/admin/styles?limit=500&offset=${offset}`,
    );
    const body = await readJson(response, `Fetch styles offset ${offset}`);
    const items = body.items || [];
    styles.push(...items);
    if (items.length < 500) break;
  }
  return styles;
}

async function updateProductType(code, expectedProductTypeId, productTypeId) {
  const response = await fetch(
    `${API_BASE}/api/admin/products/${encodeURIComponent(code)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_type_id: productTypeId,
        expected_product_type_id: expectedProductTypeId,
      }),
    },
  );
  return readJson(response, `Update ${code}`);
}

function backupName() {
  return `product-types-before-supplier-correction-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.json`;
}

async function main() {
  assert(fs.existsSync(CORRECTIONS_PATH), `Missing ${CORRECTIONS_PATH}`);
  const manifest = JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf8'));
  assert(Array.isArray(manifest.corrections), 'corrections must be an array');
  assert(
    manifest.corrections.length === 70,
    `Expected 70 guarded corrections, found ${manifest.corrections.length}`,
  );

  const [productTypes, styles] = await Promise.all([
    getProductTypes(),
    getAllStyles(),
  ]);
  const typeBySlug = new Map(productTypes.map(type => [type.slug, type]));
  const typeById = new Map(productTypes.map(type => [Number(type.id), type]));
  const styleByCode = new Map(
    styles.map(style => [String(style.style_code).toUpperCase(), style]),
  );
  const seenCodes = new Set();
  const pending = [];
  const alreadyApplied = [];

  for (const correction of manifest.corrections) {
    const code = String(correction.code || '').toUpperCase();
    assert(code && !seenCodes.has(code), `Invalid or duplicate code: ${code}`);
    seenCodes.add(code);

    const currentType = typeBySlug.get(correction.currentSlug);
    const targetType = typeBySlug.get(correction.targetSlug);
    const style = styleByCode.get(code);
    assert(style, `Style not found: ${code}`);
    assert(currentType, `Unknown current slug: ${correction.currentSlug}`);
    assert(targetType, `Unknown target slug: ${correction.targetSlug}`);

    const actualTypeId = Number(style.product_type_id);
    if (actualTypeId === Number(targetType.id)) {
      alreadyApplied.push({ code, style, currentType, targetType });
      continue;
    }
    assert(
      actualTypeId === Number(currentType.id),
      `${code} classification conflict: expected ${currentType.name}, found ${
        typeById.get(actualTypeId)?.name || actualTypeId
      }`,
    );
    pending.push({ code, style, currentType, targetType });
  }

  console.log(
    `PREFLIGHT_OK corrections=${manifest.corrections.length} pending=${pending.length} alreadyApplied=${alreadyApplied.length}`,
  );
  for (const item of pending) {
    console.log(
      `PENDING ${item.code} ${item.currentType.name} -> ${item.targetType.name}`,
    );
  }

  if (!APPLY) {
    console.log(
      'DRY_RUN_COMPLETE Deploy the updated backend route, then pass --apply.',
    );
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, backupName());
  fs.writeFileSync(
    backupPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        apiBase: API_BASE,
        pending: pending.map(item => ({
          code: item.code,
          styleName: item.style.style_name,
          productTypeId: Number(item.style.product_type_id),
          productTypeSlug: item.currentType.slug,
          targetProductTypeId: Number(item.targetType.id),
          targetProductTypeSlug: item.targetType.slug,
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`BACKUP_SAVED ${backupPath}`);

  const updated = [];
  try {
    for (const item of pending) {
      await updateProductType(
        item.code,
        Number(item.currentType.id),
        Number(item.targetType.id),
      );
      updated.push(item);
      console.log(
        `UPDATED ${item.code} ${item.currentType.name} -> ${item.targetType.name}`,
      );
    }
  } catch (error) {
    console.error(`UPDATE_FAILED ${error.message}`);
    const rollbackErrors = [];
    for (const item of updated.reverse()) {
      try {
        await updateProductType(
          item.code,
          Number(item.targetType.id),
          Number(item.currentType.id),
        );
        console.error(`ROLLED_BACK ${item.code}`);
      } catch (rollbackError) {
        rollbackErrors.push(`${item.code}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(
        `${error.message}; rollback errors: ${rollbackErrors.join(' | ')}`,
      );
    }
    throw error;
  }

  const verifiedStyles = await getAllStyles();
  const verifiedByCode = new Map(
    verifiedStyles.map(style => [
      String(style.style_code).toUpperCase(),
      Number(style.product_type_id),
    ]),
  );
  for (const correction of manifest.corrections) {
    const targetType = typeBySlug.get(correction.targetSlug);
    assert(
      verifiedByCode.get(correction.code) === Number(targetType.id),
      `Verification failed for ${correction.code}`,
    );
  }

  console.log(
    `MIGRATION_COMPLETE corrected=${updated.length} alreadyApplied=${alreadyApplied.length}`,
  );
  console.log(`ROLLBACK_BACKUP ${backupPath}`);
}

main().catch(error => {
  console.error(`FATAL ${error.stack || error.message}`);
  process.exitCode = 1;
});
