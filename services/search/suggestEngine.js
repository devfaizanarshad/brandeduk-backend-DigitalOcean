'use strict';

/**
 * In-memory typeahead engine for the header search bar.
 *
 * Why this exists:
 *   The SQL suggest path ran four queries per keystroke against a pool that allows
 *   two concurrent queries per process, so every keystroke cost 0.5-4s. The live
 *   catalogue is ~6k styles, so we load it once, index it in memory and answer every
 *   keystroke in about a millisecond with zero database work.
 *
 * What it returns per keystroke:
 *   - suggestions: query completions mined from real product names, product types,
 *     gender and brand combinations ("ladies v-neck t-shirts", "portwest jackets")
 *   - completion:  the best suggestion that starts with what was typed (ghost text)
 *   - correctedQuery: typo correction ("hoddie" -> "hoodie")
 *   - brands, types (categories) and ranked products, including style-code prefixes
 *
 * Matching never narrows below what the customer typed: when an exact interpretation
 * finds few products, partial matches fill the rest of the list.
 */

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function fold(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/['’`´]/g, '');
}

function foldWord(value) {
  return fold(value).replace(/[^a-z0-9]/g, '');
}

/** Normalised form used for "does this suggestion start with what was typed". */
function foldPhrase(value) {
  return fold(value).replace(/[^a-z0-9]+/g, ' ').replace(/^ +/, '');
}

const STEM_EXCEPTIONS = new Map([
  ['scarves', 'scarf'], ['knives', 'knife'], ['halves', 'half'], ['wolves', 'wolf'],
  ['leaves', 'leaf'], ['shelves', 'shelf'], ['children', 'children'], ['pyjamas', 'pyjama'],
  ['canvas', 'canvas'], ['christmas', 'christmas'], ['jeans', 'jean'], ['overalls', 'overall']
]);

function stem(word) {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (STEM_EXCEPTIONS.has(word)) return STEM_EXCEPTIONS.get(word);
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'ie';
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ie';
  if (/(ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

// Equivalent words collapse to one canonical stem (applied after stemming).
const CANON = new Map(Object.entries({
  ladie: 'womens', lady: 'womens', women: 'womens', womens: 'womens', woman: 'womens', female: 'womens',
  men: 'mens', mens: 'mens', man: 'mens', male: 'mens', gent: 'mens',
  kid: 'kids', kids: 'kids', child: 'kids', children: 'kids', childrens: 'kids', junior: 'kids',
  youth: 'kids', boy: 'kids', girl: 'kids',
  infant: 'baby', babie: 'baby', baby: 'baby', toddler: 'baby', newborn: 'baby',
  tee: 'tshirt', viz: 'vis', visibility: 'vis', color: 'colour', gray: 'grey',
  zipped: 'zip', zipper: 'zip', hoodie: 'hoodie', hoody: 'hoodie'
}));

// Adjacent words that customers type both joined and apart. Merged on both sides so
// "t shirt", "t-shirt" and "tshirt" are one term, and "shirt" no longer means t-shirts.
// Keys are run through the same stemming as product text ("body" stems to "bodie").
const MERGE_PAIRS = new Map(Object.entries({
  't|shirt': 'tshirt', 'hi|vis': 'hivis', 'high|vis': 'hivis', 'v|neck': 'vneck',
  'soft|shell': 'softshell', 'body|warmer': 'bodywarmer', 'crew|neck': 'crewneck',
  'base|layer': 'baselayer', 'snap|back': 'snapback', 'rain|coat': 'raincoat'
}).map(([pair, merged]) => {
  const [first, second] = pair.split('|');
  return [`${canonWord(first)}|${canonWord(second)}`, merged];
}));

function canonWord(word) {
  const direct = CANON.get(word);
  if (direct) return direct;
  const stemmed = stem(word);
  return CANON.get(stemmed) || stemmed;
}

const GENDER_TERMS = new Set(['womens', 'mens', 'kids', 'baby', 'unisex']);
const GENDER_LABEL = { womens: 'ladies', mens: 'mens', kids: 'kids', baby: 'baby' };

/**
 * Tokenise a string into canonical terms. Returns tokens with raw offsets so phrase
 * display text can be cut from the original product name (keeps "piqué", "t-shirt").
 */
function tokenize(raw) {
  const text = String(raw == null ? '' : raw);
  const out = [];
  WORD_RE.lastIndex = 0;
  let match;
  while ((match = WORD_RE.exec(text))) {
    const word = foldWord(match[0]);
    if (!word) continue;
    out.push({ word, term: canonWord(word), start: match.index, end: match.index + match[0].length });
  }
  // Merge configured pairs into a single token spanning both words.
  const merged = [];
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    const gap = next ? text.slice(out[i].end, next.start) : '';
    const joined = next && /^[\s-]*$/.test(gap) ? MERGE_PAIRS.get(`${out[i].term}|${next.term}`) : null;
    if (joined) {
      merged.push({ word: out[i].word + next.word, term: joined, start: out[i].start, end: next.end });
      i++;
    } else {
      merged.push(out[i]);
    }
  }
  return merged;
}

function termsOf(raw) {
  return tokenize(raw).map(token => token.term);
}

// ---------------------------------------------------------------------------
// Vocabulary helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'and', 'with', 'for', 'of', 'in', 'to', 'a', 'an', 'by', 'on', 'from', 'adult', 'adults',
  'new', 'pack', 'pair', 'pairs', 'set', 'range', 'collection', 'edition', 'version', 'unisex'
]);
const SHORT_WORD_ALLOW = new Set(['t', 'v', 'hi', 'uv', 'pe', 'xl']);
const JUNK_RE = /^(?:\d+[a-z]*|[a-z]*\d+[a-z\d]*|x{0,3}[sml]|xxl|[2-9]xl|gsm|oz|cm|mm|ml|ltr|kg)$/;

const CURATED_NOUNS = [
  'tshirt', 'hoodie', 'hood', 'sweatshirt', 'jacket', 'coat', 'polo', 'shirt', 'vest', 'top', 'short',
  'trouser', 'pant', 'jogger', 'legging', 'cap', 'hat', 'beanie', 'snood', 'scarf', 'glove', 'sock',
  'bag', 'backpack', 'tote', 'shopper', 'rucksack', 'holdall', 'apron', 'tabard', 'tunic', 'fleece',
  'gilet', 'bodywarmer', 'softshell', 'parka', 'anorak', 'jumper', 'sweater', 'cardigan', 'blouse',
  'dress', 'skirt', 'towel', 'blanket', 'robe', 'helmet', 'boot', 'shoe', 'trainer', 'overall',
  'coverall', 'dungaree', 'waistcoat', 'bib', 'bodysuit', 'onesie', 'pyjama', 'headband', 'visor',
  'trucker', 'snapback', 'baselayer', 'overtop', 'sweatpant', 'chino', 'jean', 'tie', 'umbrella',
  'bottle', 'mug', 'keyring', 'lanyard', 'wallet', 'pouch', 'cushion', 'toy', 'armband', 'kneepad',
  'goggle', 'raincoat', 'smock', 'gown', 'scrub', 'tracksuit', 'jersey', 'singlet', 'crop', 'bra',
  'brief', 'boxer', 'slipper', 'poncho', 'bucket', 'beret', 'balaclava', 'neckwarmer', 'mitt'
];
const UNCOUNTABLE = new Set(['hivis', 'workwear', 'clothing', 'knitwear', 'footwear', 'headwear',
  'loungewear', 'outerwear', 'merchandise', 'equipment', 'fleece_material']);
const BAD_START = new Set(['neck', 'sleeve', 'sleeved', 'vis', 'fit', 'panel', 'profile', 'weight',
  'layer', 'length', 'tone', 'line', 'end', 'leg', 'zip_only']);

function pluralizeWord(word) {
  if (!word || /\d$/.test(word)) return word;
  const lower = word.toLowerCase();
  if (/wear$/.test(lower)) return word; // workwear, trackwear, headwear
  if (/(s|x|z|ch|sh)$/.test(lower)) {
    if (/(ss|x|z|ch|sh)$/.test(lower)) return word + 'es';
    return word; // already plural ("trousers", "shorts", "jeans")
  }
  if (/[^aeiou]y$/.test(lower)) return word.slice(0, -1) + 'ies';
  if (lower.endsWith('scarf')) return word.slice(0, -1) + 'ves';
  return word + 's';
}

// Consistent spelling for suggestion text, whatever the supplier wrote in the name.
const DISPLAY_RULES = [
  [/\bt[\s-]?shirts\b/g, 't-shirts'], [/\bt[\s-]?shirt\b/g, 't-shirt'],
  [/\btees\b/g, 't-shirts'], [/\btee\b/g, 't-shirt'],
  [/\b(?:hi|high)[\s-]?(?:vis|viz)(?:ibility)?\b/g, 'hi-vis'],
  [/\bv[\s-]?neck\b/g, 'v-neck'], [/\bcrew[\s-]neck\b/g, 'crew neck'],
  [/\bsoft[\s-]shell/g, 'softshell'], [/\bhoody\b/g, 'hoodie'], [/\bhoodys\b/g, 'hoodies'],
  [/\s*\([^)]*\)/g, ''], [/\s+/g, ' ']
];

