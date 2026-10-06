const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCustomizationTemplate } = require('../services/customizationTemplateResolver');
const configuredTemplates = require('../maintenance/customization-63-categories.json');

const cases = [
  ['Classic short sleeve T-shirt', 'T-Shirts', 'tshirts', 'short-sleeve'],
  ['Classic long sleeve T-shirt', 'T-Shirts', 'tshirts', 'long-sleeve'],
  ['Short sleeve polo', 'Polos', 'polos', 'short-sleeve'],
  ['Long sleeve polo', 'Polos', 'polos', 'long-sleeve'],
  ['Classic crew neck sweatshirt', 'Sweatshirts', 'sweatshirts', 'crewneck'],
  ['Pullover hoodie', 'Hoodies', 'hoodies', 'pullover'],
  ['Full zip hoodie', 'Hoodies', 'hoodies', 'full-zip'],
  ['Quarter zip sweatshirt', 'Sweatshirts', 'sweatshirts', 'quarter-zip'],
  ['Full zip fleece', 'Fleece', 'fleece', 'full-zip'],
  ['Quarter zip fleece', 'Fleece', 'fleece', 'quarter-zip'],
  ['Classic softshell jacket', 'Softshells', 'softshells', 'softshell-jacket'],
  ['Waterproof parka jacket', 'Jackets', 'jackets', 'waterproof-parka'],
  ['Classic bomber jacket', 'Jackets', 'jackets', 'bomber'],
  ['Padded puffer jacket', 'Jackets', 'jackets', 'padded-puffer'],
  ['Essential workwear jacket', 'Jackets', 'jackets', 'workwear'],
  ['Classic bodywarmer', 'Gilets & Body Warmers', 'gilets-body-warmers', 'standard'],
  ['Padded bodywarmer', 'Gilets & Body Warmers', 'gilets-body-warmers', 'padded'],
  ['Hi-vis vest waistcoat', 'Hi Vis', 'safety-vests', 'waistcoat'],
  ['Hi-vis T-shirt', 'T-Shirts', 'tshirts', 'hi-vis-tshirt'],
  ['Hi-vis polo', 'Polos', 'polos', 'hi-vis-polo'],
  ['Hi-vis sweatshirt', 'Sweatshirts', 'sweatshirts', 'hi-vis-sweatshirt'],
  ['Hi-vis hoodie', 'Hoodies', 'hoodies', 'hi-vis-hoodie'],
  ['Hi-vis bomber jacket', 'Jackets', 'jackets', 'hi-vis-jacket'],
  ['Hi-vis two-tone thermal bodywarmer', 'Gilets & Body Warmers', 'gilets-body-warmers', 'hi-vis-bodywarmer'],
  ['Short sleeve work shirt', 'Shirts', 'shirts', 'short-sleeve'],
  ['Long sleeve work shirt', 'Shirts', 'shirts', 'long-sleeve'],
  ['Women\'s blouse', 'Blouses', 'blouses', 'blouse'],
  ['Chef\'s essential short sleeve jacket', 'Chef Jackets', 'chef-jackets', 'chef-jacket'],
  ['Healthcare tunic scrub top', 'Tunics', 'tunics', 'tunic-scrub-top'],
  ['Classic bib apron', 'Aprons', 'aprons', 'bib'],
  ['Colours 3-pocket waist apron', 'Aprons', 'aprons', 'waist'],
  ['Classic tabard', 'Tabards', 'tabards', 'tabard'],
  ['Baseball cap', 'Caps', 'caps', 'baseball'],
  ['Snapback trucker cap', 'Caps', 'caps', 'trucker'],
  ['Original cuffed beanie', 'Beanies', 'beanies', 'cuffed'],
  ['Classic bobble hat', 'Beanies', 'beanies', 'bobble'],
  ['Classic bucket hat', 'Hats', 'hats', 'bucket'],
  ['Cotton tote shopper bag', 'Bags', 'bags', 'tote'],
  ['Drawstring gymsac', 'Bags', 'bags', 'drawstring-gymsac'],
  ['Classic book bag', 'Bags', 'bags', 'book-bag'],
  ['Protective laptop sleeve', 'Laptop Cases', 'laptop-cases', 'laptop-sleeve'],
  ['Laptop document bag', 'Bags', 'bags', 'laptop-document'],
  ['Classic backpack', 'Bags', 'bags', 'backpack'],
  ['Messenger shoulder bag', 'Bags', 'bags', 'messenger'],
  ['Sports holdall gym bag', 'Bags', 'bags', 'holdall'],
  ['Classic boot bag', 'Bags', 'bags', 'boot-bag'],
  ['Essential work trousers', 'Trousers', 'trousers', 'work-trousers'],
  ['Classic joggers', 'Sweatpants', 'sweatpants', 'joggers'],
  ['Classic shorts', 'Shorts', 'shorts', 'shorts'],
  ['Bib and brace dungarees', 'Dungarees', 'dungarees', 'bib-brace'],
  ['Euro work coverall', 'Coveralls', 'coveralls', 'coverall-overall'],
  ['Team sports jersey', 'Sports Overtops', 'sports-overtops', 'sports-jersey'],
  ['Classic rugby shirt', 'Rugby Shirts', 'rugby-shirts', 'rugby-shirt'],
  ['Mesh tank top', 'Vests (t-shirt)', 'vests-t-shirt', 'sports-vest'],
  ['Baby toddler T-shirt', 'T-Shirts', 'tshirts', 'baby-toddler'],
  ['Baby bodysuit', 'Bodysuits', 'bodysuits', 'baby-bodysuit'],
  ['Baby bib', 'Bibs', 'bibs', 'baby-bib'],
  ['Classic towel', 'Towels', 'towels', 'towel'],
  ['Classic blanket', 'Blankets', 'blankets', 'blanket'],
  ['Classic umbrella', 'Umbrellas', 'umbrellas', 'umbrella'],
  ['Dog T-shirt', 'Dog T-Shirts', 'dog-t-shirts', 'dog-tshirt'],
  ['Dog hoodie', 'Dog Hoodies', 'dog-hoodies', 'dog-hoodie'],
  ['Dog jacket', 'Dog Jackets', 'dog-jackets', 'dog-jacket'],
];

