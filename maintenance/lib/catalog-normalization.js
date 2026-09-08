'use strict';

function cleanText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\u0000/g, '').trim();
  return /^(?:n\/?a|not available|null|undefined)$/i.test(text) ? '' : text;
}

function slugify(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Match the canonical slugs already used by the live catalogue. Punctuation
    // is removed (not converted to words), so B&C -> bc, Stanley/Stella ->
    // stanleystella and AWDis Just T's -> awdis-just-ts.
    .replace(/[\u2019']/g, '')
    .replace(/[&/]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function splitValues(value, separators = /[|;]/) {
  return [...new Set(cleanText(value).split(separators).map(cleanText).filter(Boolean))];
}

function price(value) {
  const parsed = Number.parseFloat(cleanText(value).replace(/[£,$]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function integer(value) {
  const parsed = Number.parseInt(cleanText(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function imageUrl(value) {
  const url = cleanText(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

function colourHex(value) {
  const raw = cleanText(value);
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;

  const rgb = raw.match(/^(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})$/);
  if (!rgb) return null;
  const channels = rgb.slice(1).map(Number);
  if (channels.some(channel => channel < 0 || channel > 255)) return null;
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const COLOUR_RULES = [
  ['Black', /\b(black|jet black|deep black)\b/i],
  ['White', /\b(white|ivory)\b/i],
  ['Grey', /\b(grey|gray|charcoal|silver|ash|graphite|slate)\b/i],
  ['Blue', /\b(blue|navy|royal|sapphire|azure|aqua|turquoise|denim|indigo|cyan)\b/i],
  ['Green', /\b(green|olive|khaki|lime|mint|emerald|teal)\b/i],
  ['Red', /\b(red|burgundy|maroon|crimson|scarlet|wine|claret)\b/i],
  ['Pink', /\b(pink|fuchsia|magenta|rose)\b/i],
  ['Purple', /\b(purple|violet|lilac|plum|lavender)\b/i],
  ['Yellow', /\b(yellow|gold|mustard|lemon)\b/i],
  ['Orange', /\b(orange|coral|rust|terracotta)\b/i],
  ['Brown', /\b(brown|chocolate|tan|camel|coffee)\b/i],
  ['Neutral', /\b(neutral|natural|beige|stone|sand|cream|oatmeal|ecru)\b/i],
  ['Multi', /\b(multi|rainbow|pattern|camouflage|camo)\b/i]
];

function primaryColour(exactColour, suppliedPrimary = '') {
  const supplied = cleanText(suppliedPrimary);
  const allowed = new Set(COLOUR_RULES.map(([name]) => name.toLowerCase()));
  if (allowed.has(supplied.toLowerCase())) {
    return COLOUR_RULES.find(([name]) => name.toLowerCase() === supplied.toLowerCase())[0];
  }

  const text = `${supplied} ${cleanText(exactColour)}`.trim();
  const match = COLOUR_RULES
    .map(([name, pattern]) => ({ name, index: text.search(pattern) }))
    .filter(item => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0];
  return match ? match.name : (supplied || 'Multi');
}

function colourShade(exactColour, suppliedShade = '', family = '') {
  const exact = cleanText(exactColour);
  const supplied = cleanText(suppliedShade);
  const primary = family || primaryColour(exact);

  if (supplied) {
    if (supplied.includes(' - ')) return supplied;
    if (supplied.toLowerCase() !== primary.toLowerCase()) return `${primary} - ${supplied}`;
  }
  if (!exact || exact.toLowerCase() === primary.toLowerCase()) return `${primary} - ${primary}`;
  return `${primary} - ${exact}`;
}

function normalizeGender(value, context = '') {
  const text = `${cleanText(value)} ${cleanText(context)}`.toLowerCase();
  if (/\b(female|women|woman|ladies|lady|girls?)\b/.test(text)) return 'Female';
  if (/\b(male|men|man|mens|boys?)\b/.test(text) && !/unisex/.test(text)) return 'Male';
  return 'Unisex';
}

function normalizeAgeGroup(value, context = '') {
  const text = `${cleanText(value)} ${cleanText(context)}`.toLowerCase();
  if (/\b(baby|babies|infant|toddler|months?)\b/.test(text)) return 'Infant';
  if (/\b(kids?|children|child|junior|youth|boys?|girls?|years?)\b/.test(text)) return 'Kids';
  return 'Adult';
}

const WEIGHT_RANGES = [
  { name: '0 - 50gsm', slug: '0-50gsm', min: 0, max: 50 },
  { name: '051 - 100gsm', slug: '051-100gsm', min: 51, max: 100 },
  { name: '101 - 150gsm', slug: '101-150gsm', min: 101, max: 150 },
  { name: '151 - 200gsm', slug: '151-200gsm', min: 151, max: 200 },
  { name: '201 - 250gsm', slug: '201-250gsm', min: 201, max: 250 },
  { name: '251 - 300gsm', slug: '251-300gsm', min: 251, max: 300 },
  { name: 'Over 300gsm', slug: 'over-300gsm', min: 301, max: null }
];

function extractGsm(value, fallback = '') {
  const text = `${cleanText(value)} ${cleanText(fallback)}`;
  const explicit = [...text.matchAll(/\b(\d{2,3})\s*(?:gsm|g\s*\/\s*m(?:2|²))\b/gi)]
    .map(match => Number(match[1]))
    .filter(number => number >= 20 && number <= 1000);
  if (explicit.length > 0) return explicit[0];

  const plain = Number.parseInt(cleanText(value), 10);
  return Number.isFinite(plain) && plain >= 20 && plain <= 1000 ? plain : null;
}

function weightRange(gsm) {
  if (!Number.isFinite(gsm)) return null;
  return WEIGHT_RANGES.find(range => gsm >= range.min && (range.max === null || gsm <= range.max)) || null;
}

const MATERIALS = [
  ['Cotton', 'cotton'], ['Polyester', 'polyester'], ['Nylon', 'nylon'],
  ['Viscose', 'viscose'], ['Elastane', 'elastane'], ['Acrylic', 'acrylic'],
  ['Wool', 'wool'], ['Linen', 'linen'], ['Polyamide', 'polyamide'],
  ['Rayon', 'rayon'], ['Spandex', 'spandex'], ['Lyocell', 'lyocell'], ['Modal', 'modal']
];

function normalizeFabrics(value) {
  const original = cleanText(value);
  const text = original.toLowerCase();
  if (!text) return [];

  const results = new Map();
  for (const [display, token] of MATERIALS) {
    if (!new RegExp(`\\b${token}\\b`, 'i').test(text)) continue;

    const percentagePatterns = [
      new RegExp(`(\\d{1,3})\\s*%\\s*(?:(organic|recycled)\\s+)?${token}\\b`, 'ig'),
      new RegExp(`(?:(organic|recycled)\\s+)?${token}\\s*(?:[:(-]|is)?\\s*(\\d{1,3})\\s*%`, 'ig')
    ];
    const percentages = [];
    let qualifier = '';
    for (const pattern of percentagePatterns) {
      for (const match of text.matchAll(pattern)) {
        const numeric = Number(match[1]) || Number(match[2]);
        const detectedQualifier = Number(match[1]) ? match[2] : match[1];
        if (Number.isFinite(numeric)) percentages.push(numeric);
        if (detectedQualifier) qualifier = detectedQualifier;
      }
    }

    const nearbyQualifier = new RegExp(`\\b(organic|recycled)\\s+${token}\\b`, 'i').exec(text)?.[1];
    qualifier = qualifier || nearbyQualifier || '';
    const qualifiedName = `${qualifier ? `${qualifier[0].toUpperCase()}${qualifier.slice(1)} ` : ''}${display}`;
    const isPure = percentages.includes(100);
    const name = isPure ? `${qualifiedName} (100%)` : (percentages.length ? `${qualifiedName} Blend` : qualifiedName);
    results.set(slugify(name), { name, slug: slugify(name), type: qualifiedName, percentage: isPure ? '100%' : null });
  }

  return [...results.values()];
}

const KEYWORD_RULES = [
  ['sleeve', 'Long Sleeve', /\b(long[ -]?sleeve|l\/s)\b/i],
  ['sleeve', 'Short Sleeve', /\b(short[ -]?sleeve|s\/s)\b/i],
  ['sleeve', 'Sleeveless', /\b(sleeveless|vest|tank)\b/i],
  ['sleeve', 'Roll Sleeve', /\broll[ -]?sleeve\b/i],
  ['neckline', 'Crew Neck', /\b(crew|round)[ -]?neck(?:ed)?\b/i],
  ['neckline', 'V Neck', /\bv[ -]?neck\b/i],
  ['neckline', 'Zip Neck', /\b(quarter|half|full)[ -]?zip|zip[ -]?neck\b/i],
  ['neckline', 'Hooded', /\bhood(?:ed|ie)?\b/i],
  ['neckline', 'Collared', /\b(collar|polo)\b/i],
  ['fit', 'Classic Fit', /\bclassic[ -]?fit\b/i],
  ['fit', 'Regular Fit', /\bregular[ -]?fit\b/i],
  ['fit', 'Slim Fit', /\bslim[ -]?fit\b/i],
  ['fit', 'Relaxed Fit', /\brelaxed[ -]?fit\b/i],
  ['fit', 'Oversized Fit', /\boversized?\b/i],
  ['fit', 'Fitted', /\bfitted\b/i],
  ['feature', 'Ringspun', /\bring[ -]?spun\b/i],
  ['feature', 'Organic', /\borganic\b/i],
  ['feature', 'Recycled', /\brecycled\b/i],
  ['feature', 'High Visibility', /\bhi[ -]?vis(?:ibility)?\b/i],
  ['feature', 'Waterproof', /\bwaterproof\b/i],
  ['feature', 'Water Resistant', /\bwater[ -]?resistant\b/i],
  ['feature', 'Windproof', /\bwindproof\b/i],
  ['feature', 'Breathable', /\bbreathable\b/i],
  ['feature', 'Pocket', /\bpockets?\b/i],
  ['feature', 'Contrast', /\bcontrast\b/i],
  ['feature', 'Ribbed', /\brib(?:bed)?\b/i],
  ['feature', 'Panelled', /\bpanelled|paneled\b/i],
  ['feature', 'Washed', /\bwashed|garment[ -]?dyed\b/i],
  ['feature', 'Heavyweight', /\bheavy[ -]?weight\b/i],
  ['feature', 'Lightweight', /\blight[ -]?weight\b/i]
];

function extractKeywords(...values) {
  const text = values.map(cleanText).filter(Boolean).join(' ');
  return KEYWORD_RULES
    .filter(([, , pattern]) => pattern.test(text))
    .map(([type, name]) => ({ type, name, slug: slugify(name) }));
}

function sizeOrder(value) {
  const size = cleanText(value).toUpperCase().replace(/\s+/g, ' ');
  const sequence = ['3XS', 'XXS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL'];
  const found = sequence.indexOf(size);
  if (found >= 0) return found + 10;
  if (/MONTH/.test(size)) return 100 + (Number.parseInt(size, 10) || 0);
  if (/YEAR|YRS?/.test(size)) return 200 + (Number.parseInt(size, 10) || 0);
  if (/ONE SIZE|\bOS\b/.test(size)) return 900;
  return 800;
}

module.exports = {
  WEIGHT_RANGES,
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
};