function normalizeDisplay(display) {
  let out = String(display || '').toLowerCase();
  DISPLAY_RULES.forEach(([pattern, replacement]) => { out = out.replace(pattern, replacement); });
  return out.trim();
}

function pluralizeDisplay(display) {
  const match = display.match(/^(.*?)([\p{L}\p{N}]+)$/u);
  if (!match) return display;
  return match[1] + pluralizeWord(match[2]);
}

function damerau(a, b, max) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prevPrev = null;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      cur[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[lb];
}

function lowerBound(sorted, key) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < key) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Field bit flags for postings.
const F_NAME = 1;
const F_TYPE = 2;
const F_BRAND = 4;
const F_GENDER = 8;
const F_JOIN = 16;
const F_COLOUR = 32;
const FIELD_WEIGHT = [
  [F_NAME, 1], [F_JOIN, 0.95], [F_TYPE, 0.9], [F_BRAND, 0.85], [F_GENDER, 0.7], [F_COLOUR, 0.6]
];

function fieldWeight(mask) {
  for (const [flag, weight] of FIELD_WEIGHT) if (mask & flag) return weight;
  return 0;
}

// Multi-word intents customers use that our product names do not. The rewrite is
// tried first; the literal words still contribute products after it.
const PHRASE_SYNONYMS = [
  { from: 'hard hat', to: 'helmet', label: 'safety helmets' },
  { from: 'hardhat', to: 'helmet', label: 'safety helmets' },
  { from: 'safety helmet', to: 'helmet', label: 'safety helmets' },
  { from: 'chef whites', to: 'chef jacket', label: 'chef jackets' },
  { from: 'rain jacket', to: 'waterproof jacket', label: 'waterproof jackets' },
  { from: 'tank top', to: 'vest', label: 'vests' },
  { from: 'track suit', to: 'tracksuit', label: 'tracksuits' },
  { from: 'bobble hat', to: 'pom beanie', label: 'bobble hats' },
  { from: 'woolly hat', to: 'beanie', label: 'beanies' },
  { from: 'wooly hat', to: 'beanie', label: 'beanies' }
].map(rule => ({ ...rule, terms: termsOf(rule.from) }));

// Single words with no catalogue match of their own (only used when the word itself
// finds nothing, so they can never hide products that literally match).
const WORD_SYNONYMS = new Map(Object.entries({
  sneakers: ['trainers'], rucksack: ['backpack'], sweater: ['sweatshirt', 'jumper'],
  pullover: ['sweatshirt'], joggers: ['joggers', 'sweatpants'], trackies: ['sweatpants'],
  pants: ['trousers'], toque: ['beanie'], singlet: ['vest'], parka: ['parka', 'jacket'],
  anorak: ['jacket'], cagoule: ['jacket'], workwear: ['work'], sweats: ['sweatpants']
}).map(([word, targets]) => [termsOf(word)[0], targets.map(target => termsOf(target)[0])]));

// ---------------------------------------------------------------------------
// Index construction (pure: no database access, unit-testable)
// ---------------------------------------------------------------------------

/**
 * @param {object} data
 * @param {Array} data.styles  rows: style_code, style_name, brand, brand_slug, type_name,
 *                             type_slug, gender, age, is_best_seller, is_featured,
 *                             is_recommended, price, image, colours
 * @param {Array} [data.keywords] names of catalogue keywords/features (single-word chips)
 * @param {Array} [data.synonyms] rows: term, canonical, synonym_type
 */
