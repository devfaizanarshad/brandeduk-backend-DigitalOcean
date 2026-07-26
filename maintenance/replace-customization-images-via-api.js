const fs = require('fs');
const path = require('path');

const API_BASE = String(process.env.CUSTOMIZATION_API_BASE || 'https://api.brandeduk.com')
  .replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const slugArgIndex = process.argv.indexOf('--slug');
const requestedSlug = (
  slugArgIndex >= 0
    ? process.argv[slugArgIndex + 1]
    : process.argv.find(arg => arg.startsWith('--slug='))?.slice('--slug='.length)
  || ''
).trim();
const TEMPLATES_ROOT = path.join(__dirname, '..', 'customization-garments-tamplates');
const MANIFEST_PATH = path.join(TEMPLATES_ROOT, 'manifest.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
  return results;
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${context}: invalid JSON response (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok || body.success === false) {
    throw new Error(`${context}: HTTP ${response.status}: ${body.message || text.slice(0, 300)}`);
  }
  return body;
}

async function getConfig(slug, admin = true) {
  const prefix = admin
    ? '/api/admin/customization/templates'
    : '/api/customization-config';
  const response = await fetch(`${API_BASE}${prefix}/${encodeURIComponent(slug)}`);
  const body = await readJsonResponse(response, `Fetch ${admin ? 'admin' : 'public'} config for ${slug}`);
  return body.data || body;
}

async function uploadImage(productTypeSlug, viewSlug, filePath) {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  // Multer needs this field before the file so it can use the slug in the generated filename.
  form.append('productTypeSlug', productTypeSlug);
  form.append('viewSlug', viewSlug);
  form.append('image', new Blob([bytes], { type: 'image/png' }), `${viewSlug}.png`);

  const response = await fetch(`${API_BASE}/api/admin/customization-config/upload-image`, {
    method: 'POST',
    body: form,
  });
  const body = await readJsonResponse(response, `Upload ${productTypeSlug}/${viewSlug}`);
  const uploaded = body.data || body;

  assert(uploaded.imageUrl, `Upload ${productTypeSlug}/${viewSlug} returned no imageUrl`);
  assert(uploaded.mimetype === 'image/png', `Upload ${productTypeSlug}/${viewSlug} is not PNG`);
  assert(Number(uploaded.size) === bytes.length, `Upload size mismatch for ${productTypeSlug}/${viewSlug}`);

  const imageResponse = await fetch(uploaded.imageUrl, { cache: 'no-store' });
  assert(imageResponse.ok, `Uploaded image is inaccessible: ${uploaded.imageUrl}`);
  assert(
    String(imageResponse.headers.get('content-type') || '').toLowerCase().includes('image/png'),
    `Uploaded image has unexpected content type: ${uploaded.imageUrl}`,
  );
  const downloaded = Buffer.from(await imageResponse.arrayBuffer());
  assert(downloaded.length === bytes.length, `Downloaded size mismatch: ${uploaded.imageUrl}`);

  return {
    imageUrl: uploaded.imageUrl,
    filename: uploaded.filename,
    size: bytes.length,
  };
}

