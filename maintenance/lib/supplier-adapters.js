'use strict';

const {
  cleanText,
  slugify,
  splitValues,
  price,
  integer,
  imageUrl,
  colourHex,
  primaryColour,
  colourShade,
  normalizeGender,
  normalizeAgeGroup,
  extractGsm,
  weightRange,
  normalizeFabrics,
  extractKeywords,
  sizeOrder
} = require('./catalog-normalization');
const { resolveUneekProductTypeSlug } = require('./resolve-uneek-product-type');

const SUPPLIERS = {
  ralawise: { slug: 'ralawise', name: 'Ralawise' },
  uneek: { slug: 'uneek', name: 'Uneek' },
  'absolute-apparel': { slug: 'absolute-apparel', name: 'Absolute Apparel' }
};

const UNEEK_TYPES = {
  polos: 'Polos', sweatshirts: 'Sweatshirts', sweatshirt: 'Sweatshirts',
  't-shirts': 'T-Shirts', tshirts: 'T-Shirts', childrenswear: 'T-Shirts', childrens: 'T-Shirts',
  jackets: 'Jackets', shirts: 'Shirts', trousers: 'Trousers', healthcare: 'Tunics',
  sportswear: 'Trackwear', 'hi vis': 'Hi-Vis', 'jog bottoms': 'Sweatpants',
  'rugby shirts': 'Rugby Shirts', headwear: 'Caps', hospitality: 'Aprons'
};

const ABSOLUTE_TYPE_RULES = [
  [/^workwear\s*-\s*hi visibility vests?/i, 'Safety Vests'],
  [/^workwear\s*-\s*hi visibility (?:t-shirts?|polos?)/i, 'Hi-Vis'],
  [/^workwear\s*-\s*hi visibility softshell/i, 'Softshells'],
  [/^workwear\s*-\s*hi visibility outdoor fleece/i, 'Fleece'],
  [/^workwear\s*-\s*hi visibility/i, 'Jackets'],
  [/^catering\s*&\s*hospitality\s*-\s*chef trousers?/i, 'Trousers'],
  [/^catering\s*&\s*hospitality\s*-\s*chef jackets?/i, 'Jackets'],
  [/^catering\s*&\s*hospitality\s*-\s*(?:aprons?|tabards?)/i, 'Aprons'],
  [/^outdoor fleece bodywarmers?/i, 'Gilets & Body Warmers'],
  [/^outdoor fleece/i, 'Fleece'],
  [/^zip hoodies?/i, 'Hoodies'],
  [/^sweats (?:crew neck|full zip|quarter zip)/i, 'Sweatshirts'],
  [/^t-shirts?\b/i, 'T-Shirts'], [/^polos?\b/i, 'Polos'], [/^sweatshirts?\b/i, 'Sweatshirts'],
  [/^hoodies?\b/i, 'Hoodies'], [/^outerwear.*bodywarm/i, 'Gilets & Body Warmers'],
  [/^outerwear/i, 'Jackets'], [/^softshell/i, 'Softshells'], [/^fleece/i, 'Fleece'],
  [/^hi-?vis.*vest|^hi-?vis.*waistcoat/i, 'Hi-Vis'], [/^hi-?vis/i, 'Jackets'],
  [/^workwear shorts|^shorts/i, 'Shorts'], [/^workwear trousers|^trousers/i, 'Trousers'],
  [/^jogpants/i, 'Sweatpants'], [/^workwear thermal/i, 'Baselayers'],
  [/^workwear/i, 'Trousers'], [/^shirts?/i, 'Shirts'], [/^vests?\s*&\s*tanks?/i, 'Vests (t-shirt)'],
  [/^headwear.*beanie/i, 'Beanies'], [/^headwear/i, 'Caps'], [/^bags?/i, 'Bags'],
  [/^accessories/i, 'Accessories'], [/^knitwear/i, 'Knitted Jumpers'],
  [/^catering\s*&\s*hospitality/i, 'Aprons'], [/^baby\s*&\s*toddler/i, 'Bodysuits']
];

function normalizeStatus(value, hasUsablePrice = true) {
  const status = cleanText(value).toLowerCase();
  if (!hasUsablePrice) return 'Unavailable';
  if (!status || /^(live|active|available|false|0|no)$/.test(status)) return 'Live';
  return 'Discontinued';
}

