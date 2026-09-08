#!/usr/bin/env node
'use strict';

const { audit } = require('./audit-supplier-catalog');
const { resolveSourcePath, iterateSupplierRecords } = require('./lib/catalog-source');
const { slugify } = require('./lib/catalog-normalization');

const MINIMUMS = {
  ralawise: { rows: 90000, styles: 3500, price: 99, image: 99, fabric: 90, gsm: 85 },
  uneek: { rows: 6000, styles: 100, price: 95, image: 99, fabric: 95, gsm: 90 },
  'absolute-apparel': { rows: 20000, styles: 550, price: 99, image: 99, fabric: 90, gsm: 85 }
};

function parseArgs(argv) {
  const options = {
    supplier: '', source: '', apply: false, retireMissing: false,
    refreshViews: true, allowLargeRetire: false, batchSize: 250
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--supplier') options.supplier = String(argv[++index] || '').toLowerCase();
    else if (arg === '--source') options.source = argv[++index] || '';
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--retire-missing') options.retireMissing = true;
    else if (arg === '--allow-large-retire') options.allowLargeRetire = true;
    else if (arg === '--skip-refresh') options.refreshViews = false;
    else if (arg === '--batch-size') options.batchSize = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 25 || options.batchSize > 500) {
    throw new Error('--batch-size must be an integer from 25 to 500');
  }
  return options;
}

function assertSafeAudit(summary) {
  const minimum = MINIMUMS[summary.supplier];
  if (!minimum) throw new Error(`Unsupported supplier: ${summary.supplier}`);
  const failures = [];
  if (summary.preflight !== 'PASS') failures.push('identifier preflight failed');
  if (summary.rows < minimum.rows) failures.push(`only ${summary.rows} rows (minimum ${minimum.rows})`);
  if (summary.styles < minimum.styles) failures.push(`only ${summary.styles} styles (minimum ${minimum.styles})`);
  for (const key of ['price', 'image', 'fabric', 'gsm']) {
    const coverageKey = { price: 'validPrice', image: 'usableImage', fabric: 'normalizedFabric', gsm: 'normalizedGsm' }[key];
    if (summary.coverage[coverageKey] < minimum[key]) {
      failures.push(`${coverageKey} coverage ${summary.coverage[coverageKey]}% (minimum ${minimum[key]}%)`);
    }
  }
  if (failures.length) throw new Error(`Source safety checks failed: ${failures.join('; ')}`);
}

function stagePayload(record) {
  return {
    ...record,
    brandSlug: slugify(record.brand),
    genderSlug: slugify(record.gender),
    ageGroupSlug: slugify(record.ageGroup),
    colourSlug: slugify(record.colourName),
    sizeSlug: slugify(record.size),
    tagSlug: record.tag ? slugify(record.tag) : '',
    categories: record.categories.map(name => ({ name, slug: slugify(name) })),
    accreditations: record.accreditations.map(name => ({ name, slug: slugify(name) }))
  };
}

async function insertStageBatch(client, rows) {
  if (!rows.length) return;
  const values = [];
  const placeholders = rows.map((record, index) => {
    const offset = index * 4;
    values.push(record.supplierSlug, record.styleCode, record.skuCode, JSON.stringify(stagePayload(record)));
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb)`;
  });
  await client.query(`
    INSERT INTO catalog_stage (supplier_slug, style_code, sku_code, payload)
    VALUES ${placeholders.join(',')}
  `, values);
}

async function stageSource(client, supplier, sourcePath, batchSize) {
  let batch = [];
  let staged = 0;
  for await (const { record } of iterateSupplierRecords(supplier, sourcePath)) {
    batch.push(record);
    if (batch.length >= batchSize) {
      await insertStageBatch(client, batch);
      staged += batch.length;
      batch = [];
      if (staged % 10000 === 0) console.log(`STAGED rows=${staged}`);
    }
  }
  await insertStageBatch(client, batch);
  staged += batch.length;
  return staged;
}

async function ensureRunTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS catalog_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      supplier_slug VARCHAR(100) NOT NULL,
      source_sha256 CHAR(64) NOT NULL,
      source_path TEXT,
      source_rows INTEGER NOT NULL,
      source_styles INTEGER NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'running',
      retire_missing BOOLEAN NOT NULL DEFAULT FALSE,
      summary JSONB,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
}

async function requireSchema(client) {
  const required = {
    styles: ['style_code', 'supplier_id', 'external_style_code'],
    products: ['sku_code', 'external_sku', 'sell_price', 'pricing_version', 'last_priced_at']
  };
  for (const [table, columns] of Object.entries(required)) {
    const result = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])
    `, [table, columns]);
    const found = new Set(result.rows.map(row => row.column_name));
    const missing = columns.filter(column => !found.has(column));
    if (missing.length) throw new Error(`Database schema is missing ${table}.${missing.join(`, ${table}.`)}`);
  }
}