function createIndex(data) {
  const startedAt = Date.now();
  const styles = Array.isArray(data.styles) ? data.styles : [];

  const docs = [];
  const postingsBuild = new Map(); // term -> Map(docId -> mask)
  const surfaceFreq = new Map();   // folded surface word -> { term, freq }
  const brandStats = new Map();    // brand name -> { name, slug, count, terms }
  const typeStats = new Map();     // merged type key -> { variants: Map(name->{slug,count}), terms }
  const nounSet = new Set(CURATED_NOUNS);
  const keywordSet = new Set();
  const colourSet = new Set();

  const addPosting = (term, docId, flag) => {
    let byDoc = postingsBuild.get(term);
    if (!byDoc) {
      byDoc = new Map();
      postingsBuild.set(term, byDoc);
    }
    byDoc.set(docId, (byDoc.get(docId) || 0) | flag);
  };
  const addSurface = (word, term, weight = 1) => {
    if (!word) return;
    const entry = surfaceFreq.get(word);
    if (entry) entry.freq += weight;
    else surfaceFreq.set(word, { term, freq: weight });
  };

  (data.keywords || []).forEach(name => {
    const terms = termsOf(name);
    if (terms.length === 1) keywordSet.add(terms[0]);
  });

  styles.forEach(row => {
    const code = String(row.style_code || '').trim();
    const name = String(row.style_name || '').trim();
    if (!code || !name) return;
    const docId = docs.length;
    const brand = row.brand ? String(row.brand).trim() : '';
    const typeName = row.type_name ? String(row.type_name).trim() : '';
    const gender = genderOf(row);
    const nameTokens = tokenize(name);
    const doc = {
      id: docId,
      code,
      codeKey: foldWord(code),
      name,
      brand,
      brandSlug: row.brand_slug || '',
      typeName,
      typeSlug: row.type_slug || '',
      gender,
      price: row.price == null ? null : Number(row.price),
      image: row.image || null,
      colours: Number(row.colours) || 0,
      popularity: (row.is_best_seller ? 18 : 0) + (row.is_featured ? 8 : 0) + (row.is_recommended ? 6 : 0)
        + Math.min(Number(row.colours) || 0, 30) * 0.4,
      nameTerms: nameTokens.map(token => token.term),
      typeTerms: termsOf(typeName),
      brandTerms: termsOf(brand),
      nameTokens
    };
    docs.push(doc);

    doc.nameTerms.forEach((term, index) => {
      addPosting(term, docId, F_NAME);
      addSurface(nameTokens[index].word, term);
      if (nameTokens[index].word !== term) addSurface(term, term, 0.5);
    });
    // Joined neighbours let "poloshirt" find "polo shirt".
    for (let i = 0; i + 1 < doc.nameTerms.length; i++) {
      addPosting(doc.nameTerms[i] + doc.nameTerms[i + 1], docId, F_JOIN);
    }
    doc.typeTerms.forEach(term => { addPosting(term, docId, F_TYPE); addSurface(term, term, 0.5); });
    const brandTokens = tokenize(brand);
    doc.brandTerms.forEach((term, index) => {
      addPosting(term, docId, F_BRAND);
      addSurface(brandTokens[index]?.word || term, term, 0.5);
    });
    if (gender) addPosting(gender, docId, F_GENDER);
    // Colour words ("navy", "black") so "navy caps" finds caps sold in navy.
    const colourTerms = new Set();
    (Array.isArray(row.colour_names) ? row.colour_names : []).forEach(colourName => {
      tokenize(colourName).forEach(token => {
        if (token.word.length < 3 || JUNK_RE.test(token.word) || STOP_WORDS.has(token.word)) return;
        if (colourTerms.has(token.term)) return;
        colourTerms.add(token.term);
        colourSet.add(token.term);
        addPosting(token.term, docId, F_COLOUR);
        addSurface(token.word, token.term, 0.25);
      });
    });

    if (brand) {
      const key = brand.toLowerCase();
      const entry = brandStats.get(key) || { name: brand, slug: row.brand_slug || '', count: 0, terms: doc.brandTerms, docs: [] };
      entry.count++;
      entry.docs.push(docId);
      brandStats.set(key, entry);
    }
    if (typeName) {
      const key = doc.typeTerms.join(' ');
      const entry = typeStats.get(key) || { variants: new Map(), terms: doc.typeTerms, docs: [] };
      const variant = entry.variants.get(typeName) || { slug: row.type_slug || '', count: 0 };
      variant.count++;
      entry.variants.set(typeName, variant);
      entry.docs.push(docId);
      typeStats.set(key, entry);
      const head = doc.typeTerms[doc.typeTerms.length - 1];
      if (head && head.length > 2) nounSet.add(head);
    }
  });

  // Freeze postings into compact typed arrays.
  const postings = new Map();
  for (const [term, byDoc] of postingsBuild) {
    const ids = new Int32Array(byDoc.size);
    const masks = new Uint8Array(byDoc.size);
    let i = 0;
    for (const [docId, mask] of byDoc) {
      ids[i] = docId;
      masks[i] = mask;
      i++;
    }
    postings.set(term, { ids, masks });
  }

  // Surface vocabulary sorted for prefix search, bucketed by length for typo search.
  const surfaces = [...surfaceFreq.keys()].sort();
  const fuzzyBuckets = new Map();
  for (const [word, entry] of surfaceFreq) {
    if (word.length < 3 || entry.freq < 2 || /\d/.test(word)) continue;
    const bucket = fuzzyBuckets.get(word.length) || [];
    bucket.push(word);
    fuzzyBuckets.set(word.length, bucket);
  }

  const codeIndex = docs.map(doc => [doc.codeKey, doc.id]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const codeKeys = codeIndex.map(entry => entry[0]);

  // Database synonyms (product types only) are used as a fallback for unknown words.
  const dbSynonyms = new Map();
  (data.synonyms || []).forEach(row => {
    if (!row || row.synonym_type !== 'product_type') return;
    const from = termsOf(row.term);
    const to = termsOf(row.canonical);
    if (from.length === 1 && to.length >= 1) dbSynonyms.set(from[0], to);
  });

  const brands = [...brandStats.values()].map(entry => ({
    name: entry.name, slug: entry.slug, count: entry.count, terms: entry.terms, fold: foldPhrase(entry.name)
  }));
  const types = [...typeStats.values()].map(entry => {
    const variants = [...entry.variants.entries()].sort((a, b) => b[1].count - a[1].count);
    // Match on the visible part of the name: "Vests (t-shirt)" is a vest category.
    const visibleTerms = termsOf(normalizeDisplay(variants[0][0]));
    return {
      name: variants[0][0],
      slug: variants[0][1].slug,
      count: entry.docs.length,
      terms: visibleTerms.length ? visibleTerms : entry.terms,
      fold: foldPhrase(variants[0][0])
    };
  });

  const phrases = buildPhrases({ docs, brandStats, typeStats, nounSet, keywordSet });
  const phrasePostings = new Map();
  phrases.forEach((phrase, phraseId) => {
    new Set(phrase.terms).forEach(term => {
      const list = phrasePostings.get(term) || [];
      list.push(phraseId);
      phrasePostings.set(term, list);
    });
  });

  // Raw token offsets were only needed for phrase display text.
  docs.forEach(doc => { delete doc.nameTokens; });

  const index = {
    docs, postings, surfaces, surfaceFreq, fuzzyBuckets, codeKeys, codeIndex, dbSynonyms,
    brands, types, phrases, phrasePostings, nounSet, colourSet,
    builtAt: Date.now(),
    buildMs: 0
  };
  index.buildMs = Date.now() - startedAt;
  index.popular = buildPopular(index);
  return index;
}

function genderOf(row) {
  const age = String(row.age || '').toLowerCase();
  if (age === 'kids') return 'kids';
  if (age === 'infant') return 'baby';
  const gender = String(row.gender || '').toLowerCase();
  if (gender === 'female') return 'womens';
  if (gender === 'male') return 'mens';
  if (gender === 'unisex') return 'unisex';
  return null;
}

/**
 * Mine suggestion phrases from product names, product types, gender and brand
 * combinations. Every phrase knows how many live styles it covers.
 */
function buildPhrases({ docs, brandStats, typeStats, nounSet, keywordSet }) {
  const grams = new Map(); // key -> { terms, docs:Set, displays:Map, kind }

  const record = (terms, docId, display, kind) => {
    const key = terms.join(' ');
    let entry = grams.get(key);
    if (!entry) {
      entry = { key, terms, docs: new Set(), displays: new Map(), kind, leftExt: new Map() };
      grams.set(key, entry);
    } else if (kindRank(kind) > kindRank(entry.kind)) {
      entry.kind = kind;
    }
    if (docId != null) entry.docs.add(docId);
    if (display) entry.displays.set(display, (entry.displays.get(display) || 0) + 1);
    return entry;
  };

  docs.forEach(doc => {
    const tokens = doc.nameTokens;
    const brandTerms = new Set(doc.brandTerms);
    const segments = [];
    let current = [];
    tokens.forEach((token, index) => {
      const previous = tokens[index - 1];
      const gap = previous ? doc.name.slice(previous.end, token.start) : '';
      const breaksHere = gap && !/^[\s\-&]*$/.test(gap);
      const isJunk = STOP_WORDS.has(token.word) || JUNK_RE.test(token.word)
        || (token.word.length <= 2 && !SHORT_WORD_ALLOW.has(token.word))
        || brandTerms.has(token.term) || GENDER_TERMS.has(token.term);
      if (breaksHere || isJunk) {
        if (current.length) segments.push(current);
        current = [];
      }
      if (!isJunk) current.push(token);
    });
    if (current.length) segments.push(current);

    segments.forEach(segment => {
      for (let i = 0; i < segment.length; i++) {
        for (let len = 1; len <= 4 && i + len <= segment.length; len++) {
          const slice = segment.slice(i, i + len);
          const terms = slice.map(token => token.term);
          const display = normalizeDisplay(doc.name.slice(slice[0].start, slice[slice.length - 1].end));
          const entry = record(terms, doc.id, display, 'name');
          if (i > 0) {
            const left = segment[i - 1].term;
            entry.leftExt.set(left, (entry.leftExt.get(left) || 0) + 1);
          }
        }
      }
    });
  });

  // Product types are always valid suggestions; their own name is the preferred text.
  for (const entry of typeStats.values()) {
    const variants = [...entry.variants.entries()].sort((a, b) => b[1].count - a[1].count);
    const display = normalizeDisplay(variants[0][0]);
    const terms = termsOf(display);
    if (!terms.length) continue;
    const gram = record(terms, null, null, 'type');
    gram.typeDisplay = display;
    entry.docs.forEach(docId => gram.docs.add(docId));
  }

  const isNoun = term => nounSet.has(term);
  const accepted = [];
  for (const gram of grams.values()) {
    const count = gram.docs.size;
    if (!count) continue;
    const terms = gram.terms;
    const last = terms[terms.length - 1];
    if (gram.kind !== 'type') {
      if (count < (terms.length === 1 ? 2 : 3)) continue;
      if (terms.length === 1) {
        if (!isNoun(last) && !keywordSet.has(last)) continue;
      } else {
        if (!isNoun(last)) continue;
        if (BAD_START.has(terms[0])) continue;
        // Drop fragments that almost always follow one specific word ("sleeve polo").
        let dominant = 0;
        for (const value of gram.leftExt.values()) dominant = Math.max(dominant, value);
        if (dominant / count >= 0.6) continue;
      }
    }
    accepted.push(gram);
  }

  // Gender and brand combinations of accepted product phrases.
  const derived = [];
  const docsById = docs;
  accepted.forEach(gram => {
    if (gram.terms.length > 3 || !isNoun(gram.terms[gram.terms.length - 1])) return;
    if (gram.terms.some(term => GENDER_TERMS.has(term))) return;
    const byGender = new Map();
    gram.docs.forEach(docId => {
      const gender = docsById[docId].gender;
      if (!gender || gender === 'unisex') return;
      if (!byGender.has(gender)) byGender.set(gender, new Set());
      byGender.get(gender).add(docId);
    });
    for (const [gender, set] of byGender) {
      if (set.size < 3 || !GENDER_LABEL[gender]) continue;
      derived.push({
        key: `${gender} ${gram.key}`,
        terms: [gender, ...gram.terms],
        docs: set,
        displays: new Map([[`${GENDER_LABEL[gender]} ${bestDisplay(gram)}`, 1]]),
        kind: 'gender'
      });
    }
  });
  for (const brand of brandStats.values()) {
    const byType = new Map();
    brand.docs.forEach(docId => {
      const doc = docsById[docId];
      if (!doc.typeTerms.length) return;
      const key = doc.typeTerms.join(' ');
      if (!byType.has(key)) byType.set(key, { terms: doc.typeTerms, name: doc.typeName, docs: new Set() });
      byType.get(key).docs.add(docId);
    });
    const brandDisplay = brand.name.toLowerCase().replace(/[®™]/g, '').trim();
    if (!/[a-z]{3}/.test(brandDisplay)) continue;
    for (const entry of byType.values()) {
      if (entry.docs.size < 3) continue;
      const typeDisplay = normalizeDisplay(entry.name);
      const typeTerms = termsOf(typeDisplay);
      if (!typeTerms.length) continue;
      derived.push({
        key: `${brand.terms.join(' ')} ${typeTerms.join(' ')}`,
        terms: [...brand.terms, ...typeTerms],
        docs: entry.docs,
        displays: new Map([[`${brandDisplay} ${typeDisplay}`, 1]]),
        kind: 'brand'
      });
    }
  }

  const byKey = new Map();
  [...accepted, ...derived].forEach(gram => {
    const existing = byKey.get(gram.key);
    if (!existing || kindRank(gram.kind) > kindRank(existing.kind)) byKey.set(gram.key, gram);
  });

  return [...byKey.values()].map(gram => {
    const last = gram.terms[gram.terms.length - 1];
    let display = bestDisplay(gram);
    if (nounSet.has(last) && !UNCOUNTABLE.has(last)) {
      display = pluralizeDisplay(display);
    }
    return {
      terms: gram.terms,
      display,
      fold: foldPhrase(display),
      count: gram.docs.size,
      kind: gram.kind
    };
  });
}

function kindRank(kind) {
  return kind === 'type' ? 3 : kind === 'name' ? 2 : kind === 'gender' ? 1 : 0;
}

function bestDisplay(gram) {
  if (gram.typeDisplay) return gram.typeDisplay;
  let best = '';
  let bestCount = -1;
  for (const [display, count] of gram.displays) {
    if (count > bestCount || (count === bestCount && display < best)) {
      best = display;
      bestCount = count;
    }
  }
  return best;
}

function buildPopular(index) {
  return index.phrases
    .filter(phrase => phrase.kind === 'type' && phrase.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(phrase => ({ label: phrase.display, value: phrase.display }));
}

// ---------------------------------------------------------------------------
// Query time
// ---------------------------------------------------------------------------

/**
 * Expand one query token into the catalogue terms it can match, with weights.
 * The last token is treated as a prefix while the customer is still typing.
 */
function expandToken(index, token, isPrefix) {
  const alts = new Map();
  const add = (term, weight) => {
    if (!index.postings.has(term)) return;
    if ((alts.get(term) || 0) < weight) alts.set(term, weight);
  };
  const result = { token, alts, corrected: null, via: 'exact', isPrefix: !!isPrefix, colourOnly: false };

  add(token.term, 1);
  result.colourOnly = index.colourSet.has(token.term) && !index.nounSet.has(token.term)
    && !index.phrasePostings.has(token.term);

  if (isPrefix) {
    const word = token.word;
    const start = lowerBound(index.surfaces, word);
    const candidates = [];
    for (let i = start; i < index.surfaces.length; i++) {
      const surface = index.surfaces[i];
      if (!surface.startsWith(word)) break;
      candidates.push(surface);
    }
    if (word.length === 1 && candidates.length > 60) {
      candidates.sort((a, b) => index.surfaceFreq.get(b).freq - index.surfaceFreq.get(a).freq);
      candidates.length = 60;
    }
    candidates.forEach(surface => {
      const entry = index.surfaceFreq.get(surface);
      add(entry.term, surface === word ? 1 : 0.72 + 0.25 * (word.length / surface.length));
    });
  } else if (!alts.size && token.word.length >= 4) {
    const start = lowerBound(index.surfaces, token.word);
    for (let i = start; i < index.surfaces.length && i < start + 40; i++) {
      const surface = index.surfaces[i];
      if (!surface.startsWith(token.word)) break;
      add(index.surfaceFreq.get(surface).term, 0.7);
    }
  }
  if (alts.size) {
    if (!alts.has(token.term)) result.via = 'prefix';
    return result;
  }

  const synonyms = WORD_SYNONYMS.get(token.term) || index.dbSynonyms.get(token.term);
  if (synonyms) {
    synonyms.forEach(term => add(term, 0.85));
    if (alts.size) {
      result.via = 'synonym';
      return result;
    }
  }

  // Typo tolerance: nearest frequent catalogue word.
  const word = token.word;
  if (word.length >= 3 && !/\d/.test(word)) {
    const maxDistance = word.length >= 8 ? 2 : 1;
    let best = null;
    const consider = (surface, distance) => {
      const freq = index.surfaceFreq.get(surface).freq;
      if (!best || distance < best.distance || (distance === best.distance && freq > best.freq)) {
        best = { surface, distance, freq };
      }
    };
    for (let len = word.length - maxDistance; len <= word.length + maxDistance; len++) {
      const bucket = index.fuzzyBuckets.get(len);
      if (!bucket) continue;
      for (const surface of bucket) {
        if (surface[0] !== word[0] && word.length < 6) continue;
        const distance = damerau(word, surface, maxDistance);
        if (distance <= maxDistance) consider(surface, distance);
      }
    }
    // While typing, also try correcting the typed prefix ("hodd" -> "hood...").
    if (!best && isPrefix && word.length >= 4) {
      for (const [len, bucket] of index.fuzzyBuckets) {
        if (len < word.length) continue;
        for (const surface of bucket) {
          if (surface[0] !== word[0] || index.surfaceFreq.get(surface).freq < 3) continue;
          const distance = damerau(word, surface.slice(0, word.length), 1);
          if (distance <= 1) consider(surface, distance + 0.5);
        }
      }
    }
    if (best) {
      add(index.surfaceFreq.get(best.surface).term, 0.8);
      result.corrected = best.surface;
      result.via = 'fuzzy';
      return result;
    }
  }

  result.via = 'none';
  return result;
}

/**
 * Looser version of an expansion used only to top up a short product list:
 * word roots ("running" -> run...) and spellings up to two edits away.
 * Returns null when it would add nothing new.
 */
function widenExpansion(index, expansion) {
  const word = expansion.token.word;
  if (word.length < 4 || /\d/.test(word)) return null;
  const alts = new Map(expansion.alts);
  const before = alts.size;
  const add = term => { if (index.postings.has(term) && !alts.has(term)) alts.set(term, 0.5); };

  const root = word.replace(/(ing|ers|er|ed|es|s)$/, '').replace(/([b-df-hj-np-tv-z])\1$/, '$1');
  if (root.length >= 3 && root !== word) {
    const start = lowerBound(index.surfaces, root);
    for (let i = start; i < index.surfaces.length && i < start + 30; i++) {
      if (!index.surfaces[i].startsWith(root)) break;
      add(index.surfaceFreq.get(index.surfaces[i]).term);
    }
  }
  const maxDistance = word.length >= 5 ? 2 : 1;
  for (let len = word.length - maxDistance; len <= word.length + maxDistance; len++) {
    const bucket = index.fuzzyBuckets.get(len);
    if (!bucket) continue;
    for (const surface of bucket) {
      if (surface[0] !== word[0]) continue;
      if (damerau(word, surface, maxDistance) <= maxDistance) add(index.surfaceFreq.get(surface).term);
    }
  }
  return alts.size > before ? { ...expansion, alts, via: 'widened' } : null;
}

function parseQuery(raw) {
  const text = String(raw == null ? '' : raw).slice(0, 120);
  let tokens = tokenize(text).slice(0, 8);
  const endsWithSpace = /\s$/.test(text);
  // Half-typed compounds: "t-sh" / "hi v" should search as "tsh..." / "hiv...".
  if (!endsWithSpace && tokens.length >= 2) {
    const previous = tokens[tokens.length - 2];
    const last = tokens[tokens.length - 1];
    for (const [pair, merged] of MERGE_PAIRS) {
      const [first, second] = pair.split('|');
      if (previous.term === first && second !== last.term && second.startsWith(last.word)) {
        tokens = [...tokens.slice(0, -2), { word: previous.word + last.word, term: merged, start: previous.start, end: last.end }];
        break;
      }
    }
  }
  return { text, tokens, endsWithSpace, folded: foldPhrase(text) };
}

/** Rewrite multi-word intents ("hard hats" -> helmet). Returns null when none apply. */
function phraseRewrite(tokens) {
  const terms = tokens.map(token => token.term);
  for (const rule of PHRASE_SYNONYMS) {
    for (let i = 0; i + rule.terms.length <= terms.length; i++) {
      if (rule.terms.every((term, offset) => terms[i + offset] === term)) {
        const replacement = tokenize(rule.to);
        return {
          rule,
          tokens: [...tokens.slice(0, i), ...replacement, ...tokens.slice(i + rule.terms.length)]
        };
      }
    }
  }
  return null;
}

function byScore(a, b) {
  return b.score - a.score
    || a.doc.name.length - b.doc.name.length
    || (a.doc.code < b.doc.code ? -1 : a.doc.code > b.doc.code ? 1 : 0);
}

/** Best k items without sorting the whole candidate list. */
function topK(items, k) {
  if (items.length <= k * 4) return items.sort(byScore).slice(0, k);
  const best = [];
  for (const item of items) {
    if (best.length < k) {
      best.push(item);
      if (best.length === k) best.sort(byScore);
    } else if (byScore(item, best[k - 1]) < 0) {
      let position = k - 1;
      while (position > 0 && byScore(item, best[position - 1]) < 0) position--;
      best.splice(position, 0, item);
      best.pop();
    }
  }
  return best.length < k ? best.sort(byScore) : best;
}

function rankProducts(index, expansions, options = {}) {
  const { docs } = index;
  const n = docs.length;
  const genderWanted = new Set();
  const required = [];
  expansions.forEach(expansion => {
    if (GENDER_TERMS.has(expansion.token.term) && expansion.via === 'exact') genderWanted.add(expansion.token.term);
    else if (expansion.alts.size) required.push(expansion);
  });

  const weights = required.map(expansion => {
    const w = new Float32Array(n);
    for (const [term, termWeight] of expansion.alts) {
      const posting = index.postings.get(term);
      if (!posting) continue;
      for (let k = 0; k < posting.ids.length; k++) {
        const value = termWeight * fieldWeight(posting.masks[k]);
        const docId = posting.ids[k];
        if (value > w[docId]) w[docId] = value;
      }
    }
    return w;
  });

  const intentTerms = Array.isArray(options.intentTerms) && options.intentTerms.length ? options.intentTerms : null;
  const nounIndexes = [];
  required.forEach((expansion, i) => {
    if ([...expansion.alts.keys()].some(term => index.nounSet.has(term))) nounIndexes.push(i);
  });

  const conflicts = doc => {
    if (!genderWanted.size) return false;
    if (genderWanted.has('kids') || genderWanted.has('baby')) {
      return !(doc.gender === 'kids' || doc.gender === 'baby'
        || doc.nameTerms.includes('kids') || doc.nameTerms.includes('baby'));
    }
    if (genderWanted.has('womens') && doc.gender === 'mens') return true;
    if (genderWanted.has('mens') && doc.gender === 'womens') return true;
    return false;
  };

  const scored = [];
  const relaxed = [];
  for (let d = 0; d < n; d++) {
    const doc = docs[d];
    let matched = 0;
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      const value = weights[i][d];
      if (value > 0) {
        matched++;
        sum += value;
      }
    }
    if (!weights.length) {
      if (!genderWanted.size) continue;
    } else if (matched === 0) {
      continue;
    }
    if (conflicts(doc)) continue;

    let score = sum * 100;
    // Word order and adjacency inside the product name.
    let lastPos = -1;
    let inOrder = true;
    let adjacent = true;
    let inName = 0;
    for (let i = 0; i < required.length; i++) {
      const alts = required[i].alts;
      let pos = -1;
      for (let j = 0; j < doc.nameTerms.length; j++) {
        if (alts.has(doc.nameTerms[j])) { pos = j; break; }
      }
      if (pos < 0) { inOrder = false; adjacent = false; continue; }
      inName++;
      if (pos <= lastPos) inOrder = false;
      if (lastPos >= 0 && pos !== lastPos + 1) adjacent = false;
      if (i === 0 && pos === 0) score += 10;
      lastPos = pos;
    }
    if (required.length && inName === required.length) score += 25;
    if (required.length > 1 && inOrder) score += 10;
    if (required.length > 1 && adjacent) score += 20;
    if (required.some(expansion => doc.typeTerms.some(term => expansion.alts.has(term)))) score += 15;
    if (genderWanted.size && genderWanted.has(doc.gender)) score += 30;
    if (genderWanted.size && doc.nameTerms.some(term => genderWanted.has(term))) score += 40;
    // Products that fit the top completion ("v-neck t-shirts" while typing "t-shirt v").
    if (intentTerms && intentTerms.every(term => doc.nameTerms.includes(term)
      || doc.typeTerms.includes(term) || doc.gender === term)) score += 60;
    score += doc.popularity;
    score -= Math.max(0, doc.nameTerms.length - 4) * 1.2;

    if (matched === weights.length) {
      scored.push({ doc, score });
    } else if (weights.length > 1 && matched === weights.length - 1) {
      // Partial matches that still contain the product noun ("hats" for "hard hats")
      // are far more useful than ones that only share an adjective.
      const keepsNoun = nounIndexes.every(i => weights[i][d] > 0);
      relaxed.push({ doc, score: score - 120 + (keepsNoun ? 80 : 0) });
    }
  }

  const limit = Math.max(1, Number(options.limit) || 12);
  return {
    exact: topK(scored, limit),
    // Partial matches are only ever shown to fill a short list.
    relaxed: scored.length >= limit ? [] : topK(relaxed, limit),
    total: scored.length
  };
}

function codeMatches(index, folded) {
  const key = folded.replace(/[^a-z0-9]/g, '');
  if (key.length < 2) return [];
  const start = lowerBound(index.codeKeys, key);
  const out = [];
  for (let i = start; i < index.codeKeys.length && out.length < 200; i++) {
    if (!index.codeKeys[i].startsWith(key)) break;
    out.push(index.docs[index.codeIndex[i][1]]);
  }
  return out;
}

function matchPhrases(index, expansions, folded) {
  const usable = expansions.filter(expansion => expansion.alts.size && !expansion.colourOnly);
  if (!usable.length) return [];
  const compact = String(folded || '').replace(/ /g, '');

  // Candidate phrases come from the most selective token.
  let candidateIds = null;
  let smallest = Infinity;
  usable.forEach(expansion => {
    const ids = new Set();
    for (const term of expansion.alts.keys()) {
      const list = index.phrasePostings.get(term);
      if (list) list.forEach(id => ids.add(id));
    }
    if (ids.size < smallest) {
      smallest = ids.size;
      candidateIds = ids;
    }
  });
  if (!candidateIds || !candidateIds.size) return [];

  const results = [];
  for (const phraseId of candidateIds) {
    const phrase = index.phrases[phraseId];
    const used = new Array(phrase.terms.length).fill(false);
    const hitTerms = [];
    let exact = 0;
    let ok = true;
    let previous = -1;
    let ordered = true;
    for (const expansion of usable) {
      let hit = -1;
      for (let j = 0; j < phrase.terms.length; j++) {
        if (!used[j] && expansion.alts.has(phrase.terms[j])) { hit = j; break; }
      }
      if (hit < 0) { ok = false; break; }
      used[hit] = true;
      hitTerms.push(phrase.terms[hit]);
      // A word still being typed should rank by popularity, not by being an exact word.
      if (!expansion.isPrefix && phrase.terms[hit] === expansion.token.term) exact++;
      if (hit < previous) ordered = false;
      previous = hit;
    }
    if (!ok) continue;
    const startsWith = !!compact && phrase.fold.replace(/ /g, '').startsWith(compact);
    const extra = phrase.terms.length - usable.length;
    const kindBonus = phrase.kind === 'type' ? 15 : phrase.kind === 'name' ? 10 : phrase.kind === 'gender' ? 0 : -5;
    const score = (startsWith ? 1000 : 0) + (ordered ? 150 : 0) + exact * 60 - extra * 28
      + Math.log(phrase.count + 1) * 14 + kindBonus;
    results.push({ phrase, score, startsWith, hitTerms });
  }
  results.sort((a, b) => b.score - a.score || b.phrase.count - a.phrase.count);

  const seen = new Set();
  const out = [];
  for (const result of results) {
    const key = result.phrase.fold.replace(/s\b/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
    if (out.length >= 8) break;
  }
  return out;
}

function matchBrands(index, expansions, folded) {
  if (!folded) return [];
  const results = [];
  index.brands.forEach(brand => {
    let score = 0;
    if (brand.fold.startsWith(folded)) score = 300;
    else if (brand.fold.includes(` ${folded}`)) score = 200;
    else if (expansions.length && expansions.every(expansion => brand.terms.some(term => expansion.alts.has(term)))) score = 120;
    if (!score) return;
    results.push({ brand, score: score + Math.log(brand.count + 1) * 10 });
  });
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3).map(result => result.brand);
}

function matchTypes(index, expansions) {
  const usable = expansions.filter(expansion => expansion.alts.size && !expansion.colourOnly
    && !GENDER_TERMS.has(expansion.token.term));
  if (!usable.length) return [];
  const results = [];
  index.types.forEach(type => {
    const ok = usable.every(expansion => type.terms.some(term => expansion.alts.has(term)));
    if (!ok) return;
    const extra = type.terms.length - usable.length;
    results.push({ type, score: Math.log(type.count + 1) * 10 - extra * 8 });
  });
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3).map(result => result.type);
}

