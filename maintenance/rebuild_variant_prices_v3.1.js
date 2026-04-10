const { Pool } = require('pg');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'brandeduk_ralawise_backup',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && i + 1 < line.length && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out.map(val => {
    if (val.startsWith('"') && val.endsWith('"') && val.length > 1) return val.slice(1, -1);
    return val;
  });
}

async function rebuild() {
  console.log('--- STARTING CLEAN REBUILD V3.1 ---');
  
  const rulesRes = await pool.query('SELECT from_price, to_price, markup_percent FROM pricing_rules WHERE active=true ORDER BY from_price');
  const rules = rulesRes.rows.map(r => ({ min: parseFloat(r.from_price), max: parseFloat(r.to_price), markup: parseFloat(r.markup_percent) / 100 }));

  const overridesRes = await pool.query('SELECT style_code, markup_percent FROM product_markup_overrides');
  const overridesMap = new Map();
  overridesRes.rows.forEach(r => overridesMap.set(r.style_code, parseFloat(r.markup_percent) / 100));

  function calcSellPrice(basePrice, styleCode) {
    if (!basePrice || basePrice === 0) return 0;
    const ov = overridesMap.get(styleCode);
    if (ov !== undefined) return basePrice * (1 + ov);
    const rule = rules.find(r => basePrice >= r.min && basePrice <= r.max);
    return rule ? basePrice * (1 + rule.markup) : basePrice;
  }

  async function flushBatch(batch, label) {
    if (batch.length === 0) return 0;
    const valuesStrings = [];
    const args = [];
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i];
      const offset = i * 5;
      valuesStrings.push(`($${offset + 1}::text, $${offset + 2}::numeric, $${offset + 3}::numeric, $${offset + 4}::numeric, $${offset + 5}::numeric)`);
      args.push(b.sku, b.single, b.pack, b.carton, b.sell);
    }
    const query = `
      UPDATE products p
      SET single_price = v.single, pack_price = v.pack, carton_price = v.carton, sell_price = ROUND(v.sell, 2),
          pricing_version = 'REBUILD_V3.1', last_priced_at = NOW()
      FROM (VALUES ${valuesStrings.join(',')}) AS v(sku, single, pack, carton, sell)
      WHERE p.sku_code = v.sku;
    `;
    const res = await pool.query(query, args);
    return res.rowCount;
  }

  // Paths relative to execution root
  const absPath = 'absolute_products_clean.json';
  const uneekPath = 'BRA52-UneekProdData.csv';
  const ralaPath = 'ProductDataFull.csv';

  // Absolute
  if (fs.existsSync(absPath)) {
    console.log('Processing Absolute...');
    const data = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const products = data.products || (Array.isArray(data) ? data[0].products : []);
    let batch = []; let updated = 0;
    for (const prod of products) {
      for (const v of (prod.SKUs || [])) {
        const sku = v.StockCode;
        const price = parseFloat(v.Price);
        if (sku && !isNaN(price)) {
          batch.push({ sku, single: price, pack: price, carton: price, sell: calcSellPrice(price, prod.ProductCode) });
          if (batch.length >= 500) { updated += await flushBatch(batch, 'Absolute'); batch = []; }
        }
      }
    }
    updated += await flushBatch(batch, 'Absolute');
    console.log('Absolute updated:', updated);
  }

  // Uneek
  if (fs.existsSync(uneekPath)) {
    console.log('Processing Uneek...');
    const lines = fs.readFileSync(uneekPath, 'utf8').split(/\r?\n/);
    let h = {}; lines[0].split(',').forEach((t, i) => h[t.trim()] = i);
    let batch = []; let updated = 0;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const v = parseCSVLine(line);
      const sku = v[h['Short Code']];
      if (sku) {
        const single = parseFloat(v[h['Price Single']] || v[h['MyPrice']]);
        const style = v[h['Product Code']];
        batch.push({ sku, single: isNaN(single) ? 0 : single, 
                     pack: parseFloat(v[h['Price Pack']]) || 0, 
                     carton: parseFloat(v[h['Price Caton']]) || 0, 
                     sell: calcSellPrice(isNaN(single) ? 0 : single, style) });
        if (batch.length >= 500) { updated += await flushBatch(batch, 'Uneek'); batch = []; }
      }
    }
    updated += await flushBatch(batch, 'Uneek');
    console.log('Uneek updated:', updated);
  }

  // Ralawise
  if (fs.existsSync(ralaPath)) {
    console.log('Processing Ralawise...');
    const rl = readline.createInterface({ input: fs.createReadStream(ralaPath, { encoding: 'latin1' }), crlfDelay: Infinity });
    let h = {}; let isHeader = true; let batch = []; let updated = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      const vals = parseCSVLine(line);
      if (isHeader) { vals.forEach((t, i) => h[t.trim()] = i); isHeader = false; continue; }
      const sku = vals[h['Sku Code']];
      if (sku) {
        const single = parseFloat(vals[h['Single Price']]) || 0;
        const carton = parseFloat(vals[h['Carton Price']]) || 0;
        const sellBase = (carton > 0) ? carton : single;
        batch.push({ sku, single, pack: parseFloat(vals[h['Pack Price']]) || 0, carton, sell: calcSellPrice(sellBase, vals[h['Style Code']]) });
        if (batch.length >= 1000) { 
           updated += await flushBatch(batch, 'Ralawise'); 
           batch = []; 
           if (updated % 10000 === 0) console.log('Ralawise...', updated); 
        }
      }
    }
    updated += await flushBatch(batch, 'Ralawise');
    console.log('Ralawise updated:', updated);
  }

  console.log('Refreshing materialized view...');
  try {
    await pool.query('REFRESH MATERIALIZED VIEW product_search_mv');
    console.log('Final view refresh complete.');
  } catch (err) {
    console.warn('View refresh timed out or failed, but pricing data is saved.');
  }
  
  await pool.end();
  console.log('V3.1 Final Done!');
}
rebuild().catch(console.error);