async function ensureLookups(client) {
  const statements = [
    `INSERT INTO brands (name, slug, display_order)
     SELECT DISTINCT ON (payload->>'brandSlug') payload->>'brand', payload->>'brandSlug', 999 FROM catalog_stage st
     WHERE payload->>'brandSlug' <> '' AND NOT EXISTS (SELECT 1 FROM brands x WHERE x.slug = payload->>'brandSlug')
     ORDER BY payload->>'brandSlug', payload->>'brand'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO product_types (name, slug, display_order)
     SELECT DISTINCT ON (payload->'productType'->>'slug') payload->'productType'->>'name', payload->'productType'->>'slug', 999 FROM catalog_stage st
     WHERE NOT EXISTS (SELECT 1 FROM product_types x WHERE x.slug = payload->'productType'->>'slug')
     ORDER BY payload->'productType'->>'slug', payload->'productType'->>'name'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO genders (name, slug, display_order)
     SELECT DISTINCT ON (payload->>'genderSlug') payload->>'gender', payload->>'genderSlug', 999 FROM catalog_stage st
     WHERE NOT EXISTS (SELECT 1 FROM genders x WHERE x.slug = payload->>'genderSlug')
     ORDER BY payload->>'genderSlug', payload->>'gender'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO age_groups (name, slug, display_order)
     SELECT DISTINCT ON (payload->>'ageGroupSlug') payload->>'ageGroup', payload->>'ageGroupSlug', 999 FROM catalog_stage st
     WHERE NOT EXISTS (SELECT 1 FROM age_groups x WHERE x.slug = payload->>'ageGroupSlug')
     ORDER BY payload->>'ageGroupSlug', payload->>'ageGroup'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO colours (name, slug, hex_code, colour_family, display_order)
     SELECT DISTINCT ON (payload->>'colourSlug') payload->>'colourName', payload->>'colourSlug',
       NULLIF(payload->>'colourHex', ''), payload->>'primaryColour', 999
     FROM catalog_stage st
     WHERE NOT EXISTS (SELECT 1 FROM colours x WHERE x.slug = payload->>'colourSlug')
     ORDER BY payload->>'colourSlug', payload->>'colourName'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO sizes (name, slug, size_order, size_type)
     SELECT DISTINCT ON (payload->>'sizeSlug') payload->>'size', payload->>'sizeSlug',
       (payload->>'sizeOrder')::integer, payload->>'ageGroup'
     FROM catalog_stage st
     WHERE NOT EXISTS (SELECT 1 FROM sizes x WHERE x.slug = payload->>'sizeSlug')
     ORDER BY payload->>'sizeSlug', (payload->>'sizeOrder')::integer
     ON CONFLICT DO NOTHING`,
    `INSERT INTO tags (name, slug, display_order)
     SELECT DISTINCT ON (payload->>'tagSlug') payload->>'tag', payload->>'tagSlug', 999 FROM catalog_stage st
     WHERE payload->>'tagSlug' <> '' AND NOT EXISTS (SELECT 1 FROM tags x WHERE x.slug = payload->>'tagSlug')
     ORDER BY payload->>'tagSlug', payload->>'tag'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO fabrics (name, slug, fabric_type, percentage)
     SELECT DISTINCT ON (f->>'slug') f->>'name', f->>'slug', f->>'type', NULLIF(f->>'percentage', '')
     FROM catalog_stage st CROSS JOIN LATERAL jsonb_array_elements(payload->'fabrics') f
     WHERE NOT EXISTS (SELECT 1 FROM fabrics x WHERE x.slug = f->>'slug')
     ORDER BY f->>'slug', f->>'name'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO weight_ranges (name, slug, min_gsm, max_gsm)
     SELECT DISTINCT ON (w->>'slug') w->>'name', w->>'slug', (w->>'min')::integer, NULLIF(w->>'max', '')::integer
     FROM catalog_stage st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN payload->'weightRange' = 'null'::jsonb THEN '[]'::jsonb ELSE jsonb_build_array(payload->'weightRange') END) w
     WHERE NOT EXISTS (SELECT 1 FROM weight_ranges x WHERE x.slug = w->>'slug')
     ORDER BY w->>'slug', w->>'name'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO accreditations (name, slug)
     SELECT DISTINCT ON (a->>'slug') a->>'name', a->>'slug'
     FROM catalog_stage st CROSS JOIN LATERAL jsonb_array_elements(payload->'accreditations') a
     WHERE NOT EXISTS (SELECT 1 FROM accreditations x WHERE x.slug = a->>'slug')
     ORDER BY a->>'slug', a->>'name'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO categories (name, slug, category_type, display_order)
     SELECT DISTINCT ON (c->>'slug') c->>'name', c->>'slug', 'supplier', 999
     FROM catalog_stage st CROSS JOIN LATERAL jsonb_array_elements(payload->'categories') c
     WHERE NOT EXISTS (SELECT 1 FROM categories x WHERE x.slug = c->>'slug')
     ORDER BY c->>'slug', c->>'name'
     ON CONFLICT DO NOTHING`,
    `INSERT INTO style_keywords (name, slug, keyword_type)
     SELECT DISTINCT ON (k->>'type', k->>'slug') k->>'name', k->>'slug', k->>'type'
     FROM catalog_stage st CROSS JOIN LATERAL jsonb_array_elements(payload->'keywords') k
     WHERE NOT EXISTS (SELECT 1 FROM style_keywords x WHERE x.slug = k->>'slug' AND x.keyword_type = k->>'type')
     ORDER BY k->>'type', k->>'slug', k->>'name'
     ON CONFLICT DO NOTHING`
  ];
  for (const statement of statements) await client.query(statement);

  await client.query(`
    UPDATE sizes s SET size_order = LEAST(COALESCE(s.size_order, 999), q.size_order)
    FROM (
      SELECT payload->>'sizeSlug' slug, MIN((payload->>'sizeOrder')::integer) size_order
      FROM catalog_stage GROUP BY payload->>'sizeSlug'
    ) q WHERE s.slug = q.slug
  `);
}