function productPayload(doc) {
  return {
    label: doc.name,
    value: doc.code,
    code: doc.code,
    name: doc.name,
    image: doc.image,
    brand: doc.brand || null,
    price: Number.isFinite(doc.price) ? doc.price : 0,
    type: 'product'
  };
}

/**
 * Answer one keystroke.
 * @returns {object} payload compatible with the legacy SQL suggest response.
 */
function suggestFromIndex(index, rawQuery, options = {}) {
  const started = process.hrtime.bigint();
  const limit = Math.min(24, Math.max(1, Number(options.limit) || 12));
  const query = parseQuery(rawQuery);
  if (!query.tokens.length) {
    return emptyPayload(query.text);
  }

  const lastIndex = query.tokens.length - 1;
  const expand = tokens => tokens.map((token, i) => expandToken(index, token, i === lastIndex && !query.endsWithSpace && i === tokens.length - 1));

  const expansions = expand(query.tokens);
  const corrections = expansions.filter(expansion => expansion.corrected);
  const correctedQuery = corrections.length
    ? query.tokens.map((token, i) => expansions[i].corrected || token.word).join(' ')
    : null;

  const rewrite = phraseRewrite(query.tokens);
  const rewriteExpansions = rewrite ? rewrite.tokens.map(token => expandToken(index, token, false)) : null;

  // Products: phrase rewrite first, then the literal query, then partial matches.
  const picked = new Map();
  const take = (list, boost) => {
    for (const item of list) {
      if (picked.size >= limit) break;
      if (!picked.has(item.doc.id)) picked.set(item.doc.id, { doc: item.doc, score: item.score + boost });
    }
  };
  let total = 0;
  const looksLikeCode = /\d/.test(query.folded) || query.tokens.length === 1;
  const codes = query.tokens.length <= 2 ? codeMatches(index, query.folded) : [];
  // The top completion is the strongest signal of what the customer is typing towards.
  const chipResults = matchPhrases(index, expansions, query.folded);
  const intentTerms = chipResults[0] ? chipResults[0].hitTerms : null;
  const ranked = rankProducts(index, expansions, { limit, intentTerms });
  const rewritten = rewriteExpansions ? rankProducts(index, rewriteExpansions, { limit }) : null;

  if (codes.length && (/\d/.test(query.folded) || !ranked.exact.length)) {
    take(codes.map(doc => ({ doc, score: 1000 + doc.popularity })), 0);
  }
  if (rewritten) take(rewritten.exact, 500);
  take(ranked.exact, 0);
  if (codes.length && looksLikeCode) take(codes.map(doc => ({ doc, score: doc.popularity })), 0);
  if (rewritten) take(rewritten.relaxed, 0);
  take(ranked.relaxed, 0);
  // Still short? Widen spelling and word roots so the list is never thinner than it could be.
  if (picked.size < limit) {
    const widened = expansions.map(expansion => widenExpansion(index, expansion));
    if (widened.some(Boolean)) {
      const wide = rankProducts(index, widened.map((expansion, i) => expansion || expansions[i]), { limit });
      take(wide.exact, 0);
      take(wide.relaxed, 0);
    }
  }
  total = Math.max(ranked.total + (rewritten ? rewritten.total : 0), codes.length) || picked.size;

  // Suggestions (chips).
  const chips = [];
  if (rewrite) chips.push({ label: rewrite.rule.label, value: rewrite.rule.to, kind: 'synonym' });
  chipResults.forEach(result => chips.push({ label: result.phrase.display, value: result.phrase.display, kind: result.phrase.kind }));
  if (chips.length < 3) {
    // Broaden with the most specific product noun so the row is never empty.
    const nounExpansion = [...expansions].reverse().find(expansion => [...expansion.alts.keys()].some(term => index.nounSet.has(term)));
    if (nounExpansion) {
      matchPhrases(index, [nounExpansion], '').forEach(result => {
        if (chips.length < 6) chips.push({ label: result.phrase.display, value: result.phrase.display, kind: result.phrase.kind });
      });
    }
  }
  const seenChips = new Set();
  const suggestions = chips.filter(chip => {
    const key = foldPhrase(chip.label).replace(/s\b/g, '');
    if (seenChips.has(key)) return false;
    seenChips.add(key);
    return true;
  }).slice(0, 6);

  const brands = matchBrands(index, expansions, query.folded);
  const types = matchTypes(index, expansions);

  // Ghost completion = the top suggestion, when it literally extends what was typed.
  let completion = null;
  if (query.folded.length >= 2 && !correctedQuery) {
    const top = suggestions[0];
    const topFold = top ? foldPhrase(top.label) : '';
    if (top && topFold.startsWith(query.folded) && topFold !== query.folded.trim()) {
      completion = top.label;
    } else if (!top) {
      const brand = brands.find(entry => entry.fold.startsWith(query.folded) && entry.fold !== query.folded.trim());
      if (brand) completion = brand.name.toLowerCase();
    }
  }

  const products = [...picked.values()].map(item => productPayload(item.doc));
  const tookMs = Number(process.hrtime.bigint() - started) / 1e6;

  return {
    query: query.text,
    correctedQuery,
    completion,
    suggestions,
    keywords: suggestions.map(chip => ({ label: chip.label, value: chip.value, type: 'keyword' })),
    brands: brands.map(brand => ({ label: brand.name, value: brand.slug, type: 'brand', count: brand.count })),
    types: types.map(type => ({ label: type.name, value: type.slug, type: 'type', count: type.count })),
    products,
    total,
    engine: 'memory',
    tookMs: Math.round(tookMs * 100) / 100
  };
}

