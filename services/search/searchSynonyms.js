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
        lastRefreshTime = Date.now();
        console.log(`[SYNONYMS] Loaded ${synonymMap.size} synonyms from database`);
    } catch (err) {
        console.warn('[SYNONYMS] DB load failed, using fallback:', err.message);
        if (synonymMap.size === 0) {
            // First load failed — use fallback
            for (const [term, data] of Object.entries(FALLBACK_SYNONYMS)) {
                synonymMap.set(term, data);
            }
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
    const entry = synonymMap.get(lower);
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
    ensureLoaded,
    getSynonymCount: () => synonymMap.size
};
