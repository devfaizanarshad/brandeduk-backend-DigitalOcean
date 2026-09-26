const CATALOG_GROUPS = [
  { type: 'sector', name: 'Activewear & Performance', slug: 'activewear-performance', aliases: ['Activewear & Performance'] },
  { type: 'sector', name: 'Aprons & Service', slug: 'aprons-service', aliases: ['Aprons & Service'] },
  { type: 'sector', name: 'Chefswear', slug: 'chefswear', aliases: ['Chefswear'] },
  { type: 'sector', name: 'Golf', slug: 'golf', aliases: ['Golf'] },
  { type: 'sector', name: 'Health & Beauty', slug: 'health-beauty', aliases: ['Health & Beauty'] },
  { type: 'sector', name: 'Premium Sports', slug: 'premium-sports', aliases: ['Premium Sports'] },
  { type: 'sector', name: 'Safetywear (Hi-Vis)', slug: 'safetywear-hi-vis', aliases: ['Safetywear'] },
  { type: 'sector', name: 'Sports & Leisure', slug: 'sports-leisure', aliases: ['Sports & Leisure'] },
  { type: 'sector', name: 'Workwear', slug: 'workwear', aliases: ['Workwear'] },
  { type: 'collection', name: 'Baby & Toddler', slug: 'baby-toddler', aliases: ['Baby & Toddler'] },
  { type: 'collection', name: 'Heavyweight', slug: 'heavyweight', aliases: ['The Heavyweight Collection'] },
  { type: 'collection', name: 'Juniors', slug: 'juniors', aliases: ['Junior'] },
  { type: 'collection', name: 'Longer Length', slug: 'longer-length', aliases: ['Longer Length'] },
  { type: 'collection', name: 'Oversized', slug: 'oversized', aliases: ['Oversized'] },
  { type: 'collection', name: 'Petwear & Accessories', slug: 'petwear-accessories', aliases: ['Petwear & Accessories 2026'] },
  { type: 'collection', name: 'Plus Sizes', slug: 'plus-sizes', aliases: ['Plus Sizes'] },
  { type: 'collection', name: 'Rebrandable', slug: 'rebrandable', aliases: ['Rebrandable'] },
  { type: 'collection', name: 'Resortwear', slug: 'resortwear', aliases: ['Resortwear'] },
  { type: 'collection', name: 'Washable at 60 degrees', slug: 'washable-at-60-degrees', aliases: ['Safe to wash at 60 degrees'] },
  { type: 'collection', name: 'Washed & Dyed', slug: 'washed-dyed', aliases: ['Washed & Dyed Collection'] },
  { type: 'collection', name: 'Winter Essentials', slug: 'winter-essentials', aliases: ['Winter Essentials'] },
  { type: 'collection', name: "Women's", slug: 'womens', aliases: ["Women's Fashion"] },
  { type: 'collection', name: '1/4 & 1/2 zip Collection', slug: 'quarter-half-zip', aliases: ['Zipped Styles - 1/2 & 1/4'] }
].map((group, index) => ({ ...group, displayOrder: index + 1 }));

const aliasLookup = new Map();
for (const group of CATALOG_GROUPS) {
  for (const alias of group.aliases) {
    aliasLookup.set(alias.toLowerCase(), group);
  }
}

function classifyCatalogGroups(row) {
  const categories = String(row.Categorisation || '')
    .split('|')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  const matches = new Map();
  for (const category of categories) {
    const group = aliasLookup.get(category);
    if (group) matches.set(`${group.type}:${group.slug}`, group);
  }
  return [...matches.values()];
}

module.exports = { CATALOG_GROUPS, classifyCatalogGroups };
