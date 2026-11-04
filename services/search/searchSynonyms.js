/**
 * searchSynonyms.js — Synonym Dictionary + Lookup Cache
 * 
 * Provides synonym resolution for user search queries.
 * Loads synonyms from DB (search_synonyms table) on startup with periodic refresh.
 * Falls back to hardcoded dictionary if DB is unavailable.
 */

const { queryWithTimeout } = require('../../config/database');

// In-memory synonym map: Map<term, { canonical, type }>
let synonymMap = new Map();
let compactSynonymMap = new Map();
let lastRefreshTime = 0;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Hardcoded fallback (used if DB unavailable on first load)
const FALLBACK_SYNONYMS = {
    // Product types
    'tshirt': { canonical: 't-shirt', type: 'product_type' },
    'tshirts': { canonical: 't-shirts', type: 'product_type' },
    't shirt': { canonical: 't-shirt', type: 'product_type' },
    'tee': { canonical: 't-shirt', type: 'product_type' },
    'tees': { canonical: 't-shirts', type: 'product_type' },
    'polo': { canonical: 'polo shirt', type: 'product_type' },
    'polos': { canonical: 'polo shirts', type: 'product_type' },
    'hoodie': { canonical: 'hooded sweatshirt', type: 'product_type' },
    'hoodies': { canonical: 'hooded sweatshirts', type: 'product_type' },
    'hoody': { canonical: 'hooded sweatshirt', type: 'product_type' },
    'jumper': { canonical: 'sweatshirt', type: 'product_type' },
    'pullover': { canonical: 'sweatshirt', type: 'product_type' },
    'hat': { canonical: 'cap', type: 'product_type' },
    'coat': { canonical: 'jacket', type: 'product_type' },
    'pants': { canonical: 'trousers', type: 'product_type' },
    'rucksack': { canonical: 'bag', type: 'product_type' },
    'backpack': { canonical: 'bag', type: 'product_type' },
    'backpacks': { canonical: 'bags', type: 'product_type' },
    'glove': { canonical: 'gloves', type: 'product_type' },
    'goggle': { canonical: 'goggles', type: 'product_type' },
    'helmet': { canonical: 'helmets', type: 'product_type' },

    // Colours
    'grey': { canonical: 'gray', type: 'colour' },
    'navy': { canonical: 'navy blue', type: 'colour' },
    'maroon': { canonical: 'burgundy', type: 'colour' },
    'wine': { canonical: 'burgundy', type: 'colour' },
    'neon': { canonical: 'fluorescent', type: 'colour' },
    'hivis': { canonical: 'hi-vis', type: 'colour' },
    'high visibility': { canonical: 'hi-vis', type: 'colour' },

    // Attributes
    'long sleeve': { canonical: 'long-sleeve', type: 'attribute' },
    'longsleeve': { canonical: 'long-sleeve', type: 'attribute' },
    'short sleeve': { canonical: 'short-sleeve', type: 'attribute' },
    'shortsleeve': { canonical: 'short-sleeve', type: 'attribute' },
    'crew neck': { canonical: 'crew-neck', type: 'attribute' },
    'crewneck': { canonical: 'crew-neck', type: 'attribute' },
    'v neck': { canonical: 'v-neck', type: 'attribute' },
    'vneck': { canonical: 'v-neck', type: 'attribute' },
    'round neck': { canonical: 'crew-neck', type: 'attribute' },
    'zip': { canonical: 'zipped', type: 'attribute' },
    'zip up': { canonical: 'zipped', type: 'attribute' },
    'hood': { canonical: 'hooded', type: 'attribute' },
    'quarter zip': { canonical: 'quarter-zip', type: 'attribute' },
    '1/4 zip': { canonical: 'quarter-zip', type: 'attribute' },
    'half zip': { canonical: 'half-zip', type: 'attribute' },

    // Gender
    'mens': { canonical: 'mens', type: 'gender' },
    'men': { canonical: 'mens', type: 'gender' },
    'male': { canonical: 'mens', type: 'gender' },
    'womens': { canonical: 'womens', type: 'gender' },
    'women': { canonical: 'womens', type: 'gender' },
    'ladies': { canonical: 'womens', type: 'gender' },
    'kids': { canonical: 'kids', type: 'gender' },
    'children': { canonical: 'kids', type: 'gender' },
    'childrens': { canonical: 'kids', type: 'gender' }
};

