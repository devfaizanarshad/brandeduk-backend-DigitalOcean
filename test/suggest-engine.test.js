const test = require('node:test');
const assert = require('node:assert/strict');

const { createIndex, suggestFromIndex, tokenize, pluralizeDisplay } = require('../services/search/suggestEngine');

function style(code, name, extra = {}) {
  return {
    style_code: code,
    style_name: name,
    brand: extra.brand || 'Acme',
    brand_slug: (extra.brand || 'Acme').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    type_name: extra.type || null,
    type_slug: extra.type ? extra.type.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null,
    gender: extra.gender || 'unisex',
    age: extra.age || 'adult',
    is_best_seller: !!extra.bestSeller,
    is_featured: false,
    is_recommended: false,
    price: extra.price || 5,
    image: `https://img.example/${code}.jpg`,
    colours: extra.colourNames ? extra.colourNames.length : 3,
    colour_names: extra.colourNames || ['black', 'white', 'red']
  };
}

const catalogue = {
  styles: [
    style('JH001', 'College hoodie', { brand: 'AWDis Just Hoods', type: 'Hoodies', bestSeller: true }),
    style('JH003', 'Varsity hoodie', { brand: 'AWDis Just Hoods', type: 'Hoodies' }),
    style('JH01F', "Women's college hoodie", { brand: 'AWDis Just Hoods', type: 'Hoodies', gender: 'female' }),
    style('JH03F', "Women's varsity hoodie", { brand: 'AWDis Just Hoods', type: 'Hoodies', gender: 'female' }),
    style('ZH20F', "Women's zip hoodie", { brand: 'Gildan', type: 'Hoodies', gender: 'female' }),
    style('JH01J', 'Kids hoodie', { brand: 'AWDis Just Hoods', type: 'Hoodies', age: 'kids' }),
    style('MH100', "Men's zip hoodie", { brand: 'Gildan', type: 'Hoodies', gender: 'male' }),
    style('ZH200', 'Zip hoodie', { brand: 'Gildan', type: 'Hoodies' }),
    style('ZH201', 'Organic zip hoodie', { brand: 'Gildan', type: 'Hoodies' }),
    style('ZH202', 'Heavy zip hoodie', { brand: 'Gildan', type: 'Hoodies', colourNames: ['navy', 'black'] }),
    style('GD010', 'Softstyle v-neck t-shirt', { brand: 'Gildan', type: 'T-shirts' }),
    style('KB357', "Men's V-neck T-shirt", { brand: 'Kariban', type: 'T-shirts', gender: 'male' }),
    style('KB381', "Ladies' V-neck T-shirt", { brand: 'Kariban', type: 'T-shirts', gender: 'female' }),
    style('SS030', 'Valueweight T', { brand: 'Fruit of the Loom', type: 'T-shirts', bestSeller: true }),
    style('GD002', 'Ultra Cotton adult t-shirt', { brand: 'Gildan', type: 'T-shirts' }),
    style('GD005', 'Heavy Cotton adult tee', { brand: 'Gildan', type: 'T-shirts' }),
    style('AM010', 'Anthem t-shirt', { brand: 'Anthem', type: 'T-shirts' }),
    style('PW039', 'Expertbase safety helmet (PW50)', { brand: 'Portwest', type: 'Headwear' }),
    style('BC090', 'Organic cotton bucket hat', { brand: 'Beechfield', type: 'Hats' }),
    style('BC088', 'Cargo bucket hat', { brand: 'Beechfield', type: 'Hats' }),
    style('BC688', 'Vintage bucket hat', { brand: 'Beechfield', type: 'Hats' }),
    style('BC015', 'Ultimate 5-panel cap', { brand: 'Beechfield', type: 'Caps', colourNames: ['navy', 'red'] }),
    style('BC010', 'Original 5-panel cap', { brand: 'Beechfield', type: 'Caps', colourNames: ['black'] }),
    style('YP004', 'Fitted baseball cap', { brand: 'Flexfit', type: 'Caps', colourNames: ['white'] }),
    style('YK001', 'Hi-vis waistcoat (HVW100)', { brand: 'Yoko', type: 'Hi Vis' }),
    style('YK046', 'Hi-vis security jacket (HVP301)', { brand: 'Yoko', type: 'Hi Vis' }),
    style('UC804', 'Hi Vis Bomber Jacket', { brand: 'Uneek', type: 'Hi Vis' }),
    style('PW003', 'Hi-vis traffic jacket (S460)', { brand: 'Portwest', type: 'Hi Vis' }),
    style('RX770', 'High visibility bomber jacket', { brand: 'Result', type: 'Hi Vis' }),
    style('TS015', 'Bodywarmer', { brand: 'Tee Jays', type: 'Gilets & Body Warmers' }),
    style('RE37A', 'PolarTherm body warmer', { brand: 'Result', type: 'Gilets & Body Warmers' }),
    style('R244X', 'Promo padded bodywarmer', { brand: 'Result', type: 'Gilets & Body Warmers' })
  ],
  keywords: ['Organic', 'Recycled'],
  synonyms: [{ term: 'hoody', canonical: 'hoodies', synonym_type: 'product_type' }]
};