function productType(name) {
  const clean = cleanText(name) || 'Accessories';
  const common = {
    't-shirt': ['T-Shirts', 'tshirts'], tshirt: ['T-Shirts', 'tshirts'],
    tshirts: ['T-Shirts', 'tshirts'], 't-shirts': ['T-Shirts', 'tshirts'],
    'hi vis': ['Hi-Vis', 'hi-vis'], 'hi-vis': ['Hi-Vis', 'hi-vis'],
    'safety vests': ['Safety Vests', 'safety-vests'], 'safety-vests': ['Safety Vests', 'safety-vests'],
    fleece: ['Fleece', 'fleece'], fleeces: ['Fleece', 'fleece'],
    'gilets & body warmers': ['Gilets & Body Warmers', 'gilets-body-warmers'],
    'gilets-body-warmers': ['Gilets & Body Warmers', 'gilets-body-warmers']
  };
  const normalized = common[clean.toLowerCase()];
  return normalized ? { name: normalized[0], slug: normalized[1] } : { name: clean, slug: slugify(clean) };
}

function baseRecord(input) {
  const family = primaryColour(input.colourName, input.primaryColour);
  const gsm = extractGsm(input.weight, `${input.styleName} ${input.specification} ${input.fabric}`);
  const range = weightRange(gsm);
  const fabrics = normalizeFabrics(input.fabric);
  const keywords = extractKeywords(
    input.styleName,
    input.specification,
    input.fabric,
    ...(input.features || [])
  );

  return {
    supplierSlug: input.supplierSlug,
    supplierName: SUPPLIERS[input.supplierSlug]?.name || input.supplierSlug,
    styleCode: cleanText(input.styleCode).toUpperCase(),
    externalStyleCode: cleanText(input.externalStyleCode || input.styleCode),
    skuCode: cleanText(input.skuCode).toUpperCase(),
    externalSku: cleanText(input.externalSku || input.skuCode),
    styleName: cleanText(input.styleName) || cleanText(input.styleCode),
    brand: cleanText(input.brand) || input.supplierName || 'Unknown',
    productType: productType(input.productType),
    gender: normalizeGender(input.gender, `${input.styleName} ${input.categories?.join(' ') || ''}`),
    ageGroup: normalizeAgeGroup(input.ageGroup, `${input.styleName} ${input.categories?.join(' ') || ''}`),
    fabricDescription: cleanText(input.fabric),
    specification: cleanText(input.specification),
    colourName: cleanText(input.colourName) || family,
    primaryColour: family,
    colourShade: colourShade(input.colourName, input.colourShade, family),
    colourHex: colourHex(input.colourHex),
    size: cleanText(input.size) || 'One Size',
    sizeOrder: sizeOrder(input.size),
    tag: cleanText(input.tag),
    status: normalizeStatus(input.status, Number(input.singlePrice) > 0 || Number(input.cartonPrice) > 0),
    cartonPrice: input.cartonPrice,
    packPrice: input.packPrice,
    singlePrice: input.singlePrice,
    primaryImageUrl: imageUrl(input.primaryImageUrl),
    colourImageUrl: imageUrl(input.colourImageUrl),
    stockQuantity: input.stockQuantity ?? 0,
    categories: [...new Set((input.categories || []).map(cleanText).filter(Boolean))],
    accreditations: [...new Set((input.accreditations || []).map(cleanText).filter(Boolean))],
    fabrics,
    weightRange: range,
    gsm,
    keywords
  };
}

