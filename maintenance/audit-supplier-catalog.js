#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { resolveSourcePath, iterateSupplierRecords } = require('./lib/catalog-source');

function parseArgs(argv) {
  const options = { supplier: '', source: '', report: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--supplier') options.supplier = String(argv[++index] || '').toLowerCase();
    else if (arg === '--source') options.source = argv[++index] || '';
    else if (arg === '--report') options.report = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function percentage(value, total) {
  return total ? Number(((value / total) * 100).toFixed(2)) : 0;
}

async function audit(options) {
  const sourcePath = resolveSourcePath(options.supplier, options.source);
  const sourceStat = fs.statSync(sourcePath);
  const summary = {
    supplier: options.supplier,
    source: sourcePath,
    sourceBytes: sourceStat.size,
    sourceModifiedAt: sourceStat.mtime.toISOString(),
    sourceSha256: null,
    rows: 0,
    styles: 0,
    liveStyles: 0,
    liveRows: 0,
    discontinuedRows: 0,
    unavailableRows: 0,
    duplicateSkus: 0,
    missing: { styleCode: 0, skuCode: 0, styleName: 0, productType: 0, price: 0, image: 0, fabric: 0, gsm: 0 },
    coverage: {},
    distinct: { brands: 0, productTypes: 0, colours: 0, sizes: 0, fabrics: 0, weights: 0 },
    samples: { duplicateSkus: [], missingPrice: [], missingImage: [] }
  };

  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(sourcePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  summary.sourceSha256 = hash.digest('hex');

  const sets = {
    styles: new Set(), liveStyles: new Set(), skus: new Set(), brands: new Set(), productTypes: new Set(),
    colours: new Set(), sizes: new Set(), fabrics: new Set(), weights: new Set()
  };

  for await (const { record } of iterateSupplierRecords(options.supplier, sourcePath)) {
    summary.rows += 1;
    if (!record.styleCode) summary.missing.styleCode += 1;
    if (!record.skuCode) summary.missing.skuCode += 1;
    if (!record.styleName) summary.missing.styleName += 1;
    if (!record.productType?.slug || record.productType.slug === 'unknown') summary.missing.productType += 1;
    if (!(record.singlePrice > 0 || record.cartonPrice > 0)) {
      summary.missing.price += 1;
      if (summary.samples.missingPrice.length < 10) summary.samples.missingPrice.push(record.skuCode || record.styleCode);
    }
    if (!record.primaryImageUrl && !record.colourImageUrl) {
      summary.missing.image += 1;
      if (summary.samples.missingImage.length < 10) summary.samples.missingImage.push(record.skuCode || record.styleCode);
    }
    if (!record.fabrics.length) summary.missing.fabric += 1;
    if (!record.weightRange) summary.missing.gsm += 1;

    if (record.status === 'Live') {
      summary.liveRows += 1;
      if (record.styleCode) sets.liveStyles.add(record.styleCode.toUpperCase());
    }
    else if (record.status === 'Discontinued') summary.discontinuedRows += 1;
    else summary.unavailableRows += 1;

    if (record.styleCode) sets.styles.add(record.styleCode.toUpperCase());
    if (record.skuCode) {
      const sku = record.skuCode.toUpperCase();
      if (sets.skus.has(sku)) {
        summary.duplicateSkus += 1;
        if (summary.samples.duplicateSkus.length < 10) summary.samples.duplicateSkus.push(sku);
      }
      sets.skus.add(sku);
    }
    if (record.brand) sets.brands.add(record.brand);
    if (record.productType?.slug) sets.productTypes.add(record.productType.slug);
    if (record.colourName) sets.colours.add(record.colourName);
    if (record.size) sets.sizes.add(record.size);
    for (const fabric of record.fabrics) sets.fabrics.add(fabric.slug);
    if (record.weightRange) sets.weights.add(record.weightRange.slug);
  }

  summary.styles = sets.styles.size;
  summary.liveStyles = sets.liveStyles.size;
  summary.distinct = {
    brands: sets.brands.size,
    productTypes: sets.productTypes.size,
    colours: sets.colours.size,
    sizes: sets.sizes.size,
    fabrics: sets.fabrics.size,
    weights: sets.weights.size
  };
  summary.coverage = {
    validPrice: percentage(summary.rows - summary.missing.price, summary.rows),
    usableImage: percentage(summary.rows - summary.missing.image, summary.rows),
    normalizedFabric: percentage(summary.rows - summary.missing.fabric, summary.rows),
    normalizedGsm: percentage(summary.rows - summary.missing.gsm, summary.rows)
  };

  const fatalProblems = summary.missing.styleCode + summary.missing.skuCode + summary.duplicateSkus;
  summary.preflight = fatalProblems === 0 ? 'PASS' : 'FAIL';
  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.supplier) {
    console.log('Usage: node maintenance/audit-supplier-catalog.js --supplier ralawise|uneek|absolute-apparel [--source path] [--report path]');
    process.exit(options.help ? 0 : 1);
  }

  const summary = await audit(options);
  const output = JSON.stringify(summary, null, 2);
  console.log(output);
  if (options.report) fs.writeFileSync(options.report, `${output}\n`, 'utf8');
  if (summary.preflight !== 'PASS') process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`CATALOG_AUDIT_FAILED ${error.message}`);
    process.exit(1);
  });
}

module.exports = { audit, parseArgs };
