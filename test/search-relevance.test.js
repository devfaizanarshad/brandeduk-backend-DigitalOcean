const test = require('node:test');
const assert = require('node:assert/strict');

const databasePath = require.resolve('../config/database');
const parserPath = require.resolve('../services/search/searchQueryParser');
const synonymsPath = require.resolve('../services/search/searchSynonyms');
const servicePath = require.resolve('../services/search/searchService');

const rowsForQuery = sql => {
  if (sql.includes('FROM brands')) return [{ name: 'Pro RTX' }];
  if (sql.includes('FROM product_types')) return [
    { name: 'Hooded Sweatshirts' },
    { name: 'Vests (t-shirt)' },
    { name: 'Hi Vis' }
  ];
  if (sql.includes('FROM style_keywords')) return [
    { name: 'Zipped', slug: 'zipped', keyword_type: 'feature' },
    { name: 'Waterproof', slug: 'waterproof', keyword_type: 'feature' },
    { name: 'Heavyweight', slug: 'heavyweight', keyword_type: 'feature' },
    { name: 'Quarter Zip', slug: 'quarter-zip', keyword_type: 'style' }
  ];
  if (sql.includes('FROM fabrics')) return [{ name: 'Organic', slug: 'organic' }];
  if (sql.includes('FROM related_sectors')) return [{ name: 'Workwear', slug: 'workwear' }];
  if (sql.includes('primary_colour')) return [{ name: 'Black' }, { name: 'Navy' }];
  if (sql.includes('FROM related_sports')) return [];
  if (sql.includes('FROM genders')) return [
    { name: "Men's", slug: 'mens' },
    { name: "Women's", slug: 'womens' },
    { name: 'Kids', slug: 'kids' }
  ];
  if (sql.includes('FROM search_synonyms')) return [
    { term: 'hoodie', canonical: 'hooded sweatshirt', synonym_type: 'product_type' },
    { term: 'hoodies', canonical: 'hooded sweatshirts', synonym_type: 'product_type' },
    { term: 'zip', canonical: 'zipped', synonym_type: 'attribute' },
    { term: 'mens', canonical: 'mens', synonym_type: 'gender' },
    { term: 'quarter zip', canonical: 'quarter-zip', synonym_type: 'attribute' },
    { term: 'hivis', canonical: 'hi-vis', synonym_type: 'colour' },
    { term: 'vest', canonical: 'vests (t-shirt)', synonym_type: 'product_type' }
  ];
  return [];
};

require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    queryWithTimeout: async sql => ({ rows: rowsForQuery(sql) })
  }
};

delete require.cache[parserPath];
delete require.cache[synonymsPath];
delete require.cache[servicePath];

const { parseSearchQuery } = require(parserPath);
const { buildSearchConditions, prefixTsQuery } = require(servicePath);

test('parser separates strict identity filters from descriptive signals', async () => {
  const parsed = await parseSearchQuery('mens black organic zip hoodies');

  assert.equal(parsed.productType, 'hooded sweatshirts');
  assert.deepEqual(parsed.genders, ['mens']);
  assert.deepEqual(parsed.colours, ['black']);
  assert.deepEqual(parsed.fabrics, ['organic']);
  assert.deepEqual(parsed.features, ['zipped']);
  assert.deepEqual(parsed.freeText, []);
});

test('multiple descriptors use controlled OR matching with exact-match ranking', async () => {
  const search = await buildSearchConditions('waterproof zip hoodies');
  const where = search.conditions.join(' AND ');

  assert.match(where, /product_types/);
  assert.match(where, /feature_slugs/);
  assert.match(where, / OR /);
  assert.match(search.relevanceSelect, /THEN 120/);
  assert.deepEqual(search.params.filter(Array.isArray), [['waterproof'], ['zipped']]);
});

test('one descriptor remains a required match', async () => {
  const search = await buildSearchConditions('zip hoodies');
  const featureConditions = search.conditions.filter(condition => condition.includes('feature_slugs'));

  assert.equal(featureConditions.length, 1);
  assert.doesNotMatch(featureConditions[0], / OR /);
});

test('prefix tsquery safely broadens unclassified words', () => {
  assert.equal(prefixTsQuery(['full-zip', 'hoodie']), 'fullzip:* | hoodie:*');
});

test('hi-vis vest resolves to safetywear instead of fashion vests', async () => {
  const parsed = await parseSearchQuery('hivis vest');

  assert.equal(parsed.productType, 'hi vis');
  assert.deepEqual(parsed.colours, []);
  assert.deepEqual(parsed.freeText, ['vest', 'waistcoat']);
});
