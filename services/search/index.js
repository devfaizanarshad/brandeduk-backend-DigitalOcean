/**
 * Search Module Index
 * 
 * Usage:
 *   const search = require('./services/search');
 *   
 *   // In buildProductListQuery:
 *   const searchResult = await search.buildSearchConditions(filters.q, 'psm', paramIndex);
 *   // Merge searchResult.conditions into WHERE clause
 *   // Merge searchResult.params into params array
 *   // Use searchResult.relevanceSelect for ORDER BY
 */

const { buildSearchConditions, buildFuzzyFallback, getSearchSuggestions } = require('./searchService');
const { parseSearchQuery, invalidateCache: invalidateParserCache, warmSearchCache: warmParserCache } = require('./searchQueryParser');
const { refreshSynonyms, ensureLoaded: ensureSynonymsLoaded } = require('./searchSynonyms');
const suggestEngine = require('./suggestEngine');

/** Warm parser lookups and build the in-memory typeahead index (called at startup). */
async function warmSearchCache() {
    suggestEngine.startAutoRefresh();
    const [parser, engine] = await Promise.allSettled([
        warmParserCache(),
        suggestEngine.isReady() ? Promise.resolve() : suggestEngine.build('startup')
    ]);
    if (parser.status === 'rejected') throw parser.reason;
    if (engine.status === 'rejected') throw engine.reason;
}

module.exports = {
    buildSearchConditions,
    buildFuzzyFallback,
    getSearchSuggestions,
    parseSearchQuery,
    refreshSynonyms,
    ensureSynonymsLoaded,
    warmSearchCache,
    invalidateParserCache,
    suggestEngine
};
