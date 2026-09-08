'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  colourHex,
  primaryColour,
  colourShade,
  extractGsm,
  weightRange,
  normalizeFabrics,
  extractKeywords,
  sizeOrder,
  slugify
} = require('../maintenance/lib/catalog-normalization');
const {
  normalizeRalawiseRow,
  normalizeUneekRow,
  absoluteProductType
} = require('../maintenance/lib/supplier-adapters');

test('normalizes exact colours without leaking shades into primary colour', () => {
  assert.equal(primaryColour('Burgundy', 'Red'), 'Red');
  assert.equal(primaryColour('Navy/White'), 'Blue');
  assert.equal(colourShade('Burgundy', 'Red - Burgundy', 'Red'), 'Red - Burgundy');
  assert.equal(colourHex('51 51 51'), '#333333');
  assert.equal(colourHex('#aabbcc'), '#AABBCC');
});

test('uses the live catalogue punctuation convention for lookup slugs', () => {
  assert.equal(slugify("AWDis Just T's"), 'awdis-just-ts');
  assert.equal(slugify('B&C Collection'), 'bc-collection');
  assert.equal(slugify('Stanley/Stella'), 'stanleystella');
});

test('extracts filter-ready fabrics, weights and keywords', () => {
  assert.equal(extractGsm('150gsm'), 150);
  assert.equal(weightRange(150).slug, '101-150gsm');
  assert.deepEqual(normalizeFabrics('100% organic cotton, 20% recycled polyester').map(x => x.slug), [
    'organic-cotton-100', 'recycled-polyester-blend'
  ]);
  const keywords = extractKeywords('Heavyweight long sleeve crew neck tee with pocket');
  assert.ok(keywords.some(item => item.slug === 'long-sleeve' && item.type === 'sleeve'));
  assert.ok(keywords.some(item => item.slug === 'crew-neck' && item.type === 'neckline'));
  assert.ok(keywords.some(item => item.slug === 'pocket' && item.type === 'feature'));
  assert.ok(sizeOrder('S') < sizeOrder('2XL'));
});

test('Ralawise adapter preserves the supplier record and creates canonical filters', () => {
  const record = normalizeRalawiseRow({
    'Style Code': 'AT002', 'Manufacturer Style Code': 'AT002', 'Sku Code': 'AT002BURGXS',
    'Style Name': 'The AWDis 180 T', Brand: 'AWDis', 'Product Type': 'T-Shirts',
    Gender: 'Unisex', 'Age Group': 'Adult', Fabric: 'Cotton (100%)', 'Weight (GSM)': '180gsm',
    'Colour Name': 'Burgundy', 'Primary Colour': 'Red', 'Colour Shade': 'Red - Burgundy',
    'Size Name': 'XS', 'Sku Status': 'Live', 'Carton Price': '3.50', 'Single Price': '6.60',
    RGB: '94 16 43', 'Primary Product Image URL': 'https://example.test/model.jpg',
    'Colour Image': 'https://example.test/colour.jpg'
  });
  assert.equal(record.styleCode, 'AT002');
  assert.equal(record.productType.slug, 'tshirts');
  assert.equal(record.primaryColour, 'Red');
  assert.equal(record.colourShade, 'Red - Burgundy');
  assert.equal(record.gsm, 180);
  assert.equal(record.weightRange.slug, '151-200gsm');
  assert.equal(record.fabrics[0].slug, 'cotton-100');
});

test('Uneek product names override overly broad supplier categories', () => {
  const record = normalizeUneekRow({
    Category: 'Jackets', 'Product Code': 'UC640', 'Short Code': 'UC640BKXS',
    'Product Name': 'Classic bodywarmer', Company: 'Uneek Clothing', Gender: 'Unisex',
    GSM: '300', Composition: '100% Polyester', Colour: 'Black', Size: 'XS',
    'Price Single': '10', 'Model Large Image': 'https://example.test/model.webp'
  });
  assert.equal(record.productType.slug, 'gilets-body-warmers');
});

test('Absolute Apparel garment families are not silently dropped or misclassified', () => {
  assert.equal(absoluteProductType('Sweats Crew Neck - 300gsm - 335gsm Mens (Unisex)'), 'Sweatshirts');
  assert.equal(absoluteProductType('Zip Hoodies - 300gsm - 335gsm Mens (Unisex)'), 'Hoodies');
  assert.equal(absoluteProductType('Outdoor Fleece Bodywarmers - 220gsm'), 'Gilets & Body Warmers');
  assert.equal(absoluteProductType('Workwear - Hi Visibility Vests - 120gsm'), 'Safety Vests');
  assert.equal(absoluteProductType('Consumables - Packaging'), null);
});