function compactTerm(term) {
    return String(term || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function rebuildCompactSynonymMap() {
    const compactMap = new Map();
    const ambiguousKeys = new Set();

    for (const [term, entry] of synonymMap.entries()) {
        const key = compactTerm(term);
        if (!key || key === term || ambiguousKeys.has(key)) continue;

        const existing = compactMap.get(key);
        if (existing && (existing.canonical !== entry.canonical || existing.type !== entry.type)) {
            compactMap.delete(key);
            ambiguousKeys.add(key);
            continue;
        }
        compactMap.set(key, entry);
    }

    compactSynonymMap = compactMap;
}

/**
 * Load synonyms from database into memory
 */
async function refreshSynonyms() {
    try {
        const result = await queryWithTimeout(
            'SELECT term, canonical, synonym_type FROM search_synonyms',
            [],
            5000
        );

        const newMap = new Map();
        for (const row of result.rows) {
            newMap.set(row.term.toLowerCase(), {
                canonical: row.canonical,
                type: row.synonym_type
            });
        }

        synonymMap = newMap;
        rebuildCompactSynonymMap();
        lastRefreshTime = Date.now();
        console.log(`[SYNONYMS] Loaded ${synonymMap.size} synonyms from database`);
    } catch (err) {
        console.warn('[SYNONYMS] DB load failed, using fallback:', err.message);
        if (synonymMap.size === 0) {
            // First load failed — use fallback
            for (const [term, data] of Object.entries(FALLBACK_SYNONYMS)) {
                synonymMap.set(term, data);
            }
            rebuildCompactSynonymMap();
            lastRefreshTime = Date.now();
        }
    }
}

/**
 * Resolve a single term to its canonical form
 * @param {string} term 
 * @returns {{ original: string, canonical: string, type: string } | null}
 */
function resolveSynonym(term) {
    const lower = term.toLowerCase().trim();
    const entry = synonymMap.get(lower) || compactSynonymMap.get(compactTerm(lower));
    if (entry) {
        return { original: lower, canonical: entry.canonical, type: entry.type };
    }
    return null;
}

/**
 * Resolve multi-word phrases (try 2-word then 1-word lookups)
 * Input: array of tokens
 * Returns: array of { original, canonical, type } or unresolved tokens
 */
function resolveTokens(tokens) {
    const resolved = [];
    let i = 0;

    while (i < tokens.length) {
        // Try 2-word phrase first
        if (i + 1 < tokens.length) {
            const phrase = `${tokens[i]} ${tokens[i + 1]}`;
            const phraseMatch = resolveSynonym(phrase);
            if (phraseMatch) {
                resolved.push(phraseMatch);
                i += 2;
                continue;
            }
        }

        // Try single word
        const singleMatch = resolveSynonym(tokens[i]);
        if (singleMatch) {
            resolved.push(singleMatch);
        } else {
            resolved.push({ original: tokens[i], canonical: tokens[i], type: 'unknown' });
        }
        i++;
    }

    return resolved;
}

function fuzzyText(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bigramSimilarity(leftValue, rightValue) {
    const left = fuzzyText(leftValue);
    const right = fuzzyText(rightValue);
    if (left === right) return 1;
    if (left.length < 2 || right.length < 2) return 0;

    const rightPairs = new Map();
    for (let index = 0; index < right.length - 1; index++) {
        const pair = right.slice(index, index + 2);
        rightPairs.set(pair, (rightPairs.get(pair) || 0) + 1);
    }

    let matches = 0;
    for (let index = 0; index < left.length - 1; index++) {
        const pair = left.slice(index, index + 2);
        const available = rightPairs.get(pair) || 0;
        if (available > 0) {
            matches++;
            rightPairs.set(pair, available - 1);
        }
    }

    return (2 * matches) / ((left.length - 1) + (right.length - 1));
}

function findFuzzyProductType(term, catalogueTypes = []) {
    const input = fuzzyText(term);
    if (input.length < 4) return null;

    const candidates = [];
    for (const [synonymTerm, entry] of synonymMap.entries()) {
        if (entry.type !== 'product_type') continue;
        candidates.push({ value: synonymTerm, canonical: entry.canonical });
        candidates.push({ value: entry.canonical, canonical: entry.canonical });
    }
    for (const type of catalogueTypes) {
        candidates.push({ value: type, canonical: type });
    }

    const bestByCanonical = new Map();
    for (const candidate of candidates) {
        const candidateText = fuzzyText(candidate.value);
        if (!candidateText || candidateText[0] !== input[0]) continue;
        const score = bigramSimilarity(input, candidateText);
        const canonical = String(candidate.canonical || '').toLowerCase();
        const existing = bestByCanonical.get(canonical);
        if (!existing || score > existing.score) bestByCanonical.set(canonical, { canonical, score });
    }

    const matches = [...bestByCanonical.values()]
        .filter(match => match.score >= 0.3)
        .sort((left, right) => right.score - left.score);
    if (!matches.length) return null;
    return { ...matches[0], alternatives: matches.slice(1) };
}

/**
 * Ensure synonyms are loaded (lazy init + periodic refresh)
 */
async function ensureLoaded() {
    if (Date.now() - lastRefreshTime > REFRESH_INTERVAL_MS) {
        await refreshSynonyms();
    }
}

module.exports = {
    refreshSynonyms,
    resolveSynonym,
    resolveTokens,
    findFuzzyProductType,
    ensureLoaded,
    getSynonymCount: () => synonymMap.size
};