async function repairLookupSequences(client) {
  const tables = [
    'brands', 'product_types', 'genders', 'age_groups', 'colours', 'sizes',
    'tags', 'fabrics', 'weight_ranges', 'accreditations', 'categories'
  ];
  for (const table of tables) {
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence($1, 'id'),
        GREATEST(COALESCE(MAX(id), 0), 1),
        MAX(id) IS NOT NULL
      )
      FROM ${table}
    `, [table]);
  }
}

async function assertLookupResolution(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*) FROM (SELECT DISTINCT payload->>'brandSlug' slug, payload->>'brand' name FROM catalog_stage) q
       WHERE NOT EXISTS (SELECT 1 FROM brands x WHERE x.slug = q.slug OR x.name = q.name))::int AS brands,
      (SELECT count(*) FROM (SELECT DISTINCT payload->'productType'->>'slug' slug, payload->'productType'->>'name' name FROM catalog_stage) q
       WHERE NOT EXISTS (SELECT 1 FROM product_types x WHERE x.slug = q.slug OR x.name = q.name))::int AS product_types,
      (SELECT count(*) FROM (SELECT DISTINCT payload->>'genderSlug' slug, payload->>'gender' name FROM catalog_stage) q
       WHERE NOT EXISTS (SELECT 1 FROM genders x WHERE x.slug = q.slug OR x.name = q.name))::int AS genders,
      (SELECT count(*) FROM (SELECT DISTINCT payload->>'ageGroupSlug' slug, payload->>'ageGroup' name FROM catalog_stage) q
       WHERE NOT EXISTS (SELECT 1 FROM age_groups x WHERE x.slug = q.slug OR x.name = q.name))::int AS age_groups,
      (SELECT count(*) FROM (SELECT DISTINCT payload->>'colourSlug' slug, payload->>'colourName' name FROM catalog_stage) q
       WHERE NOT EXISTS (SELECT 1 FROM colours x WHERE x.slug = q.slug OR x.name = q.name))::int AS colours,
      (SELECT count(*) FROM (SELECT DISTINCT payload->>'sizeSlug' slug, payload->>'size' name FROM catalog_stage) q
       WHERE NOT EXISTS (SELECT 1 FROM sizes x WHERE x.slug = q.slug OR x.name = q.name))::int AS sizes,
      (SELECT count(*) FROM (SELECT DISTINCT payload->>'tagSlug' slug, payload->>'tag' name FROM catalog_stage WHERE payload->>'tagSlug' <> '') q
       WHERE NOT EXISTS (SELECT 1 FROM tags x WHERE x.slug = q.slug OR x.name = q.name))::int AS tags
  `);
  const unresolved = Object.entries(result.rows[0]).filter(([, count]) => count > 0);
  if (unresolved.length) {
    throw new Error(`Unresolved catalogue lookups: ${unresolved.map(([name, count]) => `${name}=${count}`).join(', ')}`);
  }
}