test('resolves all 63 configured customization templates', () => {
  assert.equal(cases.length, 63);
  assert.deepEqual(
    cases.map(([, , productTypeSlug, subtypeKey]) => `${productTypeSlug}:${subtypeKey}`).sort(),
    configuredTemplates.map(({ productTypeSlug, subtypeKey }) => `${productTypeSlug}:${subtypeKey}`).sort(),
    'resolver test matrix must exactly match the imported 63-template manifest',
  );
  for (const [name, productType, productTypeSlug, subtypeKey] of cases) {
    assert.deepEqual(
      resolveCustomizationTemplate({ name, productType }),
      { productTypeSlug, subtypeKey },
      `${name} (${productType})`,
    );
  }
});

test('resolves reported storefront failures to specific templates', () => {
  assert.deepEqual(
    resolveCustomizationTemplate({
      name: 'Hi-vis two-tone thermal bodywarmer',
      productType: 'Gilets & Body Warmers',
    }),
    { productTypeSlug: 'gilets-body-warmers', subtypeKey: 'hi-vis-bodywarmer' },
  );
  assert.deepEqual(
    resolveCustomizationTemplate({ name: 'Mesh tank top', productType: 'Vests (t-shirt)' }),
    { productTypeSlug: 'vests-t-shirt', subtypeKey: 'sports-vest' },
  );
  assert.deepEqual(
    resolveCustomizationTemplate({
      name: "Chef's essential short sleeve jacket",
      productType: 'Hospitality',
    }),
    { productTypeSlug: 'chef-jackets', subtypeKey: 'chef-jacket' },
  );
  assert.deepEqual(
    resolveCustomizationTemplate({
      name: 'Gildan Heavy Blend Open End 280 Regular Sweat Adult',
      productType: 'Sweats Crew Neck - 260gsm - 295gsm Mens (Unisex)',
    }),
    { productTypeSlug: 'sweatshirts', subtypeKey: 'crewneck' },
  );
  assert.deepEqual(
    resolveCustomizationTemplate({
      name: 'FotL Valueweight Open End 165 Regular Fit Vest Adult',
      productType: 'Vests & Tanks Cotton - 160gsm - 175gsm Mens (Unisex)',
    }),
    { productTypeSlug: 'vests-t-shirt', subtypeKey: 'sports-vest' },
  );
  assert.deepEqual(
    resolveCustomizationTemplate({ name: 'Childrens Jog Bottoms', productType: 'Jog Bottoms' }),
    { productTypeSlug: 'sweatpants', subtypeKey: 'joggers' },
  );
});
