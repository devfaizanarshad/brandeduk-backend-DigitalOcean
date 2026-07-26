const CATEGORY_PRODUCT_TYPE_SLUGS = Object.freeze({
  Polos: 'polos',
  Sweatshirts: 'sweatshirts',
  SWEATSHIRT: 'sweatshirts',
  'T-Shirts': 'tshirts',
  Childrenswear: 'tshirts',
  Jackets: 'jackets',
  Shirts: 'shirts',
  Trousers: 'trousers',
  Healthcare: 'tunics',
  Sportswear: 'trackwear',
  'Hi Vis': 'safety-vests',
  'Jog Bottoms': 'sweatpants',
  'Rugby Shirts': 'rugby-shirts',
  Headwear: 'caps',
  Hospitality: 'aprons',
});

function inferProductTypeSlugFromName(productName) {
  const name = String(productName || '').trim().toLowerCase();
  if (!name) return '';

  // Prefer the garment's physical form over materials and broad supplier groups.
  if (/\b(?:safety vest|safety waistcoat)\b/.test(name)) return 'safety-vests';
  if (/\btabards?\b/.test(name)) return 'tabards';
  if (/\b(?:body ?warmers?|gilets?)\b/.test(name)) return 'gilets-body-warmers';
  if (/\bsoft[ -]?shells?\b/.test(name)) return 'softshells';
  if (/\b(?:micro)?fleeces?\b/.test(name)) return 'fleece';
  if (/\b(?:hoodies?|hooded sweatshirts?)\b/.test(name)) return 'hoodies';
  if (/\bsweat jackets?\b/.test(name)) return 'sweatshirts';
  if (/\bsweatshirts?\b/.test(name)) return 'sweatshirts';
  if (/\b(?:polo shirts?|polos?|poloshirts?)\b/.test(name)) return 'polos';
  if (/\b(?:t[ -]?shirts?|tees?)\b/.test(name)) return 'tshirts';
  if (/\b(?:jackets?|parkas?|bombers?)\b/.test(name)) return 'jackets';
  if (/\b(?:jog bottoms?|joggers?|jogging pants?)\b/.test(name)) return 'sweatpants';
  if (/\btrousers?\b/.test(name)) return 'trousers';
  if (/\bshorts\b/.test(name)) return 'shorts';
  if (/\brugby shirts?\b/.test(name)) return 'rugby-shirts';
  if (/\btunics?\b/.test(name)) return 'tunics';
  if (/\baprons?\b/.test(name)) return 'aprons';
  if (/\bshirts?\b/.test(name)) return 'shirts';
  if (/\bcaps?\b/.test(name)) return 'caps';

  return '';
}

function resolveUneekProductTypeSlug(category, productName) {
  return (
    inferProductTypeSlugFromName(productName) ||
    CATEGORY_PRODUCT_TYPE_SLUGS[category] ||
    ''
  );
}

module.exports = {
  CATEGORY_PRODUCT_TYPE_SLUGS,
  inferProductTypeSlugFromName,
  resolveUneekProductTypeSlug,
};
