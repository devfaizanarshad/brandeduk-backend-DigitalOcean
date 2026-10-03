/**
 * Parses catalogue searches into strict identity filters and descriptive signals.
 */

const { queryWithTimeout } = require('../../config/database');
const synonyms = require('./searchSynonyms');

let lookupCache = null;
let lookupCacheTimestamp = 0;

function normalizedName(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[®™©]/g, '')
        .trim();
}

function toNameSet(rows) {
    return new Set(rows.map(row => normalizedName(row.name)).filter(Boolean));
}

function toSlugMap(rows) {
    const map = new Map();
    rows.forEach(row => {
        const name = normalizedName(row.name);
        const slug = String(row.slug || row.name || '').toLowerCase().trim();
        if (name) map.set(name, slug);
        if (slug) map.set(slug, slug);
    });
    return map;
}

async function loadLookups() {
    if (lookupCache && Date.now() - lookupCacheTimestamp < 600000) return lookupCache;

    const [brands, types, keywords, fabrics, sectors, colours, sports, genders] = await Promise.all([
        queryWithTimeout('SELECT name FROM brands', []),
        queryWithTimeout('SELECT name FROM product_types', []),
        queryWithTimeout('SELECT name, slug, keyword_type FROM style_keywords', []),
        queryWithTimeout('SELECT name, slug FROM fabrics', []),
        queryWithTimeout('SELECT name, slug FROM related_sectors', []),
        queryWithTimeout('SELECT DISTINCT primary_colour as name FROM products WHERE primary_colour IS NOT NULL', []),
        queryWithTimeout('SELECT name, slug FROM related_sports', []),
        queryWithTimeout('SELECT name, slug FROM genders', [])
    ]);

    const keywordRows = keywords.rows;
    const keywordMap = type => toSlugMap(keywordRows.filter(row => row.keyword_type === type));

    lookupCache = {
        brands: toNameSet(brands.rows),
        types: toNameSet(types.rows),
        sports: toSlugMap([
            ...keywordRows.filter(row => row.keyword_type === 'sport'),
            ...sports.rows
        ]),
        fits: keywordMap('fit'),
        sleeves: keywordMap('sleeve'),
        necklines: keywordMap('neckline'),
        features: keywordMap('feature'),
        keywords: toSlugMap(keywordRows),
        fabrics: toSlugMap(fabrics.rows),
        sectors: toSlugMap(sectors.rows),
        genders: toSlugMap(genders.rows),
        colours: toNameSet(colours.rows)
    };
    lookupCacheTimestamp = Date.now();
    return lookupCache;
}

async function parseSearchQuery(rawQuery) {
    const query = rawQuery.toLowerCase().trim();
    const lookups = await loadLookups();
    await synonyms.ensureLoaded();

    const tokens = query.split(/\s+/);
    const result = {
        brand: null,
        productType: null,
        sports: [],
        fits: [],
        sleeves: [],
        necklines: [],
        fabrics: [],
        sectors: [],
        genders: [],
        colours: [],
        features: [],
        keywords: [],
        freeText: [],
        styleCode: null
    };

    const resolved = synonyms.resolveTokens(tokens);
    const terms = resolved.map(item => item.canonical);

    const styleCodePattern = /^[a-z0-9]{2,10}$/i;
    for (const term of terms) {
        if (styleCodePattern.test(term) && /[a-z]/i.test(term) && /\d/.test(term)) {
            result.styleCode = rawQuery.trim();
            break;
        }
    }

    function classifyTerm(term, resolvedItem) {
        if (resolvedItem && resolvedItem.type === 'gender') {
            result.genders.push(lookups.genders.get(term) || term);
            return true;
        }

        const allowBrandTypeMatch = !resolvedItem || resolvedItem.type === 'product_type';
        const isBrand = lookups.brands.has(term);
        const isType = allowBrandTypeMatch && lookups.types.has(term);

        if (isBrand && isType) {
            result.brand = term;
            result.productType = term;
        } else if (isBrand) {
            result.brand = term;
        } else if (isType) {
            result.productType = term;
        } else if (lookups.sports.has(term)) {
            result.sports.push(lookups.sports.get(term));
        } else if (lookups.fits.has(term)) {
            result.fits.push(lookups.fits.get(term));
        } else if (lookups.sleeves.has(term)) {
            result.sleeves.push(lookups.sleeves.get(term));
        } else if (lookups.necklines.has(term)) {
            result.necklines.push(lookups.necklines.get(term));
        } else if (lookups.fabrics.has(term)) {
            result.fabrics.push(lookups.fabrics.get(term));
        } else if (lookups.sectors.has(term)) {
            result.sectors.push(lookups.sectors.get(term));
        } else if (lookups.colours.has(term) || (resolvedItem && resolvedItem.type === 'colour')) {
            result.colours.push(term);
        } else if (lookups.features.has(term)) {
            result.features.push(lookups.features.get(term));
        } else if (lookups.keywords.has(term) || (resolvedItem && resolvedItem.type === 'attribute')) {
            result.keywords.push(lookups.keywords.get(term) || term);
        } else {
            return false;
        }
        return true;
    }

    const consumed = new Array(terms.length).fill(false);

    for (let index = 0; index <= terms.length - 3; index++) {
        if (consumed[index] || consumed[index + 1] || consumed[index + 2]) continue;
        const phrase = `${terms[index]} ${terms[index + 1]} ${terms[index + 2]}`;
        if (classifyTerm(phrase, null)) {
            consumed[index] = consumed[index + 1] = consumed[index + 2] = true;
        }
    }

    for (let index = 0; index <= terms.length - 2; index++) {
        if (consumed[index] || consumed[index + 1]) continue;
        const phrase = `${terms[index]} ${terms[index + 1]}`;
        if (classifyTerm(phrase, null)) {
            consumed[index] = consumed[index + 1] = true;
        }
    }

    for (let index = 0; index < terms.length; index++) {
        if (!consumed[index] && classifyTerm(terms[index], resolved[index])) consumed[index] = true;
    }

    for (let index = 0; index < terms.length; index++) {
        if (!consumed[index]) result.freeText.push(terms[index]);
    }

    return result;
}

function invalidateCache() {
    lookupCache = null;
    lookupCacheTimestamp = 0;
}

async function warmSearchCache() {
    await Promise.all([loadLookups(), synonyms.ensureLoaded()]);
}

module.exports = { parseSearchQuery, invalidateCache, warmSearchCache };