async function saveConfig(slug, config) {
  const response = await fetch(
    `${API_BASE}/api/admin/customization/templates/${encodeURIComponent(slug)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions: config.positions }),
    },
  );
  const body = await readJsonResponse(response, `Save config for ${slug}`);
  return body.data || body;
}

function makeBackupName() {
  return `customization-config-before-image-replacement-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.json`;
}

async function main() {
  assert(fs.existsSync(MANIFEST_PATH), `Manifest not found: ${MANIFEST_PATH}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert(Array.isArray(manifest.templates), 'Manifest templates must be an array');
  const templates = requestedSlug
    ? manifest.templates.filter(template => template.productTypeSlug === requestedSlug)
    : manifest.templates;
  assert(
    templates.length > 0,
    `No manifest template found for slug: ${requestedSlug}`,
  );

  const configs = new Map();
  let imageCount = 0;

  for (const template of templates) {
    const slug = template.productTypeSlug;
    assert(slug, 'Manifest entry is missing productTypeSlug');
    assert(template.views && typeof template.views === 'object', `${slug} has no views`);

    const config = await getConfig(slug, true);
    const positions = Array.isArray(config.positions) ? config.positions : [];
    const configSlugs = positions.map(position => position.slug).sort();
    const manifestSlugs = Object.keys(template.views).sort();

    assert(
      JSON.stringify(configSlugs) === JSON.stringify(manifestSlugs),
      `${slug} view mismatch: API=[${configSlugs.join(', ')}], manifest=[${manifestSlugs.join(', ')}]`,
    );

    for (const [viewSlug, relativePath] of Object.entries(template.views)) {
      const filePath = path.join(TEMPLATES_ROOT, relativePath);
      assert(fs.existsSync(filePath), `Missing image: ${filePath}`);
      const buffer = fs.readFileSync(filePath);
      assert(
        buffer.length >= 8 && buffer.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
        `Not a valid PNG: ${filePath}`,
      );
      imageCount += 1;
    }
    configs.set(slug, config);
  }

  if (!requestedSlug) {
    assert(templates.length === 19, `Expected 19 templates, found ${templates.length}`);
    assert(imageCount === 46, `Expected 46 images, found ${imageCount}`);
  }
  console.log(`PREFLIGHT_OK templates=${templates.length} images=${imageCount}`);

  if (!APPLY) {
    console.log('DRY_RUN_COMPLETE Pass --apply to upload and replace live image references.');
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, makeBackupName());
  const backup = {
    createdAt: new Date().toISOString(),
    apiBase: API_BASE,
    configs: Object.fromEntries(configs),
  };
  fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);
  console.log(`BACKUP_SAVED ${backupPath}`);

  const uploads = new Map(templates.map(template => [template.productTypeSlug, {}]));
  const uploadJobs = templates.flatMap(template =>
    Object.entries(template.views).map(([viewSlug, relativePath]) => ({
      slug: template.productTypeSlug,
      viewSlug,
      relativePath,
    })),
  );
  await mapWithConcurrency(uploadJobs, 6, async job => {
    const filePath = path.join(TEMPLATES_ROOT, job.relativePath);
    const uploaded = await uploadImage(job.slug, job.viewSlug, filePath);
    uploads.get(job.slug)[job.viewSlug] = uploaded;
    console.log(`UPLOADED ${job.slug}/${job.viewSlug} ${uploaded.imageUrl}`);
    return uploaded;
  });
  console.log(`UPLOADS_OK images=${imageCount}`);

  const updatedSlugs = [];
  try {
    for (const template of templates) {
      const slug = template.productTypeSlug;
      const original = configs.get(slug);
      const perType = uploads.get(slug);
      const replacement = {
        ...original,
        positions: original.positions.map(position => ({
          ...position,
          imageUrl: perType[position.slug].imageUrl,
        })),
      };

      const saved = await saveConfig(slug, replacement);
      for (const position of saved.positions) {
        assert(
          position.imageUrl === perType[position.slug].imageUrl,
          `${slug}/${position.slug} did not save the expected image URL`,
        );
      }
      updatedSlugs.push(slug);
      console.log(`DATABASE_UPDATED ${slug}`);
    }
  } catch (error) {
    console.error(`DATABASE_UPDATE_FAILED ${error.message}`);
    console.error(`ROLLBACK_START updated=${updatedSlugs.length}`);
    const rollbackErrors = [];
    for (const slug of updatedSlugs.reverse()) {
      try {
        await saveConfig(slug, configs.get(slug));
        console.error(`ROLLED_BACK ${slug}`);
      } catch (rollbackError) {
        rollbackErrors.push(`${slug}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`${error.message}; rollback errors: ${rollbackErrors.join(' | ')}`);
    }
    throw error;
  }

  const verificationResults = await mapWithConcurrency(templates, 6, async template => {
    const slug = template.productTypeSlug;
    const publicConfig = await getConfig(slug, false);
    const perType = uploads.get(slug);
    assert(
      publicConfig.positions.length === Object.keys(template.views).length,
      `${slug} public position count mismatch`,
    );
    await mapWithConcurrency(publicConfig.positions, 4, async position => {
      const expected = perType[position.slug]?.imageUrl;
      assert(expected, `${slug}/${position.slug} is unexpected in public config`);
      assert(position.imageUrl === expected, `${slug}/${position.slug} public URL mismatch`);
      const imageResponse = await fetch(position.imageUrl, { cache: 'no-store' });
      assert(imageResponse.ok, `${slug}/${position.slug} public image is inaccessible`);
      assert(
        String(imageResponse.headers.get('content-type') || '').toLowerCase().includes('image/png'),
        `${slug}/${position.slug} public image is not served as PNG`,
      );
    });
    console.log(`PUBLIC_VERIFIED ${slug}`);
    return publicConfig.positions.length;
  });
  const verified = verificationResults.reduce((total, count) => total + count, 0);

  console.log(`MIGRATION_COMPLETE templates=${templates.length} images=${verified}`);
  console.log(`ROLLBACK_BACKUP ${backupPath}`);
}

main().catch(error => {
  console.error(`FATAL ${error.stack || error.message}`);
  process.exitCode = 1;
});
