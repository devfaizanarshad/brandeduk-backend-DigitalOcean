#!/usr/bin/env node
/**
 * Add MISSING UNEEK products from BRA52-UneekProdData.csv to brandeduk_ralawise_backup.
 * Only inserts rows whose Short Code is NOT already in the database.
 * Target: brandeduk_ralawise_backup (local) ONLY. Never production.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BACKUP_DB = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.BACKUP_DB_NAME || process.env.PGDATABASE || 'brandeduk_ralawise_backup',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '1234',
};

function assertBackupOnly() {
  const h = (BACKUP_DB.host || '').toLowerCase();
  const db = (BACKUP_DB.database || '').toLowerCase();
  if (h !== 'localhost' && h !== '127.0.0.1') {
    console.error('FATAL: Must run on localhost');
    process.exit(1);
  }
  if (db === 'brandeduk_prod' || db.includes('prod')) {
    console.error('FATAL: Must NOT run on production');
    process.exit(1);
  }
}

assertBackupOnly();

const CSV_PATH = path.join(__dirname, '..', 'BRA52-UneekProdData.csv');

const CATEGORY_MAP = {
  'Polos': { productType: 'polos', category: 'polos', sport: null, ageGroup: null },
  'Sweatshirts': { productType: 'sweatshirts', category: 'sweatshirts', sport: null, ageGroup: null },
  'SWEATSHIRT': { productType: 'sweatshirts', category: 'sweatshirts', sport: null, ageGroup: null },
  'T-Shirts': { productType: 't-shirts', category: 't-shirts', sport: null, ageGroup: null },
  'Childrenswear': { productType: 'childrenswear', category: 'kids', sport: null, ageGroup: 'kids' },
  'Jackets': { productType: 'jackets', category: 'jackets', sport: null, ageGroup: null },
  'Shirts': { productType: 'shirts', category: 'shirts', sport: null, ageGroup: null },
  'Trousers': { productType: 'trousers', category: 'trousers', sport: null, ageGroup: null },
  'Healthcare': { productType: 'workwear', category: 'workwear', sport: null, ageGroup: null },
  'Sportswear': { productType: 'sportswear', category: 'sportswear', sport: 'general', ageGroup: null },
  'Hi Vis': { productType: 'safety-vest', category: 'safety', sport: null, ageGroup: null },
  'Jog Bottoms': { productType: 'joggers', category: 'joggers', sport: null, ageGroup: null },
  'Rugby Shirts': { productType: 'rugby-shirts', category: 'rugby', sport: 'rugby', ageGroup: null },
  'Headwear': { productType: 'caps', category: 'caps', sport: null, ageGroup: null },
  'Hospitality': { productType: 'aprons', category: 'hospitality', sport: null, ageGroup: null },
};

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function loadCSV() {
  let content;
  for (const enc of ['latin1', 'utf-8', 'cp1252']) {
    try {
      content = fs.readFileSync(CSV_PATH, { encoding: enc });
      break;
    } catch (e) {
      continue;
    }
  }
  if (!content) throw new Error('Cannot read CSV');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const row = {};
    header.forEach((h, j) => { row[h.trim()] = (vals[j] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

async function main() {
  console.log('='.repeat(70));
  console.log('ADD MISSING UNEEK from BRA52-UneekProdData.csv');
  console.log('Target:', BACKUP_DB.database);
  console.log('='.repeat(70));

  assertBackupOnly();

  const pool = new Pool(BACKUP_DB);

  try {
    // 1. Get existing UNEEK sku_codes
    const existingRes = await pool.query(`
      SELECT p.sku_code FROM products p
      JOIN styles st ON p.style_code = st.style_code
      JOIN suppliers s ON st.supplier_id = s.id
      WHERE s.slug = 'uneek'
    `);
    const existingSkuCodes = new Set(existingRes.rows.map((r) => (r.sku_code || '').trim()));

    // 2. Load CSV and filter to missing only
    const allRows = loadCSV();
    const missingRows = allRows.filter((r) => {
      const sc = (r['Short Code'] || '').trim();
      return sc && !existingSkuCodes.has(sc);
    });

    console.log('CSV total rows:', allRows.length);
    console.log('Existing UNEEK sku_codes in DB:', existingSkuCodes.size);
    console.log('Missing (to add):', missingRows.length);

    if (missingRows.length === 0) {
      console.log('Nothing to add. All CSV data already in DB.');
      return;
    }

    // 3. Load lookups
    const ptRes = await pool.query('SELECT id, slug, name FROM product_types');
    const ptBySlug = Object.fromEntries(ptRes.rows.map((r) => [r.slug, r.id]));
    const ptByName = Object.fromEntries(ptRes.rows.map((r) => [r.name?.toLowerCase(), r.id]));

    const catRes = await pool.query('SELECT id, slug, name FROM categories');
    const catBySlug = Object.fromEntries(catRes.rows.map((r) => [r.slug, r.id]));

    const gRes = await pool.query('SELECT id, slug FROM genders');
    const genderBySlug = Object.fromEntries(gRes.rows.map((r) => [r.slug, r.id]));

    const agRes = await pool.query('SELECT id, slug FROM age_groups');
    const ageBySlug = Object.fromEntries(agRes.rows.map((r) => [r.slug, r.id]));

    const sRes = await pool.query('SELECT id, slug, name FROM sizes');
    const sizeBySlug = Object.fromEntries(sRes.rows.map((r) => [r.slug, r.id]));
    const sizeByName = Object.fromEntries(sRes.rows.map((r) => [(r.name || '').toLowerCase(), r.id]));

    const cRes = await pool.query('SELECT id, slug, name FROM colours');
    const colourBySlug = Object.fromEntries(cRes.rows.map((r) => [r.slug, r.id]));
    const colourByName = Object.fromEntries(cRes.rows.map((r) => [(r.name || '').toLowerCase(), r.id]));

    const sportRes = await pool.query('SELECT id, slug FROM related_sports');
    const sportBySlug = Object.fromEntries(sportRes.rows.map((r) => [r.slug, r.id]));

    const supRes = await pool.query("SELECT id FROM suppliers WHERE slug = 'uneek'");
    const uneekSupplierId = supRes.rows[0]?.id;
    if (!uneekSupplierId) throw new Error('Uneek supplier not found');

    let brandId = (await pool.query("SELECT id FROM brands WHERE LOWER(name) LIKE '%uneek%'")).rows[0]?.id;
    if (!brandId) {
      try {
        const ins = await pool.query(`INSERT INTO brands (name, slug, display_order) VALUES ('Uneek Clothing', 'uneek-clothing', 999) RETURNING id`);
        brandId = ins.rows[0]?.id;
      } catch (e) {
        if (e.code === '23505') {
          brandId = (await pool.query("SELECT id FROM brands WHERE slug = 'uneek-clothing'")).rows[0]?.id;
        } else throw e;
      }
    }
    if (!brandId) throw new Error('Uneek brand not found');

    function resolveProductType(cat) {
      const m = CATEGORY_MAP[cat] || CATEGORY_MAP['T-Shirts'];
      return ptBySlug[m.productType] || ptByName[m.productType] || ptBySlug['t-shirts'] || ptRes.rows[0]?.id;
    }
    function resolveCategory(cat) {
      const m = CATEGORY_MAP[cat] || CATEGORY_MAP['T-Shirts'];
      return catBySlug[m.category] || catBySlug['t-shirts'] || catRes.rows[0]?.id;
    }
    function resolveGender(g) {
      const slug = (g || 'unisex').toLowerCase().replace(/\s/g, '-');
      return genderBySlug[slug] || genderBySlug['unisex'] || genderBySlug['mens'] || gRes.rows[0]?.id;
    }
    function resolveAgeGroup(cat) {
      const m = CATEGORY_MAP[cat];
      if (m?.ageGroup) return ageBySlug[m.ageGroup] || null;
      return null;
    }
    function resolveSize(s) {
      if (!s) return null;
      const key = String(s).toLowerCase().trim();
      return sizeBySlug[key] || sizeByName[key] || null;
    }
    async function resolveColour(client, c, hex) {
      if (!c) return null;
      const key = (c || '').toLowerCase().trim();
      const slg = slugify(c);
      let id = colourByName[key] || colourBySlug[slg];
      if (!id && hex) {
        try {
          const ins = await client.query(
            `INSERT INTO colours (name, slug, hex_code) VALUES ($1, $2, $3) RETURNING id`,
            [c, slg, (hex || '').toString().substring(0, 7) || null]
          );
          id = ins.rows[0]?.id;
        } catch (e) {
          if (e.code === '23505') {
            const r = await client.query('SELECT id FROM colours WHERE slug = $1', [slg]);
            id = r.rows[0]?.id;
          } else throw e;
        }
      }
      return id;
    }
    function resolveSport(cat) {
      const m = CATEGORY_MAP[cat];
      if (m?.sport) return sportBySlug[m.sport] || null;
      return null;
    }

    // 4. Group missing by Product Code
    const byStyle = {};
    for (const r of missingRows) {
      const code = (r['Product Code'] || '').trim();
      if (!code) continue;
      if (!byStyle[code]) byStyle[code] = [];
      byStyle[code].push(r);
    }

    console.log('Unique styles to add/update:', Object.keys(byStyle).length);

    // 5. Insert
    const client = await pool.connect();
    let stylesAdded = 0;
    let productsAdded = 0;

    for (const [productCode, rows] of Object.entries(byStyle)) {
      const first = rows[0];
      const productTypeId = resolveProductType(first.Category);
      const genderId = resolveGender(first.Gender);
      const ageGroupId = resolveAgeGroup(first.Category);
      const sportId = resolveSport(first.Category);
      const categoryId = resolveCategory(first.Category);

      const styleExists = (await client.query('SELECT 1 FROM styles WHERE style_code = $1', [productCode])).rows[0];
      if (!styleExists) {
        await client.query(
          `INSERT INTO styles (style_code, style_name, brand_id, product_type_id, gender_id, age_group_id,
            fabric_description, specification, supplier_id, external_style_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            productCode,
            (first['Product Name'] || productCode).trim(),
            brandId,
            productTypeId,
            genderId,
            ageGroupId,
            (first.Composition || '').trim() || null,
            (first.Specifications || '').trim() || null,
            uneekSupplierId,
            productCode,
          ]
        );
        stylesAdded++;
      }

      for (const row of rows) {
        const shortCode = (row['Short Code'] || '').trim();
        const colour = (row.Colour || '').trim();
        const sizeId = resolveSize(row.Size);
        const colourId = await resolveColour(client, colour, row.Hex);

        const singlePrice = parseFloat(row['Price Single'] || row.MyPrice || 0) || 0;
        const cartonPrice = parseFloat(row['Price Caton'] || 0) || null;
        const packPrice = parseFloat(row['Price Pack'] || 0) || null;

        const img1 = (row['Model Large Image'] || row['Large Colour Image'] || '').trim();
        const img2 = (row['Large Colour Image'] || row['Model Large Image'] || '').trim();
        const ean = (row['EAN (Bar Code)'] || shortCode || '').trim();

        const r = await client.query(
          `INSERT INTO products (style_code, sku_code, colour_name, primary_colour, colour_id, size_id,
            single_price, pack_price, carton_price, sell_price, primary_image_url, colour_image_url, sku_status, external_sku)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Live', $13)
           RETURNING id`,
          [
            productCode,
            shortCode,
            colour,
            colour,
            colourId,
            sizeId,
            singlePrice,
            packPrice || null,
            cartonPrice || null,
            singlePrice,
            img1 || img2,
            img2 || img1,
            ean,
          ]
        );

        if (r.rows?.[0]) {
          productsAdded++;
          const productId = r.rows[0].id;
          try {
            await client.query(`INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)`, [productId, categoryId]);
          } catch (e) {
            if (e.code !== '23505') throw e;
          }
          if (sportId) {
            try {
              await client.query(`INSERT INTO product_sports (product_id, sport_id) VALUES ($1, $2)`, [productId, sportId]);
            } catch (e) {
              if (e.code !== '23505') throw e;
            }
          }
        }
      }
    }

    client.release();
    console.log('Styles added:', stylesAdded);
    console.log('Products added:', productsAdded);
    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