const index = createIndex(catalogue);
const run = (query, options) => suggestFromIndex(index, query, options);
const codes = payload => payload.products.map(product => product.code);
const labels = payload => payload.suggestions.map(chip => chip.label);

test('t-shirt spellings normalise to one term', () => {
  const term = text => tokenize(text).map(token => token.term).join(' ');
  assert.equal(term('T-Shirt'), 'tshirt');
  assert.equal(term('t shirts'), 'tshirt');
  assert.equal(term('tshirt'), 'tshirt');
  assert.equal(term('tees'), 'tshirt');
  assert.equal(term('Body Warmers'), 'bodywarmer');
  assert.equal(term('hi-viz'), 'hivis');
});

test('suggestion text is pluralised like a shop category', () => {
  assert.equal(pluralizeDisplay('v-neck t-shirt'), 'v-neck t-shirts');
  assert.equal(pluralizeDisplay('dress'), 'dresses');
  assert.equal(pluralizeDisplay('trousers'), 'trousers');
  assert.equal(pluralizeDisplay('scarf'), 'scarves');
  assert.equal(pluralizeDisplay('workwear'), 'workwear');
});

test('half-typed queries complete to the most popular phrase (ghost text)', () => {
  const payload = run('t-sh');
  assert.equal(payload.completion, 't-shirts');
  assert.equal(labels(payload)[0], 't-shirts');
  assert.ok(payload.products.length > 0);

  assert.equal(run('hoo').completion, 'hoodies');
});

test('no ghost text once a complete phrase has been typed', () => {
  assert.equal(run('hi vis').completion, null);
});

test('word order does not matter and products follow the top suggestion', () => {
  const payload = run('t-shirt v');
  assert.equal(labels(payload)[0], 'v-neck t-shirts');
  assert.ok(['GD010', 'KB357', 'KB381'].includes(codes(payload)[0]), codes(payload).join(','));
});

test('typos are corrected and reported', () => {
  const payload = run('hoddie');
  assert.equal(payload.correctedQuery, 'hoodie');
  assert.ok(codes(payload).includes('JH001'));
  assert.ok(labels(payload).includes('hoodies'));
});

test('style code prefixes without digits find every matching code', () => {
  const payload = run('JH');
  assert.deepEqual(codes(payload).slice(0, 5).sort(), ['JH001', 'JH003', 'JH01F', 'JH01J', 'JH03F']);
  assert.equal(payload.total, 5);
  assert.equal(run('jh01j').products[0].code, 'JH01J');
});

test('"hard hats" shows the safety helmet first and still lists hats', () => {
  const payload = run('hard hats');
  assert.equal(codes(payload)[0], 'PW039');
  assert.ok(codes(payload).includes('BC090'), 'hats should still be listed after the helmet');
  assert.equal(labels(payload)[0], 'safety helmets');
});

test('gender words prefer that gender but keep unisex products', () => {
  const payload = run('ladies hoodie');
  assert.deepEqual(codes(payload).slice(0, 3).sort(), ['JH01F', 'JH03F', 'ZH20F']);
  assert.ok(codes(payload).includes('JH001'), 'unisex hoodies stay in the list');
  assert.ok(!codes(payload).includes('MH100'), 'men-only hoodies are excluded');
  assert.ok(labels(payload).includes('ladies hoodies'));
});

test('colour words rank products sold in that colour first, other caps follow', () => {
  const payload = run('navy caps');
  assert.equal(codes(payload)[0], 'BC015');
  assert.equal(payload.total, 1);
  assert.ok(codes(payload).indexOf('YP004') > 0, 'caps in other colours still fill the list');
});

test('an unmatched word never empties the list (partial matches fill it)', () => {
  const payload = run('purple hoodie');
  assert.ok(payload.products.length >= 4);
  assert.ok(codes(payload).every(code => /^(JH|MH|ZH)/.test(code)));
});

test('brand prefixes suggest brand categories', () => {
  const payload = run('gild');
  assert.equal(payload.brands[0].label, 'Gildan');
  assert.ok(labels(payload).some(label => label.startsWith('gildan ')));
});

test('compound spellings match both ways', () => {
  assert.ok(codes(run('body warmer')).includes('TS015'));
  assert.ok(codes(run('bodywarmer')).includes('RE37A'));
});

test('gibberish returns an empty, well-formed payload', () => {
  const payload = run('zz123qq');
  assert.deepEqual(payload.products, []);
  assert.deepEqual(payload.suggestions, []);
  assert.equal(payload.total, 0);
});

test('payload keeps the legacy suggest fields for older clients', () => {
  const payload = run('hoodie');
  for (const key of ['brands', 'types', 'keywords', 'products', 'total']) assert.ok(key in payload, key);
  const product = payload.products[0];
  for (const key of ['label', 'value', 'code', 'name', 'image', 'brand', 'price', 'type']) assert.ok(key in product, key);
  assert.equal(payload.keywords[0].type, 'keyword');
});

test('popular searches come from the biggest categories', () => {
  assert.ok(index.popular.length > 0);
  assert.ok(index.popular.every(entry => entry.label && entry.value));
});