async function assertNoOwnershipConflicts(client, supplierId) {
  const styleConflict = await client.query(`
    SELECT st.style_code, sup.slug existing_supplier
    FROM (SELECT DISTINCT style_code FROM catalog_stage) st
    JOIN styles s ON s.style_code = st.style_code
    LEFT JOIN suppliers sup ON sup.id = s.supplier_id
    WHERE s.supplier_id IS NOT NULL AND s.supplier_id <> $1 LIMIT 10
  `, [supplierId]);
  if (styleConflict.rows.length) throw new Error(`Style ownership conflict: ${JSON.stringify(styleConflict.rows)}`);

  const skuConflict = await client.query(`
    SELECT st.sku_code, sup.slug existing_supplier
    FROM catalog_stage st JOIN products p ON p.sku_code = st.sku_code
    JOIN styles s ON s.style_code = p.style_code LEFT JOIN suppliers sup ON sup.id = s.supplier_id
    WHERE s.supplier_id IS NOT NULL AND s.supplier_id <> $1 LIMIT 10
  `, [supplierId]);
  if (skuConflict.rows.length) throw new Error(`SKU ownership conflict: ${JSON.stringify(skuConflict.rows)}`);
}

async function buildDatabasePlan(client, supplierId) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(DISTINCT style_code) FROM catalog_stage)::int staged_styles,
      (SELECT COUNT(*) FROM catalog_stage)::int staged_skus,
      (SELECT COUNT(DISTINCT st.style_code) FROM catalog_stage st
       WHERE NOT EXISTS (SELECT 1 FROM styles s WHERE s.style_code = st.style_code))::int new_styles,
      (SELECT COUNT(*) FROM catalog_stage st
       WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.sku_code = st.sku_code))::int new_skus,
      (SELECT COUNT(*) FROM products p JOIN styles s ON s.style_code = p.style_code
       WHERE s.supplier_id = $1 AND p.sku_status = 'Live')::int existing_live_skus,
      (SELECT COUNT(*) FROM products p JOIN styles s ON s.style_code = p.style_code
       WHERE s.supplier_id = $1 AND p.sku_status = 'Live'
         AND NOT EXISTS (SELECT 1 FROM catalog_stage st WHERE st.sku_code = p.sku_code))::int retire_candidates
  `, [supplierId]);
  const plan = result.rows[0];
  plan.retire_percentage = plan.existing_live_skus
    ? Number(((plan.retire_candidates / plan.existing_live_skus) * 100).toFixed(2))
    : 0;
  return plan;
}

async function syncStyles(client, supplierId) {
  const updated = await client.query(`
    UPDATE styles s SET
      style_name = q.payload->>'styleName', brand_id = b.id, product_type_id = pt.id,
      gender_id = g.id, age_group_id = ag.id,
      fabric_description = NULLIF(q.payload->>'fabricDescription', ''),
      specification = NULLIF(q.payload->>'specification', ''),
      supplier_id = $1, external_style_code = q.payload->>'externalStyleCode', updated_at = NOW()
    FROM (SELECT DISTINCT ON (style_code) style_code, payload FROM catalog_stage ORDER BY style_code) q
    JOIN LATERAL (SELECT id FROM brands x WHERE x.slug = q.payload->>'brandSlug' OR x.name = q.payload->>'brand' ORDER BY (x.slug = q.payload->>'brandSlug') DESC, x.id LIMIT 1) b ON TRUE
    JOIN LATERAL (SELECT id FROM product_types x WHERE x.slug = q.payload->'productType'->>'slug' OR x.name = q.payload->'productType'->>'name' ORDER BY (x.slug = q.payload->'productType'->>'slug') DESC, x.id LIMIT 1) pt ON TRUE
    JOIN LATERAL (SELECT id FROM genders x WHERE x.slug = q.payload->>'genderSlug' OR x.name = q.payload->>'gender' ORDER BY (x.slug = q.payload->>'genderSlug') DESC, x.id LIMIT 1) g ON TRUE
    JOIN LATERAL (SELECT id FROM age_groups x WHERE x.slug = q.payload->>'ageGroupSlug' OR x.name = q.payload->>'ageGroup' ORDER BY (x.slug = q.payload->>'ageGroupSlug') DESC, x.id LIMIT 1) ag ON TRUE
    WHERE s.style_code = q.style_code
  `, [supplierId]);
  const inserted = await client.query(`
    INSERT INTO styles (
      style_code, style_name, brand_id, product_type_id, gender_id, age_group_id,
      fabric_description, specification, supplier_id, external_style_code
    )
    SELECT q.style_code, q.payload->>'styleName', b.id, pt.id, g.id, ag.id,
      NULLIF(q.payload->>'fabricDescription', ''), NULLIF(q.payload->>'specification', ''),
      $1, q.payload->>'externalStyleCode'
    FROM (SELECT DISTINCT ON (style_code) style_code, payload FROM catalog_stage ORDER BY style_code) q
    JOIN LATERAL (SELECT id FROM brands x WHERE x.slug = q.payload->>'brandSlug' OR x.name = q.payload->>'brand' ORDER BY (x.slug = q.payload->>'brandSlug') DESC, x.id LIMIT 1) b ON TRUE
    JOIN LATERAL (SELECT id FROM product_types x WHERE x.slug = q.payload->'productType'->>'slug' OR x.name = q.payload->'productType'->>'name' ORDER BY (x.slug = q.payload->'productType'->>'slug') DESC, x.id LIMIT 1) pt ON TRUE
    JOIN LATERAL (SELECT id FROM genders x WHERE x.slug = q.payload->>'genderSlug' OR x.name = q.payload->>'gender' ORDER BY (x.slug = q.payload->>'genderSlug') DESC, x.id LIMIT 1) g ON TRUE
    JOIN LATERAL (SELECT id FROM age_groups x WHERE x.slug = q.payload->>'ageGroupSlug' OR x.name = q.payload->>'ageGroup' ORDER BY (x.slug = q.payload->>'ageGroupSlug') DESC, x.id LIMIT 1) ag ON TRUE
    WHERE NOT EXISTS (SELECT 1 FROM styles s WHERE s.style_code = q.style_code)
  `, [supplierId]);
  return { inserted: inserted.rowCount, updated: updated.rowCount };
}

async function syncProducts(client) {
  const updated = await client.query(`
    UPDATE products p SET
      style_code = st.style_code, external_sku = st.payload->>'externalSku',
      colour_name = st.payload->>'colourName', primary_colour = st.payload->>'primaryColour',
      colour_shade = st.payload->>'colourShade', colour_id = c.id, size_id = sz.id, tag_id = t.id,
      sku_status = st.payload->>'status', carton_price = NULLIF(st.payload->>'cartonPrice', '')::numeric,
      pack_price = NULLIF(st.payload->>'packPrice', '')::numeric,
      single_price = NULLIF(st.payload->>'singlePrice', '')::numeric,
      sell_price = COALESCE(NULLIF(st.payload->>'cartonPrice', '')::numeric, NULLIF(st.payload->>'singlePrice', '')::numeric),
      pricing_version = NULL, last_priced_at = NULL,
      primary_image_url = NULLIF(st.payload->>'primaryImageUrl', ''),
      colour_image_url = NULLIF(st.payload->>'colourImageUrl', ''),
      stock_quantity = COALESCE((st.payload->>'stockQuantity')::integer, 0), updated_at = NOW()
    FROM catalog_stage st
    JOIN LATERAL (SELECT id FROM colours x WHERE x.slug = st.payload->>'colourSlug' OR x.name = st.payload->>'colourName' ORDER BY (x.slug = st.payload->>'colourSlug') DESC, x.id LIMIT 1) c ON TRUE
    JOIN LATERAL (SELECT id FROM sizes x WHERE x.slug = st.payload->>'sizeSlug' OR x.name = st.payload->>'size' ORDER BY (x.slug = st.payload->>'sizeSlug') DESC, x.id LIMIT 1) sz ON TRUE
    LEFT JOIN LATERAL (SELECT id FROM tags x WHERE x.slug = NULLIF(st.payload->>'tagSlug', '') OR x.name = NULLIF(st.payload->>'tag', '') ORDER BY (x.slug = NULLIF(st.payload->>'tagSlug', '')) DESC, x.id LIMIT 1) t ON TRUE
    WHERE p.sku_code = st.sku_code
  `);
  const inserted = await client.query(`
    INSERT INTO products (
      style_code, sku_code, external_sku, colour_name, primary_colour, colour_shade,
      colour_id, size_id, tag_id, sku_status, carton_price, pack_price, single_price,
      sell_price, primary_image_url, colour_image_url, stock_quantity
    )
    SELECT st.style_code, st.sku_code, st.payload->>'externalSku', st.payload->>'colourName',
      st.payload->>'primaryColour', st.payload->>'colourShade', c.id, sz.id, t.id,
      st.payload->>'status', NULLIF(st.payload->>'cartonPrice', '')::numeric,
      NULLIF(st.payload->>'packPrice', '')::numeric, NULLIF(st.payload->>'singlePrice', '')::numeric,
      COALESCE(NULLIF(st.payload->>'cartonPrice', '')::numeric, NULLIF(st.payload->>'singlePrice', '')::numeric),
      NULLIF(st.payload->>'primaryImageUrl', ''), NULLIF(st.payload->>'colourImageUrl', ''),
      COALESCE((st.payload->>'stockQuantity')::integer, 0)
    FROM catalog_stage st
    JOIN LATERAL (SELECT id FROM colours x WHERE x.slug = st.payload->>'colourSlug' OR x.name = st.payload->>'colourName' ORDER BY (x.slug = st.payload->>'colourSlug') DESC, x.id LIMIT 1) c ON TRUE
    JOIN LATERAL (SELECT id FROM sizes x WHERE x.slug = st.payload->>'sizeSlug' OR x.name = st.payload->>'size' ORDER BY (x.slug = st.payload->>'sizeSlug') DESC, x.id LIMIT 1) sz ON TRUE
    LEFT JOIN LATERAL (SELECT id FROM tags x WHERE x.slug = NULLIF(st.payload->>'tagSlug', '') OR x.name = NULLIF(st.payload->>'tag', '') ORDER BY (x.slug = NULLIF(st.payload->>'tagSlug', '')) DESC, x.id LIMIT 1) t ON TRUE
    WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.sku_code = st.sku_code)
  `);
  return { inserted: inserted.rowCount, updated: updated.rowCount };
}

async function replaceMappings(client, supplierId) {
  const productTables = ['product_categories', 'product_fabrics', 'product_weight_ranges', 'product_accreditations'];
  for (const table of productTables) {
    await client.query(`DELETE FROM ${table} m USING products p, styles s WHERE m.product_id = p.id AND p.style_code = s.style_code AND s.supplier_id = $1`, [supplierId]);
  }
  await client.query(`DELETE FROM style_keywords_mapping m USING styles s WHERE m.style_code = s.style_code AND s.supplier_id = $1`, [supplierId]);

  const counts = {};
  counts.categories = (await client.query(`
    INSERT INTO product_categories (product_id, category_id)
    SELECT DISTINCT p.id, c.id FROM catalog_stage st JOIN products p ON p.sku_code = st.sku_code
    CROSS JOIN LATERAL jsonb_array_elements(st.payload->'categories') item JOIN categories c ON c.slug = item->>'slug'
  `)).rowCount;
  counts.fabrics = (await client.query(`
    INSERT INTO product_fabrics (product_id, fabric_id)
    SELECT DISTINCT p.id, f.id FROM catalog_stage st JOIN products p ON p.sku_code = st.sku_code
    CROSS JOIN LATERAL jsonb_array_elements(st.payload->'fabrics') item JOIN fabrics f ON f.slug = item->>'slug'
  `)).rowCount;
  counts.weights = (await client.query(`
    INSERT INTO product_weight_ranges (product_id, weight_range_id)
    SELECT DISTINCT p.id, w.id FROM catalog_stage st JOIN products p ON p.sku_code = st.sku_code
    JOIN weight_ranges w ON w.slug = st.payload->'weightRange'->>'slug'
    WHERE st.payload->'weightRange' <> 'null'::jsonb
  `)).rowCount;
  counts.accreditations = (await client.query(`
    INSERT INTO product_accreditations (product_id, accreditation_id)
    SELECT DISTINCT p.id, a.id FROM catalog_stage st JOIN products p ON p.sku_code = st.sku_code
    CROSS JOIN LATERAL jsonb_array_elements(st.payload->'accreditations') item JOIN accreditations a ON a.slug = item->>'slug'
  `)).rowCount;
  counts.keywords = (await client.query(`
    INSERT INTO style_keywords_mapping (style_code, keyword_id)
    SELECT DISTINCT st.style_code, k.id FROM catalog_stage st
    CROSS JOIN LATERAL jsonb_array_elements(st.payload->'keywords') item
    JOIN style_keywords k ON k.slug = item->>'slug' AND k.keyword_type = item->>'type'
  `)).rowCount;
  return counts;
}

async function repriceSupplier(client, supplierId) {
  return (await client.query(`
    WITH priced AS (
      SELECT p.id,
        COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) base_price,
        override.markup_percent override_markup,
        rule.markup_percent rule_markup,
        rule.version rule_version
      FROM products p
      JOIN styles s ON s.style_code = p.style_code
      LEFT JOIN product_markup_overrides override ON override.style_code = p.style_code
      LEFT JOIN LATERAL (
        SELECT r.version, r.markup_percent FROM pricing_rules r
        WHERE r.active = TRUE
          AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) BETWEEN r.from_price AND r.to_price
        ORDER BY r.from_price LIMIT 1
      ) rule ON TRUE
      WHERE s.supplier_id = $1
    )
    UPDATE products p SET
      sell_price = ROUND(priced.base_price * (1 + COALESCE(priced.override_markup, priced.rule_markup) / 100), 2),
      pricing_version = CASE WHEN priced.override_markup IS NOT NULL THEN 'OVERRIDE' ELSE priced.rule_version END,
      last_priced_at = NOW()
    FROM priced WHERE p.id = priced.id AND priced.base_price IS NOT NULL
      AND COALESCE(priced.override_markup, priced.rule_markup) IS NOT NULL
  `, [supplierId])).rowCount;
}

async function applySync(options, sourcePath, sourceAudit) {
  const { pool } = require('../config/database');
  const client = await pool.connect();
  let runId = null;
  try {
    await ensureRunTable(client);
    const run = await client.query(`
      INSERT INTO catalog_sync_runs (supplier_slug, source_sha256, source_path, source_rows, source_styles, retire_missing, summary)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id
    `, [options.supplier, sourceAudit.sourceSha256, sourcePath, sourceAudit.rows, sourceAudit.styles, options.retireMissing, JSON.stringify({ audit: sourceAudit })]);
    runId = run.rows[0].id;

    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '30min'`);
    await client.query(`SET LOCAL lock_timeout = '30s'`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('brandeduk_catalog_sync'))`);
    await requireSchema(client);
    await client.query(`CREATE TEMP TABLE catalog_stage (supplier_slug text, style_code text, sku_code text PRIMARY KEY, payload jsonb NOT NULL) ON COMMIT DROP`);
    const stagedRows = await stageSource(client, options.supplier, sourcePath, options.batchSize);
    if (stagedRows !== sourceAudit.rows) throw new Error(`Source changed during import: audited ${sourceAudit.rows}, staged ${stagedRows}`);
    await client.query('CREATE INDEX catalog_stage_style_idx ON catalog_stage (style_code)');
    await client.query('ANALYZE catalog_stage');

    await client.query(`
      INSERT INTO suppliers (name, slug)
      SELECT $1::varchar, $2::varchar
      WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE slug = $2::varchar)
    `, [sourceAudit.supplier === 'absolute-apparel' ? 'Absolute Apparel' : sourceAudit.supplier[0].toUpperCase() + sourceAudit.supplier.slice(1), options.supplier]);
    const supplierResult = await client.query('SELECT id FROM suppliers WHERE slug = $1', [options.supplier]);
    const supplierId = supplierResult.rows[0]?.id;
    if (!supplierId) throw new Error(`Could not resolve supplier ${options.supplier}`);

    console.log('CHECKING supplier ownership and database plan');
    await assertNoOwnershipConflicts(client, supplierId);
    const databasePlan = await buildDatabasePlan(client, supplierId);
    console.log(`DATABASE_PLAN ${JSON.stringify(databasePlan)}`);
    if (options.retireMissing && databasePlan.retire_percentage > 10 && !options.allowLargeRetire) {
      throw new Error(`Refusing to retire ${databasePlan.retire_percentage}% of live ${options.supplier} SKUs. Verify the source or pass --allow-large-retire.`);
    }
    console.log('REPAIRING lookup sequences');
    await repairLookupSequences(client);
    console.log('SYNCING lookup values');
    await ensureLookups(client);
    await assertLookupResolution(client);
    console.log('SYNCING styles');
    const styles = await syncStyles(client, supplierId);
    console.log('SYNCING products');
    const products = await syncProducts(client);
    let retired = 0;
    if (options.retireMissing) {
      retired = (await client.query(`
        UPDATE products p SET sku_status = 'Discontinued', updated_at = NOW()
        FROM styles s WHERE p.style_code = s.style_code AND s.supplier_id = $1
          AND p.sku_status = 'Live' AND NOT EXISTS (SELECT 1 FROM catalog_stage st WHERE st.sku_code = p.sku_code)
      `, [supplierId])).rowCount;
    }
    console.log('SYNCING product filter mappings');
    const mappings = await replaceMappings(client, supplierId);
    console.log('REPRICING supplier products');
    const repriced = await repriceSupplier(client, supplierId);

    if (options.refreshViews) {
      console.log('REFRESHING product_search_mv');
      await client.query('REFRESH MATERIALIZED VIEW product_search_mv');
      console.log('REFRESHING product_search_materialized');
      await client.query('REFRESH MATERIALIZED VIEW product_search_materialized');
    }

    const result = { stagedRows, databasePlan, styles, products, retired, mappings, repriced, viewsRefreshed: options.refreshViews };
    await client.query(`UPDATE catalog_sync_runs SET status = 'complete', summary = summary || $2::jsonb, completed_at = NOW() WHERE id = $1`, [runId, JSON.stringify({ result })]);
    await client.query('COMMIT');
    console.log(`SYNC_COMPLETE ${JSON.stringify(result)}`);

    const { invalidateProductCache } = require('../services/cacheService');
    await invalidateProductCache();
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (runId) {
      try {
        await client.query(`UPDATE catalog_sync_runs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`, [runId, error.message]);
      } catch {}
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.supplier) {
    console.log('Usage: node maintenance/sync-supplier-catalog.js --supplier ralawise|uneek|absolute-apparel [--source path] [--apply] [--retire-missing] [--allow-large-retire] [--skip-refresh]');
    process.exit(options.help ? 0 : 1);
  }

  const sourcePath = resolveSourcePath(options.supplier, options.source);
  console.log(`PREFLIGHT supplier=${options.supplier} source=${sourcePath}`);
  const sourceAudit = await audit({ supplier: options.supplier, source: sourcePath });
  assertSafeAudit(sourceAudit);
  console.log(`PREFLIGHT_OK rows=${sourceAudit.rows} styles=${sourceAudit.styles} liveStyles=${sourceAudit.liveStyles} fabric=${sourceAudit.coverage.normalizedFabric}% gsm=${sourceAudit.coverage.normalizedGsm}%`);
  if (!options.apply) {
    console.log('DRY_RUN_COMPLETE No database changes made. Pass --apply to sync; add --retire-missing to retire stale supplier SKUs.');
    return;
  }
  await applySync(options, sourcePath, sourceAudit);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`CATALOG_SYNC_FAILED ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  assertSafeAudit,
  stagePayload,
  insertStageBatch,
  repairLookupSequences,
  ensureLookups,
  assertLookupResolution,
  syncStyles,
  syncProducts,
  repriceSupplier
};
