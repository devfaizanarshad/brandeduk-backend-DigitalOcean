#!/usr/bin/env node
/**
 * UNEEK Merge - Runs ONLY on local backup database (brandeduk_ralawise_backup).
 * NEVER touches production.
 *
 * Safety: Uses BACKUP_DB config - will ABORT if host is remote or db is brandeduk_prod.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// =============================================================================
// TARGET: Local backup ONLY. Never production.
// =============================================================================
const BACKUP_DB = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.BACKUP_DB_NAME || process.env.PGDATABASE || 'brandeduk_ralawise_backup',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '1234',
};

// Safety: abort if we're accidentally pointed at production
function assertBackupOnly() {
  const h = (BACKUP_DB.host || '').toLowerCase();
  const db = (BACKUP_DB.database || '').toLowerCase();
  if (h !== 'localhost' && h !== '127.0.0.1') {
    console.error('FATAL: Merge must run on localhost. Current host:', BACKUP_DB.host);
    process.exit(1);
  }
  if (db === 'brandeduk_prod' || db.includes('prod')) {
    console.error('FATAL: Merge must NOT run on production. Current database:', BACKUP_DB.database);
    process.exit(1);
  }
  if (BACKUP_DB.database !== 'brandeduk_ralawise_backup') {
    console.warn('WARNING: Target DB is', BACKUP_DB.database, '- expected brandeduk_ralawise_backup');
  }
}

assertBackupOnly();

const UNEEK_JSON = path.join(__dirname, '..', 'uneek_products_clean.json');

// UNEEK Category -> product_type slug, category slug, sport slug, age_group slug
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

async function main() {
  console.log('='.repeat(70));
  console.log('UNEEK MERGE - Target:', BACKUP_DB.database, '@', BACKUP_DB.host);
  console.log('='.repeat(70));

  assertBackupOnly();

  const pool = new Pool(BACKUP_DB);

  try {
    // 1. Run migration
    const migPath = path.join(__dirname, 'migrations', '001_add_suppliers.sql');
    const mig = fs.readFileSync(migPath, 'utf8');
    await pool.query(mig);
    console.log('Migration applied.');

    // Fix sequences (restored backups often have out-of-sync sequences)
    await pool.query("SELECT setval('brands_id_seq', (SELECT COALESCE(MAX(id),1) FROM brands), true)");
    await pool.query("SELECT setval('colours_id_seq', (SELECT COALESCE(MAX(id),1) FROM colours), true)");
    await pool.query("SELECT setval(pg_get_serial_sequence('products','id'), (SELECT COALESCE(MAX(id),1) FROM products), true)");
    console.log('Sequences synced.');

    // 2. Load lookups
    const ptRes = await pool.query('SELECT id, slug, name FROM product_types');
    const ptBySlug = Object.fromEntries(ptRes.rows.map(r => [r.slug, r.id]));
    const ptByName = Object.fromEntries(ptRes.rows.map(r => [r.name?.toLowerCase(), r.id]));

    const catRes = await pool.query('SELECT id, slug, name FROM categories');
    const catBySlug = Object.fromEntries(catRes.rows.map(r => [r.slug, r.id]));

    const gRes = await pool.query('SELECT id, slug FROM genders');
    const genderBySlug = Object.fromEntries(gRes.rows.map(r => [r.slug, r.id]));

    const agRes = await pool.query('SELECT id, slug FROM age_groups');
    const ageBySlug = Object.fromEntries(agRes.rows.map(r => [r.slug, r.id]));

    const sRes = await pool.query('SELECT id, slug, name FROM sizes');
    const sizeBySlug = Object.fromEntries(sRes.rows.map(r => [r.slug, r.id]));
    const sizeByName = Object.fromEntries(sRes.rows.map(r => [(r.name || '').toLowerCase(), r.id]));

    const cRes = await pool.query('SELECT id, slug, name FROM colours');
    const colourBySlug = Object.fromEntries(cRes.rows.map(r => [r.slug, r.id]));
    const colourByName = Object.fromEntries(cRes.rows.map(r => [(r.name || '').toLowerCase(), r.id]));

    const sportRes = await pool.query('SELECT id, slug FROM related_sports');
    const sportBySlug = Object.fromEntries(sportRes.rows.map(r => [r.slug, r.id]));

    const supRes = await pool.query("SELECT id FROM suppliers WHERE slug = 'uneek'");
    const uneekSupplierId = supRes.rows[0]?.id;
    if (!uneekSupplierId) throw new Error('Uneek supplier not found');

    // Brand
    let brandId = (await pool.query("SELECT id FROM brands WHERE LOWER(name) LIKE '%uneek%'")).rows[0]?.id;
    if (!brandId) {
      try {
        const ins = await pool.query(
          `INSERT INTO brands (name, slug, display_order) VALUES ('Uneek Clothing', 'uneek-clothing', 999) RETURNING id`
        );
        brandId = ins.rows[0]?.id;
      } catch (e) {
        if (e.code === '23505') {
          brandId = (await pool.query("SELECT id FROM brands WHERE slug = 'uneek-clothing'")).rows[0]?.id;
        } else throw e;
      }
    }

    // 3. Resolve product_type_id and category_id from mapping (with fuzzy match)
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

    // 4. Load UNEEK JSON
    const uneekProducts = JSON.parse(fs.readFileSync(UNEEK_JSON, 'utf8'));
    const byStyle = {};
    for (const p of uneekProducts) {
      const code = p.ProductCode;
      if (!byStyle[code]) byStyle[code] = { style: p, skus: [] };
      byStyle[code].skus.push(p);
    }

    console.log('UNEEK styles:', Object.keys(byStyle).length, '| SKUs:', uneekProducts.length);

    // 5. Insert styles
    const client = await pool.connect();
    let stylesInserted = 0;
    let productsInserted = 0;

    try {
      for (const [productCode, { style: first, skus }] of Object.entries(byStyle)) {
        if (stylesInserted > 0 && stylesInserted % 20 === 0) console.log('  Processed', stylesInserted, 'styles...');
        const productTypeId = resolveProductType(first.Category);
        const genderId = resolveGender(first.Gender);
        const ageGroupId = resolveAgeGroup(first.Category);

        const styleExists = (await client.query('SELECT 1 FROM styles WHERE style_code = $1', [productCode])).rows[0];
        if (styleExists) {
          await client.query(
            `UPDATE styles SET style_name = $2, brand_id = $3, product_type_id = $4, gender_id = $5, age_group_id = $6,
             fabric_description = $7, specification = $8, supplier_id = $9, external_style_code = $10 WHERE style_code = $1`,
            [
              productCode,
              first.ProductName || productCode,
              brandId,
              productTypeId,
              genderId,
              ageGroupId,
              first.Composition || null,
              first.Specifications || null,
              uneekSupplierId,
              productCode,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO styles (style_code, style_name, brand_id, product_type_id, gender_id, age_group_id, 
              fabric_description, specification, supplier_id, external_style_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              productCode,
              first.ProductName || productCode,
              brandId,
              productTypeId,
              genderId,
              ageGroupId,
              first.Composition || null,
              first.Specifications || null,
              uneekSupplierId,
              productCode,
            ]
          );
        }
        stylesInserted++;

        const sportId = resolveSport(first.Category);
        const categoryId = resolveCategory(first.Category);

        for (const sku of skus) {
          const sizeId = resolveSize(sku.Size);
          const colourId = await resolveColour(client, sku.Colour, sku.Hex);

          const singlePrice = parseFloat(sku.PriceSingle ?? sku.MyPrice ?? 0) || 0;
          const cartonPrice = parseFloat(sku.PriceCaton ?? sku.PriceCarton ?? 0) || null;

          let r;
          try {
            r = await client.query(
              `INSERT INTO products (style_code, sku_code, colour_name, primary_colour, colour_id, size_id,
                single_price, pack_price, carton_price, sell_price, primary_image_url, colour_image_url, sku_status, external_sku)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Live', $13)
               RETURNING id`,
            [
              productCode,
              sku.ShortCode,
              sku.Colour,
              sku.Colour,
              colourId,
              sizeId,
              singlePrice,
              parseFloat(sku.PricePack) || null,
              cartonPrice,
              singlePrice,  // sell_price placeholder; run reprice after merge
              sku.Image || sku.ColourImage,
              sku.ColourImage || sku.Image,
              sku.EAN || sku.ShortCode,
            ]
            );
          } catch (insertErr) {
            console.error('Insert failed for', productCode, sku.ShortCode, ':', insertErr.message);
            if (insertErr.constraint) console.error('  Constraint:', insertErr.constraint);
            if (insertErr.detail) console.error('  Detail:', insertErr.detail);
            throw insertErr;
          }

          if (r.rows?.[0]) {
            productsInserted++;
            const productId = r.rows[0].id;

            // product_categories
            try {
              await client.query(
                `INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)`,
                [productId, categoryId]
              );
            } catch (e) {
              if (e.code !== '23505') throw e;  // ignore duplicate
            }

            // product_sports (if rugby/sportswear)
            if (sportId) {
              try {
                await client.query(
                  `INSERT INTO product_sports (product_id, sport_id) VALUES ($1, $2)`,
                  [productId, sportId]
                );
              } catch (e) {
                if (e.code !== '23505') throw e;
              }
            }
          }
        }
      }

      console.log('Styles inserted/updated:', stylesInserted);
      console.log('Products inserted:', productsInserted);
    } catch (e) {
      console.error('Merge failed:', e.message);
      if (e.detail) console.error('Detail:', e.detail);
      if (e.constraint) console.error('Constraint:', e.constraint);
      throw e;
    } finally {
      client.release();
    }

    // 6. Check products table for unique constraint on sku_code
    // (schema might have UNIQUE on sku_code - if so ON CONFLICT will skip dupes)
    console.log('\nMerge complete on', BACKUP_DB.database);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
