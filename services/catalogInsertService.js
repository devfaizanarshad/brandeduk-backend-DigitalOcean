'use strict';

const { pool } = require('../config/database');
const { slugify } = require('../maintenance/lib/catalog-normalization');

const ALLOWED_PENCARRIE_BRANDS = new Set([
  'Babybugz', 'Brand Lab', 'Brook Taverner', 'Canterbury', 'Comfort Grip',
  'Craghoppers', 'Dennys', 'Ecologie', 'Finden + Hales', 'Joseph Alan',
  'K-Up', 'Larkwood', 'Le Chef', 'Mantis', 'Mumbles', 'Native Spirit',
  'NEOBLU', 'Onna by Premier', 'Ravine', 'So Denim', "SOL'S", 'Spasso',
  'Warrior', 'Westford Mill', 'WK Designed To Work'
]);

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

async function ensureNamedLookup(client, table, name, extraColumns = {}) {
  const cleanName = requiredText(name, `${table}.name`);
  const slug = slugify(cleanName);
  const existing = await client.query(
    `SELECT id FROM ${table} WHERE slug = $1 OR LOWER(name) = LOWER($2) ORDER BY (slug = $1) DESC, id LIMIT 1`,
    [slug, cleanName]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const columns = ['name', 'slug', ...Object.keys(extraColumns)];
  const values = [cleanName, slug, ...Object.values(extraColumns)];
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
    values
  );
  const created = await client.query(
    `SELECT id FROM ${table} WHERE slug = $1 OR LOWER(name) = LOWER($2) ORDER BY (slug = $1) DESC, id LIMIT 1`,
    [slug, cleanName]
  );
  if (!created.rows[0]) throw new Error(`Could not resolve ${table} lookup: ${cleanName}`);
  return created.rows[0].id;
}

async function ensureSupplier(client) {
  const existing = await client.query(`SELECT id FROM suppliers WHERE slug = 'pencarrie' LIMIT 1`);
  if (existing.rows[0]) return existing.rows[0].id;
  await client.query(`INSERT INTO suppliers (name, slug) VALUES ('Pencarrie', 'pencarrie') ON CONFLICT DO NOTHING`);
  const created = await client.query(`SELECT id FROM suppliers WHERE slug = 'pencarrie' LIMIT 1`);
  if (!created.rows[0]) throw new Error('Could not resolve Pencarrie supplier');
  return created.rows[0].id;
}

async function ensureColours(client, products) {
  const bySlug = new Map();
  for (const product of products) {
    const name = requiredText(product.colourName || product.primaryColour || 'Unknown', 'colourName');
    const slug = slugify(name);
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        name,
        slug,
        hex: product.colourHex || null,
        family: product.primaryColour || name
      });
    }
  }
  const rows = [...bySlug.values()];
  await client.query(`
    INSERT INTO colours (name, slug, hex_code, colour_family, display_order)
    SELECT item.name, item.slug, item.hex, item.family, 999
    FROM jsonb_to_recordset($1::jsonb) AS item(name text, slug text, hex text, family text)
    WHERE NOT EXISTS (SELECT 1 FROM colours c WHERE c.slug = item.slug OR LOWER(c.name) = LOWER(item.name))
    ON CONFLICT DO NOTHING
  `, [JSON.stringify(rows)]);
  const result = await client.query(
    `SELECT id, name, slug FROM colours
     WHERE slug = ANY($1::text[]) OR LOWER(name) = ANY($2::text[])`,
    [rows.map(row => row.slug), rows.map(row => row.name.toLowerCase())]
  );
  return new Map(rows.map(row => {
    const match = result.rows.find(item => item.slug === row.slug || item.name.toLowerCase() === row.name.toLowerCase());
    if (!match) throw new Error(`Could not resolve colour lookup: ${row.name}`);
    return [row.slug, match.id];
  }));
}

async function ensureSizes(client, products) {
  const bySlug = new Map();
  for (const product of products) {
    const name = requiredText(product.size || 'One Size', 'size');
    const slug = slugify(name);
    if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, order: Number(product.sizeOrder) || 999 });
  }
  const rows = [...bySlug.values()];
  await client.query(`
    INSERT INTO sizes (name, slug, size_order, size_type)
    SELECT item.name, item.slug, item.size_order, 'Garment'
    FROM jsonb_to_recordset($1::jsonb) AS item(name text, slug text, size_order integer)
    WHERE NOT EXISTS (SELECT 1 FROM sizes s WHERE s.slug = item.slug OR LOWER(s.name) = LOWER(item.name))
    ON CONFLICT DO NOTHING
  `, [JSON.stringify(rows.map(row => ({ name: row.name, slug: row.slug, size_order: row.order })))]);
  const result = await client.query(
    `SELECT id, name, slug FROM sizes
     WHERE slug = ANY($1::text[]) OR LOWER(name) = ANY($2::text[])`,
    [rows.map(row => row.slug), rows.map(row => row.name.toLowerCase())]
  );
  return new Map(rows.map(row => {
    const match = result.rows.find(item => item.slug === row.slug || item.name.toLowerCase() === row.name.toLowerCase());
    if (!match) throw new Error(`Could not resolve size lookup: ${row.name}`);
    return [row.slug, match.id];
  }));
}

