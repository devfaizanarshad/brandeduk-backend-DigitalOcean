'use strict';

const fs = require('fs');
const path = require('path');
const { parseCsvObjects } = require('./stream-csv');
const {
  SUPPLIERS,
  normalizeRalawiseRow,
  normalizeUneekRow,
  normalizeAbsoluteProduct
} = require('./supplier-adapters');

const SOURCE_NAMES = {
  ralawise: 'CustomerDataFull.csv',
  uneek: 'BRA52-UneekProdData.csv',
  'absolute-apparel': 'absolute_products_clean.json'
};

function resolveSourcePath(supplier, explicitPath) {
  if (!SUPPLIERS[supplier]) throw new Error(`Unsupported supplier: ${supplier}`);
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) throw new Error(`Source file does not exist: ${resolved}`);
    return resolved;
  }

  const filename = SOURCE_NAMES[supplier];
  const candidates = [
    path.resolve(process.cwd(), filename),
    path.resolve(process.cwd(), 'Data', filename),
    path.resolve(__dirname, '..', '..', filename),
    path.resolve(__dirname, '..', '..', '..', 'Data', filename)
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Could not find ${filename}. Pass its location with --source <path>.`);
  }
  return found;
}

async function* iterateSupplierRecords(supplier, sourcePath) {
  if (supplier === 'ralawise' || supplier === 'uneek') {
    const normalizer = supplier === 'ralawise' ? normalizeRalawiseRow : normalizeUneekRow;
    for await (const { record, rowNumber } of parseCsvObjects(sourcePath)) {
      yield { record: normalizer(record), rowNumber };
    }
    return;
  }

  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const masters = Array.isArray(parsed) ? parsed : parsed.products;
  if (!Array.isArray(masters)) throw new Error('Absolute Apparel JSON must contain a products array.');
  let rowNumber = 1;
  for (const master of masters) {
    for (const record of normalizeAbsoluteProduct(master)) {
      rowNumber += 1;
      yield { record, rowNumber };
    }
  }
}

module.exports = { SOURCE_NAMES, resolveSourcePath, iterateSupplierRecords };