function emptyPayload(text) {
  return {
    query: text || '',
    correctedQuery: null,
    completion: null,
    suggestions: [],
    keywords: [],
    brands: [],
    types: [],
    products: [],
    total: 0,
    engine: 'memory',
    tookMs: 0
  };
}

// ---------------------------------------------------------------------------
// Catalogue loading + lifecycle (one index per process)
// ---------------------------------------------------------------------------

const CATALOGUE_SQL = `
  SELECT s.style_code, s.style_name, b.name AS brand, b.slug AS brand_slug,
         pt.name AS type_name, pt.slug AS type_slug, g.slug AS gender, ag.slug AS age,
         s.is_best_seller, s.is_featured, s.is_recommended,
         agg.price, agg.image, agg.colours, agg.colour_names
  FROM styles s
  INNER JOIN (
    SELECT style_code,
           MIN(sell_price) AS price,
           MIN(NULLIF(primary_image_url, 'Not available')) AS image,
           COUNT(DISTINCT colour_name)::int AS colours,
           ARRAY_AGG(DISTINCT LOWER(colour_name)) FILTER (WHERE colour_name IS NOT NULL) AS colour_names
    FROM products
    WHERE sku_status = 'Live' AND sell_price IS NOT NULL AND sell_price < 999.99
    GROUP BY style_code
  ) agg ON agg.style_code = s.style_code
  LEFT JOIN brands b ON b.id = s.brand_id
  LEFT JOIN product_types pt ON pt.id = s.product_type_id
  LEFT JOIN genders g ON g.id = s.gender_id
  LEFT JOIN age_groups ag ON ag.id = s.age_group_id
`;

