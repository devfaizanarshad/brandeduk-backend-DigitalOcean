const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const benefits = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'maintenance', 'data', 'gocustom-bundle-benefits-2026-11-09.json'),
  'utf8',
));

test('stores all PDF bundle inclusion instructions exactly once', () => {
  assert.equal(benefits.length, 94);
  assert.equal(new Set(benefits.map(benefit => benefit.sourceNumber)).size, 94);
  assert.equal(benefits.filter(benefit => benefit.includedDecorationMethods.join(',') === 'print').length, 26);
  assert.equal(benefits.filter(benefit => benefit.includedDecorationMethods.join(',') === 'print,embroidery').length, 68);
  assert.equal(benefits.filter(benefit => benefit.freeDelivery).length, 67);
  assert.equal(benefits.filter(benefit => benefit.includedLogoCount === 1).length, 94);
  assert.equal(benefits.filter(benefit => benefit.logoPosition !== null).length, 0);
  assert.equal(benefits.filter(benefit => benefit.freeGift !== null).length, 0);
});
