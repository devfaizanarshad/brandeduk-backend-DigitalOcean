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
const { parseSearchQuery, invalidateCache: invalidateParserCache } = require('./searchQueryParser');
const { refreshSynonyms, ensureLoaded: ensureSynonymsLoaded } = require('./searchSynonyms');

module.exports = {
    buildSearchConditions,
    buildFuzzyFallback,
    getSearchSuggestions,
    parseSearchQuery,
    refreshSynonyms,
    ensureSynonymsLoaded,
    invalidateParserCache
};