async function insertMissingPencarrieStyle(payload) {
  const style = payload?.style || {};
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const styleCode = requiredText(style.styleCode, 'style.styleCode').toUpperCase();
  const brand = requiredText(style.brand, 'style.brand');
  if (!ALLOWED_PENCARRIE_BRANDS.has(brand)) throw new Error(`Brand is not approved for import: ${brand}`);
  if (!products.length || products.length > 500) throw new Error('products must contain between 1 and 500 SKUs');
  if (products.some(product => String(product.styleCode || '').trim().toUpperCase() !== styleCode)) {
    throw new Error('Every product must match style.styleCode');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pencarrie:${styleCode}`]);
    const existing = await client.query('SELECT style_code FROM styles WHERE style_code = $1', [styleCode]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return { status: 'skipped', styleCode, reason: 'style_exists', insertedProducts: 0 };
    }

    const supplierId = await ensureSupplier(client);
    const brandId = await ensureNamedLookup(client, 'brands', brand, { display_order: 999 });
    const productTypeId = await ensureNamedLookup(client, 'product_types', style.productType || 'Accessories', { display_order: 999 });
    const genderId = await ensureNamedLookup(client, 'genders', style.gender || 'Unisex', { display_order: 999 });
    const ageGroupId = await ensureNamedLookup(client, 'age_groups', style.ageGroup || 'Adults', { display_order: 999 });
    const colourIds = await ensureColours(client, products);
    const sizeIds = await ensureSizes(client, products);

    await client.query(`
      INSERT INTO styles (
        style_code, style_name, brand_id, product_type_id, gender_id, age_group_id,
        fabric_description, specification, supplier_id, external_style_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      styleCode, requiredText(style.styleName || styleCode, 'style.styleName'), brandId,
      productTypeId, genderId, ageGroupId, style.fabricDescription || null,
      style.specification || null, supplierId, style.externalStyleCode || styleCode
    ]);

    const rows = products.map(product => ({
      style_code: styleCode,
      sku_code: requiredText(product.skuCode, 'skuCode').toUpperCase(),
      external_sku: product.externalSku || product.skuCode,
      colour_name: product.colourName || product.primaryColour || 'Unknown',
      primary_colour: product.primaryColour || product.colourName || 'Unknown',
      colour_shade: product.colourShade || null,
      colour_id: colourIds.get(slugify(product.colourName || product.primaryColour || 'Unknown')),
      size_id: sizeIds.get(slugify(product.size || 'One Size')),
      sku_status: product.status || 'Live',
      carton_price: product.cartonPrice,
      pack_price: product.packPrice,
      single_price: product.singlePrice,
      primary_image_url: product.primaryImageUrl || null,
      colour_image_url: product.colourImageUrl || null,
      stock_quantity: Number(product.stockQuantity) || 0
    }));

    const inserted = await client.query(`
      INSERT INTO products (
        style_code, sku_code, external_sku, colour_name, primary_colour, colour_shade,
        colour_id, size_id, sku_status, carton_price, pack_price, single_price,
        sell_price, primary_image_url, colour_image_url, stock_quantity
      )
      SELECT item.style_code, item.sku_code, item.external_sku, item.colour_name,
        item.primary_colour, item.colour_shade, item.colour_id, item.size_id,
        item.sku_status, item.carton_price, item.pack_price, item.single_price,
        COALESCE(NULLIF(item.carton_price, 0), NULLIF(item.single_price, 0)),
        item.primary_image_url, item.colour_image_url, item.stock_quantity
      FROM jsonb_to_recordset($1::jsonb) AS item(
        style_code text, sku_code text, external_sku text, colour_name text,
        primary_colour text, colour_shade text, colour_id integer, size_id integer,
        sku_status text, carton_price numeric, pack_price numeric, single_price numeric,
        primary_image_url text, colour_image_url text, stock_quantity integer
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [JSON.stringify(rows)]);

    await client.query(`
      UPDATE products p SET
        sell_price = ROUND(priced.base_price * (1 + priced.markup_percent / 100), 2),
        pricing_version = priced.version,
        last_priced_at = NOW()
      FROM (
        SELECT product.id, COALESCE(NULLIF(product.carton_price, 0), NULLIF(product.single_price, 0)) base_price,
          rule.markup_percent, rule.version
        FROM products product
        JOIN LATERAL (
          SELECT markup_percent, version FROM pricing_rules
          WHERE active = TRUE
            AND COALESCE(NULLIF(product.carton_price, 0), NULLIF(product.single_price, 0)) BETWEEN from_price AND to_price
          ORDER BY from_price LIMIT 1
        ) rule ON TRUE
        WHERE product.style_code = $1
      ) priced
      WHERE p.id = priced.id
    `, [styleCode]);

    await client.query('COMMIT');
    return { status: 'inserted', styleCode, insertedProducts: inserted.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ALLOWED_PENCARRIE_BRANDS, insertMissingPencarrieStyle };