function normalizeRalawiseRow(row) {
  const features = ['Product Feature 1', 'Product Feature 2', 'Product Feature 3']
    .map(key => cleanText(row[key])).filter(Boolean);
  return baseRecord({
    supplierSlug: 'ralawise', supplierName: 'Ralawise',
    styleCode: row['Style Code'], externalStyleCode: row['Manufacturer Style Code'] || row['Style Code'],
    skuCode: row['Sku Code'], externalSku: row['Sku Code'], styleName: row['Style Name'], brand: row.Brand,
    productType: row['Product Type'], gender: row.Gender, ageGroup: row['Age Group'],
    fabric: row.Fabric, weight: row['Weight (GSM)'],
    specification: [row.Specification, row['Retail Description'], ...features].map(cleanText).filter(Boolean).join('\n'),
    features, colourName: row['Colour Name'], primaryColour: row['Primary Colour'],
    colourShade: row['Colour Shade'], colourHex: row.RGB,
    size: row['Size Name'], tag: row.Tag, status: row['Sku Status'],
    cartonPrice: price(row['Carton Price']), packPrice: price(row['Pack Price']), singlePrice: price(row['Single Price']),
    primaryImageUrl: row['Primary Product Image URL'], colourImageUrl: row['Colour Image'], stockQuantity: 0,
    categories: splitValues(row.Categorisation), accreditations: splitValues(row.Accreditations)
  });
}

function normalizeUneekRow(row) {
  const category = cleanText(row.Category);
  const mappedType = resolveUneekProductTypeSlug(category, row['Product Name']) || UNEEK_TYPES[category.toLowerCase()] || category;
  return baseRecord({
    supplierSlug: 'uneek', supplierName: 'Uneek',
    styleCode: row['Product Code'], skuCode: row['Short Code'], externalSku: row['Short Code'],
    styleName: row['Product Name'], brand: row.Company || 'Uneek Clothing', productType: mappedType,
    gender: row.Gender, ageGroup: category, fabric: row.Composition, weight: row.GSM,
    specification: [row['Full Description'], row.Specifications].map(cleanText).filter(Boolean).join('\n'),
    features: splitValues(row.Specifications, /[,|;]/), colourName: row.Colour, colourHex: row.Hex,
    size: row.Size, status: 'Live', cartonPrice: price(row['Price Caton']), packPrice: price(row['Price Pack']),
    singlePrice: price(row['Price Single']) ?? price(row.MyPrice), primaryImageUrl: row['Model Large Image'],
    colourImageUrl: row['Large Colour Image'], stockQuantity: 0, categories: [category], accreditations: []
  });
}

function absoluteProductType(category) {
  const broad = cleanText(category).split('\\')[0].trim();
  const match = ABSOLUTE_TYPE_RULES.find(([pattern]) => pattern.test(broad));
  return match ? match[1] : null;
}

function normalizeAbsoluteProduct(master) {
  const category = cleanText(master.Category);
  const mappedType = absoluteProductType(category);
  if (!mappedType) return [];
  const features = Array.isArray(master.KeyFeatures) ? master.KeyFeatures.map(cleanText).filter(Boolean) : [cleanText(master.KeyFeatures)].filter(Boolean);
  const images = Array.isArray(master.Images) ? master.Images.map(imageUrl).filter(Boolean) : [];
  const fabric = features.filter(value => /cotton|polyester|nylon|viscose|elastane|acrylic|wool|linen|polyamide|rayon|spandex|lyocell|modal/i.test(value)).join('. ');
  const weight = features.find(value => /\d{2,3}\s*gsm/i.test(value)) || category;
  const categories = category.split('\\').map(cleanText).filter(Boolean);
  const accreditations = features.flatMap(value => {
    if (!/fair|wrap|sedex|oeko|amfori|bci|organic|recycled|vegan/i.test(value)) return [];
    return value.split(/[,|]/).map(cleanText).filter(Boolean);
  });

  return (master.SKUs || []).map(sku => baseRecord({
    supplierSlug: 'absolute-apparel', supplierName: 'Absolute Apparel',
    styleCode: master.ProductCode, skuCode: sku.StockCode, externalSku: sku.StockCode,
    styleName: master.ProductName, brand: master.Manufacturer, productType: mappedType,
    gender: '', ageGroup: '', fabric, weight, specification: features.join('\n'), features,
    colourName: sku.Colour, size: sku.Size,
    status: sku.Discontinued ? 'Discontinued' : 'Live',
    cartonPrice: price(sku.Price), packPrice: price(sku.Price), singlePrice: price(sku.Price),
    primaryImageUrl: images[0], colourImageUrl: '', stockQuantity: integer(sku.Stock),
    categories, accreditations
  }));
}

module.exports = {
  SUPPLIERS,
  normalizeRalawiseRow,
  normalizeUneekRow,
  normalizeAbsoluteProduct,
  absoluteProductType
};