const SIGNATURE_SQL = `
  SELECT (SELECT COUNT(*) FROM styles)::text || ':' ||
         COALESCE((SELECT MAX(updated_at) FROM styles)::text, '') || ':' ||
         (SELECT COUNT(*) FROM products WHERE sku_status = 'Live')::text || ':' ||
         COALESCE((SELECT SUM(sell_price) FROM products WHERE sku_status = 'Live')::text, '') AS signature
`;

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
const RESULT_CACHE_SIZE = 3000;

const state = {
  index: null,
  signature: null,
  building: null,
  lastFailureAt: 0,
  timer: null,
  staleTimer: null,
  cache: new Map()
};

function db() {
  // Lazy so unit tests can load the pure index without database configuration.
  return require('../../config/database');
}

async function loadCatalogue() {
  const { queryWithTimeout } = db();
  const [styles, keywords, synonyms, signature] = await Promise.all([
    queryWithTimeout(CATALOGUE_SQL, [], 60000),
    queryWithTimeout(`
      SELECT name FROM style_keywords
      UNION SELECT name FROM fabrics
      UNION SELECT name FROM related_sectors
      UNION SELECT name FROM related_sports
    `, [], 20000).catch(() => ({ rows: [] })),
    queryWithTimeout('SELECT term, canonical, synonym_type FROM search_synonyms', [], 20000).catch(() => ({ rows: [] })),
    queryWithTimeout(SIGNATURE_SQL, [], 20000).catch(() => ({ rows: [{ signature: null }] }))
  ]);
  return {
    styles: styles.rows,
    keywords: keywords.rows.map(row => row.name),
    synonyms: synonyms.rows,
    signature: signature.rows[0]?.signature || null
  };
}

