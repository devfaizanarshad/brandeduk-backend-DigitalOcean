#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { normalizePencarrieRow } = require('./lib/supplier-adapters');
const { ALLOWED_PENCARRIE_BRANDS } = require('../services/catalogInsertService');

function parseArgs(argv) {
  const options = {
    source: '',
    apiBase: process.env.API_BASE || 'https://api.brandeduk.com',
    apply: false,
    concurrency: 2
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') options.source = argv[++index] || '';
    else if (arg === '--api-base') options.apiBase = argv[++index] || options.apiBase;
    else if (arg === '--concurrency') options.concurrency = Number(argv[++index]);
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.source) throw new Error('--source is required');
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 3) {
    throw new Error('--concurrency must be an integer from 1 to 3');
  }
  options.source = path.resolve(options.source);
  if (!fs.existsSync(options.source)) throw new Error(`Source file not found: ${options.source}`);
  return options;
}

async function apiRequest(apiBase, route, options = {}) {
  const response = await fetch(`${apiBase}${route}`, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${route} returned ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

async function login(options) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  const response = await apiRequest(options.apiBase, '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const token = response?.data?.token || response?.token;
  if (!token) throw new Error('Login response did not contain a token');
  return token;
}

async function fetchExistingStyles(options, token) {
  const styles = new Set();
  for (let offset = 0; ; offset += 500) {
    const page = await apiRequest(options.apiBase, `/api/admin/styles?limit=500&offset=${offset}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    for (const row of page.items || []) styles.add(String(row.style_code || '').trim().toUpperCase());
    if ((page.items || []).length < 500) break;
  }
  return styles;
}

async function readSelectedStyles(source) {
  const styles = new Map();
  const parser = parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true
  });
  parser.on('readable', () => {
    let row;
    while ((row = parser.read()) !== null) {
      const brand = String(row.Brand || '').trim();
      if (!ALLOWED_PENCARRIE_BRANDS.has(brand)) continue;
      const record = normalizePencarrieRow(row);
      if (!styles.has(record.styleCode)) styles.set(record.styleCode, []);
      styles.get(record.styleCode).push(record);
    }
  });
  await new Promise((resolve, reject) => {
    parser.on('end', resolve);
    parser.on('error', reject);
    fs.createReadStream(source).pipe(parser);
  });
  return styles;
}

function buildPayload(records) {
  const first = records[0];
  return {
    style: {
      styleCode: first.styleCode,
      externalStyleCode: first.externalStyleCode,
      styleName: first.styleName,
      brand: first.brand,
      productType: first.productType?.name,
      gender: first.gender,
      ageGroup: first.ageGroup,
      fabricDescription: first.fabricDescription,
      specification: first.specification
    },
    products: records.map(record => ({
      styleCode: record.styleCode,
      skuCode: record.skuCode,
      externalSku: record.externalSku,
      colourName: record.colourName,
      primaryColour: record.primaryColour,
      colourShade: record.colourShade,
      colourHex: record.colourHex,
      size: record.size,
      sizeOrder: record.sizeOrder,
      status: record.status,
      cartonPrice: record.cartonPrice,
      packPrice: record.packPrice,
      singlePrice: record.singlePrice,
      primaryImageUrl: record.primaryImageUrl,
      colourImageUrl: record.colourImageUrl,
      stockQuantity: record.stockQuantity
    }))
  };
}

function summarize(styles, existingStyles) {
  const byBrand = new Map();
  let missingStyles = 0;
  let missingSkus = 0;
  for (const [styleCode, records] of styles) {
    const brand = records[0].brand;
    if (!byBrand.has(brand)) byBrand.set(brand, { brand, csvStyles: 0, existingStyles: 0, missingStyles: 0, missingSkus: 0 });
    const row = byBrand.get(brand);
    row.csvStyles += 1;
    if (existingStyles.has(styleCode)) row.existingStyles += 1;
    else {
      row.missingStyles += 1;
      row.missingSkus += records.length;
      missingStyles += 1;
      missingSkus += records.length;
    }
  }
  return { missingStyles, missingSkus, brands: [...byBrand.values()].sort((a, b) => a.brand.localeCompare(b.brand)) };
}

async function runWorkers(items, concurrency, worker) {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = await login(options);
  console.log('Reading selected Pencarrie brands...');
  const [styles, existingStyles] = await Promise.all([
    readSelectedStyles(options.source),
    fetchExistingStyles(options, token)
  ]);
  const summary = summarize(styles, existingStyles);
  console.log(JSON.stringify(summary, null, 2));
  if (!options.apply) {
    console.log('DRY_RUN_COMPLETE No database changes made. Pass --apply to import missing styles.');
    return;
  }

  const missing = [...styles].filter(([styleCode]) => !existingStyles.has(styleCode));
  let insertedStyles = 0;
  let insertedSkus = 0;
  let skippedStyles = 0;
  const failures = [];
  await runWorkers(missing, options.concurrency, async ([styleCode, records], index) => {
    try {
      const result = await apiRequest(options.apiBase, '/api/admin/catalog-import/missing-style', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(records))
      });
      if (result.status === 'inserted') {
        insertedStyles += 1;
        insertedSkus += Number(result.insertedProducts) || 0;
      } else skippedStyles += 1;
    } catch (error) {
      failures.push({ styleCode, error: error.message });
    }
    const complete = index + 1;
    if (complete % 25 === 0 || complete === missing.length) {
      console.log(`PROGRESS ${complete}/${missing.length} insertedStyles=${insertedStyles} insertedSkus=${insertedSkus} skipped=${skippedStyles} failures=${failures.length}`);
    }
  });

  if (failures.length) {
    console.error(JSON.stringify({ failures }, null, 2));
    throw new Error(`${failures.length} styles failed; rerun the same command to resume safely`);
  }
  await apiRequest(options.apiBase, '/api/admin/catalog-import/finalize', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}'
  });
  console.log(JSON.stringify({ insertedStyles, insertedSkus, skippedStyles, failures: 0 }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
