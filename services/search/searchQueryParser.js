/**
 * searchQueryParser.js — Final Production Query Parser
 */

const { queryWithTimeout } = require('../../config/database');
const synonyms = require('./searchSynonyms');

let lookupCache = null;
let lookupCacheTimestamp = 0;

async function loadLookups() {
    if (lookupCache && (Date.now() - lookupCacheTimestamp < 600000)) return lookupCache;

    // Load ALL entity types for robust parsing
    const [brands, types, sk, fabrics, sectors, colours, sports] = await Promise.all([
        queryWithTimeout('SELECT name FROM brands', []),
        queryWithTimeout('SELECT name FROM product_types', []),
        queryWithTimeout('SELECT name, keyword_type FROM style_keywords', []),
        queryWithTimeout('SELECT name FROM fabrics', []),
        queryWithTimeout('SELECT name FROM related_sectors', []),
        queryWithTimeout('SELECT DISTINCT primary_colour as name FROM products WHERE primary_colour IS NOT NULL', []),
        queryWithTimeout('SELECT name FROM related_sports', [])
    ]);

    // Strip trademark chars (®, ™, ©) so user input 'adidas' matches DB 'adidas®'
    const normalize = (rows) => new Set(rows.map(r => r.name.toLowerCase().trim().replace(/[®™©]/g, '').trim()));

    lookupCache = {
        brands: normalize(brands.rows),
        types: normalize(types.rows),
        // Fix: Load sports from both style_keywords (if any) AND related_sports table
        sports: new Set([
            ...sk.rows.filter(r => r.keyword_type === 'sport').map(r => r.name.toLowerCase().trim()),
            ...sports.rows.map(r => r.name.toLowerCase().trim())
        ]),
        fits: new Set(sk.rows.filter(r => r.keyword_type === 'fit').map(r => r.name.toLowerCase().trim())),
        sleeves: new Set(sk.rows.filter(r => r.keyword_type === 'sleeve').map(r => r.name.toLowerCase().trim())),
        necklines: new Set(sk.rows.filter(r => r.keyword_type === 'neckline').map(r => r.name.toLowerCase().trim())),
        features: new Set(sk.rows.filter(r => r.keyword_type === 'feature').map(r => r.name.toLowerCase().trim())), // e.g. "breathable"
        fabrics: normalize(fabrics.rows),
        sectors: normalize(sectors.rows),
        colours: normalize(colours.rows)
    };
    lookupCacheTimestamp = Date.now();
    return lookupCache;
}

async function parseSearchQuery(rawQuery) {
    const query = rawQuery.toLowerCase().trim();
    const lookups = await loadLookups();
    await synonyms.ensureLoaded();

    let tokens = query.split(/\s+/);
    const result = {
        brand: null,
        productType: null,
        sports: [],
        fits: [],
        sleeves: [],
        necklines: [],
        fabrics: [],
        sectors: [],
        colours: [],
        features: [],
        freeText: [],
        styleCode: null
    };

    // First pass: resolve synonyms (handles 2-word synonym phrases)
    const resolved = synonyms.resolveTokens(tokens);

    // Extract canonical terms from resolved tokens
    const terms = resolved.map(item => item.canonical);

    // Style code detection: alphanumeric 2-10 chars with both letters AND digits (e.g. AD002, NK170, 7620B)
    const styleCodePattern = /^[a-z0-9]{2,10}$/i;
    for (let i = 0; i < terms.length; i++) {
        const t = terms[i];
        if (styleCodePattern.test(t) && /[a-z]/i.test(t) && /\d/.test(t)) {
            result.styleCode = rawQuery.trim(); // preserve original case for style code
            break;
        }
    }

    // Helper: classify a term against all lookups
    function classifyTerm(term, resolvedItem) {
        const isBrand = lookups.brands.has(term);
        const isType = lookups.types.has(term);

        if (isBrand && isType) {
            result.brand = term;
            result.productType = term;
            return true;
        } else if (isBrand) {
            result.brand = term;
            return true;
        } else if (isType) {
            result.productType = term;
            return true;
        } else if (lookups.sports.has(term)) {
            result.sports.push(term);
            return true;
        } else if (lookups.fits.has(term)) {
            result.fits.push(term);
            return true;
        } else if (lookups.sleeves.has(term)) {
            result.sleeves.push(term);
            return true;
        } else if (lookups.necklines.has(term)) {
            result.necklines.push(term);
            return true;
        } else if (lookups.fabrics.has(term)) {
            result.fabrics.push(term);
            return true;
        } else if (lookups.sectors.has(term)) {
            result.sectors.push(term);
            return true;
        } else if (lookups.colours.has(term) || (resolvedItem && resolvedItem.type === 'colour')) {
            result.colours.push(term);
            return true;
        } else if (lookups.features.has(term)) {
            result.features.push(term);
            return true;
        }
        return false;
    }

    // Second pass: try multi-word phrases (3-word, 2-word) then single words
    const consumed = new Array(terms.length).fill(false);

    // Try 3-word phrases
    for (let i = 0; i <= terms.length - 3; i++) {
        if (consumed[i] || consumed[i + 1] || consumed[i + 2]) continue;
        const phrase = `${terms[i]} ${terms[i + 1]} ${terms[i + 2]}`;
        if (classifyTerm(phrase, null)) {
            consumed[i] = consumed[i + 1] = consumed[i + 2] = true;
        }
    }

    // Try 2-word phrases
    for (let i = 0; i <= terms.length - 2; i++) {
        if (consumed[i] || consumed[i + 1]) continue;
        const phrase = `${terms[i]} ${terms[i + 1]}`;
        if (classifyTerm(phrase, null)) {
            consumed[i] = consumed[i + 1] = true;
        }
    }

    // Try single words
    for (let i = 0; i < terms.length; i++) {
        if (consumed[i]) continue;
        if (classifyTerm(terms[i], resolved[i])) {
            consumed[i] = true;
        }
    }

    // Anything left is freeText
    for (let i = 0; i < terms.length; i++) {
        if (!consumed[i]) {
            result.freeText.push(terms[i]);
        }
    }

    return result;
}

function invalidateCache() {
    lookupCache = null;
    lookupCacheTimestamp = 0;
}

module.exports = { parseSearchQuery, invalidateCache };
