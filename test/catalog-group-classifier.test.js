const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG_GROUPS, classifyCatalogGroups } = require('../services/catalogGroupClassifier');

test('defines every requested Ralawise sector and collection', () => {
  assert.equal(CATALOG_GROUPS.filter(group => group.type === 'sector').length, 9);
  assert.equal(CATALOG_GROUPS.filter(group => group.type === 'collection').length, 14);
});

test('classifies multiple sectors and collections from Categorisation', () => {
  const groups = classifyCatalogGroups({
    Categorisation: 'Workwear|Aprons & Service|The Heavyweight Collection|Rebrandable'
  });
  assert.deepEqual(
    groups.map(group => `${group.type}:${group.slug}`),
    [
      'sector:workwear',
      'sector:aprons-service',
      'collection:heavyweight',
      'collection:rebrandable'
    ]
  );
});

test('maps Ralawise feed aliases to customer-facing collection names', () => {
  const groups = classifyCatalogGroups({
    Categorisation: "Safetywear|Junior|Petwear & Accessories 2026|Safe to wash at 60 degrees|Women's Fashion|Zipped Styles - 1/2 & 1/4"
  });
  assert.deepEqual(
    groups.map(group => group.slug),
    [
      'safetywear-hi-vis',
      'juniors',
      'petwear-accessories',
      'washable-at-60-degrees',
      'womens',
      'quarter-half-zip'
    ]
  );
});