async function build(reason = 'manual') {
  if (state.building) return state.building;
  state.building = (async () => {
    try {
      const data = await loadCatalogue();
      const index = createIndex(data);
      state.index = index;
      state.signature = data.signature;
      state.cache.clear();
      console.log(`[SUGGEST] Index built (${reason}): ${index.docs.length} styles, ${index.phrases.length} phrases in ${index.buildMs}ms`);
      return index;
    } catch (error) {
      state.lastFailureAt = Date.now();
      console.warn(`[SUGGEST] Index build failed (${reason}):`, error.message);
      throw error;
    } finally {
      state.building = null;
    }
  })();
  return state.building;
}

async function refreshIfChanged() {
  if (!state.index) return build('initial');
  try {
    const { queryWithTimeout } = db();
    const result = await queryWithTimeout(SIGNATURE_SQL, [], 20000);
    const signature = result.rows[0]?.signature || null;
    if (signature && signature !== state.signature) return build('catalogue changed');
  } catch (error) {
    console.warn('[SUGGEST] Signature check failed:', error.message);
  }
  return state.index;
}

/** Kick off a build when needed without blocking the caller. */
function ensureBuilt() {
  if (state.index || state.building) return;
  if (Date.now() - state.lastFailureAt < RETRY_AFTER_FAILURE_MS) return;
  build('on demand').catch(() => {});
}

function startAutoRefresh() {
  if (state.timer) return;
  state.timer = setInterval(() => {
    refreshIfChanged().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if (typeof state.timer.unref === 'function') state.timer.unref();
}

/** Called after admin/catalogue changes: rebuild shortly, coalescing bursts. */
function markStale() {
  if (state.staleTimer) clearTimeout(state.staleTimer);
  state.staleTimer = setTimeout(() => {
    state.staleTimer = null;
    build('cache invalidation').catch(() => {});
  }, 5000);
  if (typeof state.staleTimer.unref === 'function') state.staleTimer.unref();
}

function isReady() {
  return !!state.index;
}

function suggest(rawQuery, options = {}) {
  if (!state.index) return null;
  const key = `${foldPhrase(rawQuery)}|${/\s$/.test(String(rawQuery || '')) ? 1 : 0}|${options.limit || 12}`;
  const cached = state.cache.get(key);
  if (cached) {
    state.cache.delete(key);
    state.cache.set(key, cached);
    return { ...cached, query: String(rawQuery || '').slice(0, 120), cached: true };
  }
  const payload = suggestFromIndex(state.index, rawQuery, options);
  state.cache.set(key, payload);
  if (state.cache.size > RESULT_CACHE_SIZE) state.cache.delete(state.cache.keys().next().value);
  return payload;
}

/**
 * True when every word already appears in the live catalogue (names, types, brands,
 * colours). Such words are spelled correctly, so they must not be fuzzy-matched to
 * look-alikes ("backpack" is not "Snap Back", "scrub" is not "Scruffs").
 * Returns null while the index is still building (callers keep their old behaviour).
 */
function knowsAllWords(words) {
  const index = state.index;
  if (!index) return null;
  const tokens = tokenize((Array.isArray(words) ? words : [words]).join(' '));
  if (!tokens.length) return false;
  return tokens.every(token => index.postings.has(token.term));
}

function popular() {
  return state.index ? state.index.popular : [];
}

function getStats() {
  const index = state.index;
  return {
    ready: !!index,
    styles: index ? index.docs.length : 0,
    phrases: index ? index.phrases.length : 0,
    builtAt: index ? new Date(index.builtAt).toISOString() : null,
    buildMs: index ? index.buildMs : null,
    cachedQueries: state.cache.size
  };
}

module.exports = {
  // lifecycle
  build,
  ensureBuilt,
  refreshIfChanged,
  startAutoRefresh,
  markStale,
  isReady,
  knowsAllWords,
  suggest,
  popular,
  getStats,
  // pure helpers (tests)
  createIndex,
  suggestFromIndex,
  tokenize,
  foldPhrase,
  stem,
  pluralizeDisplay
};
