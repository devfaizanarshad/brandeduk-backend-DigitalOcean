/**
 * searchService.js — Hybrid Ranking Engine (Production Final)
 * 
 * IMPORTANT: Uses product_search_mv which has all columns:
 *   - brand (text)       — direct column
 *   - style_name (text)  — direct column
 *   - search_vector      — tsvector column
 *   - sport_slugs        — text[] (from product_sports + related_sports)
 *   - product_type is NOT a direct column; must JOIN styles→product_types
 */

const { parseSearchQuery } = require('./searchQueryParser');
const { queryWithTimeout } = require('../../config/database');

/**
 * Builds the Hybrid Search Query (FTS + Trigram)
 * Aggregates results by style_code (Canonical Entity)
 */
async function buildSearchConditions(rawQuery, viewAlias = 'psm', paramIndex = 1) {
  const parsed = await parseSearchQuery(rawQuery);
  const conditions = [];
  const params = [];
  let idx = paramIndex;

  // Track specific parameter indices for relevance boosts
  let brandParamIdx = -1;
  let typeParamIdx = -1;

  // 1. Structured Narrowing (Applied first for planner efficiency)
  const isAmbiguous = parsed.brand && parsed.productType && parsed.brand === parsed.productType;

  if (isAmbiguous) {
    // Ambiguous term (e.g. "polo") — match brand OR product type
    brandParamIdx = idx;
    const brandParam = idx++;
    typeParamIdx = idx;
    const typeParam = idx++;
    params.push(parsed.brand, parsed.productType.replace(/-/g, '').replace(/ /g, ''));

    conditions.push(`(
      ${viewAlias}.brand ILIKE $${brandParam}
      OR EXISTS (
        SELECT 1 FROM styles s_pt
        INNER JOIN product_types pt_s ON s_pt.product_type_id = pt_s.id
        WHERE s_pt.style_code = ${viewAlias}.style_code
          AND LOWER(REPLACE(REPLACE(pt_s.name, '-', ''), ' ', '')) ILIKE $${typeParam}
      )
    )`);
  } else {
    if (parsed.brand) {
      brandParamIdx = idx;
      conditions.push(`${viewAlias}.brand ILIKE $${idx}`);
      params.push(parsed.brand);
      idx++;
    }
    if (parsed.productType) {
      typeParamIdx = idx;
      // product_type is NOT on the mat-view; resolve via subquery
      conditions.push(`EXISTS (
        SELECT 1 FROM styles s_pt
        INNER JOIN product_types pt_s ON s_pt.product_type_id = pt_s.id
        WHERE s_pt.style_code = ${viewAlias}.style_code
          AND LOWER(REPLACE(REPLACE(pt_s.name, '-', ''), ' ', '')) ILIKE $${idx}
      )`);
      params.push(parsed.productType.replace(/-/g, '').replace(/ /g, ''));
      idx++;
    }
  }
  if (parsed.sports && parsed.sports.length > 0) {
    // product_search_mv correctly populates sport_slugs from product_sports + related_sports
    // Cast to text[] for type compatibility (column is varchar[])
    conditions.push(`${viewAlias}.sport_slugs::text[] && $${idx}::text[]`);
    params.push(parsed.sports);
    idx++;
  }

  // --- EXTENDED ATTRIBUTE FILTERS (Robust Subqueries) ---

  // Fits
  if (parsed.fits && parsed.fits.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM styles s_fit
      JOIN style_keywords_mapping skm ON s_fit.style_code = skm.style_code
      JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE s_fit.style_code = ${viewAlias}.style_code
        AND sk.keyword_type = 'fit'
        AND sk.name ILIKE ANY($${idx})
    )`);
    params.push(parsed.fits);
    idx++;
  }

  // Sleeves
  if (parsed.sleeves && parsed.sleeves.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM styles s_sl
      JOIN style_keywords_mapping skm ON s_sl.style_code = skm.style_code
      JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE s_sl.style_code = ${viewAlias}.style_code
        AND sk.keyword_type = 'sleeve'
        AND sk.name ILIKE ANY($${idx})
    )`);
    params.push(parsed.sleeves);
    idx++;
  }

  // Necklines
  if (parsed.necklines && parsed.necklines.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM styles s_nk
      JOIN style_keywords_mapping skm ON s_nk.style_code = skm.style_code
      JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE s_nk.style_code = ${viewAlias}.style_code
        AND sk.keyword_type = 'neckline'
        AND sk.name ILIKE ANY($${idx})
    )`);
    params.push(parsed.necklines);
    idx++;
  }

  // Fabrics
  if (parsed.fabrics && parsed.fabrics.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM styles s_fab
      JOIN products p ON s_fab.style_code = p.style_code
      JOIN product_fabrics pf ON p.id = pf.product_id
      JOIN fabrics f ON pf.fabric_id = f.id
      WHERE s_fab.style_code = ${viewAlias}.style_code
        AND f.name ILIKE ANY($${idx})
    )`);
    params.push(parsed.fabrics);
    idx++;
  }

  // Sectors
  if (parsed.sectors && parsed.sectors.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM styles s_sec
      JOIN products p ON s_sec.style_code = p.style_code
      JOIN product_sectors ps ON p.id = ps.product_id
      JOIN related_sectors rs ON ps.sector_id = rs.id
      WHERE s_sec.style_code = ${viewAlias}.style_code
        AND rs.name ILIKE ANY($${idx})
    )`);
    params.push(parsed.sectors);
    idx++;
  }

  // Colours (Primary Colour check)
  if (parsed.colours && parsed.colours.length > 0) {
    // Check against materialized view primary_colour if available, OR join products
    // Using robust product join to be safe
    conditions.push(`EXISTS (
      SELECT 1 FROM products p_col
      WHERE p_col.style_code = ${viewAlias}.style_code
        AND (p_col.primary_colour ILIKE ANY($${idx}) OR p_col.colour_name ILIKE ANY($${idx}))
    )`);
    params.push(parsed.colours);
    idx++;
  }

  // Features (e.g. breathable, moisture wicking)
  if (parsed.features && parsed.features.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM styles s_ft
      JOIN style_keywords_mapping skm ON s_ft.style_code = skm.style_code
      JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE s_ft.style_code = ${viewAlias}.style_code
        AND sk.keyword_type = 'feature'
        AND sk.name ILIKE ANY($${idx})
    )`);
    params.push(parsed.features);
    idx++;
  }

  // 2. Hybrid Text Match (FTS + High-Signal Trigram + Style Code)
  // Only add FTS/trigram when there's unclassified free text
  const searchText = parsed.freeText.join(' ').trim();
  let ftsParam = -1;
  let trgmParam = -1;
  let styleCodeParam = -1;

  // Style code direct match (highest priority)
  if (parsed.styleCode) {
    styleCodeParam = idx++;
    params.push(parsed.styleCode);
    conditions.push(`${viewAlias}.style_code ILIKE $${styleCodeParam}`);
  } else if (searchText) {
    ftsParam = idx++;
    trgmParam = idx++;
    // Flatten multi-word tokens (e.g. "polo shirt" -> "polo", "shirt") to avoid tsquery syntax errors
    const tsQuery = parsed.freeText
      .flatMap(t => t.split(/\s+/))
      .filter(t => t.length > 0)
      .map(t => `${t}:*`)
      .join(' & ');

    params.push(tsQuery, searchText);

    conditions.push(`(${viewAlias}.search_vector @@ to_tsquery('english', $${ftsParam}) OR ${viewAlias}.style_name % $${trgmParam} OR ${viewAlias}.style_code ILIKE $${trgmParam})`);
  }

  // 3. Precision Ranking Formula
  // Conditionally include FTS/trigram scoring only when free text is present
  const hasFTS = ftsParam > 0;
  const hasStyleCode = styleCodeParam > 0;

  const relevanceSelect = `
    (
      ${hasStyleCode ? `
      -- Direct style code match boost
      (CASE WHEN ${viewAlias}.style_code ILIKE $${styleCodeParam} THEN 200 ELSE 0 END) +
      ` : ''}
      ${hasFTS ? `
      -- FTS Rank (0-100)
      (ts_rank_cd(${viewAlias}.search_vector, to_tsquery('english', $${ftsParam}), 32) * 100) +
      
      -- Multi-Field Similarity (0-40) — only columns on the view
      (GREATEST(
        similarity(${viewAlias}.style_name, $${trgmParam}),
        similarity(${viewAlias}.brand, $${trgmParam})
      ) * 40) +

      -- Style code exact match boost
      (CASE WHEN ${viewAlias}.style_code ILIKE $${trgmParam} THEN 200 ELSE 0 END) +
      ` : ''}

      -- Identity Boosts (Fixed weights on classified tokens)
      ${brandParamIdx > 0 ? `(CASE WHEN ${viewAlias}.brand ILIKE $${brandParamIdx} THEN 60 ELSE 0 END)` : '0'} +
      ${typeParamIdx > 0 ? `(CASE WHEN EXISTS (
        SELECT 1 FROM styles s_pt_rel
        INNER JOIN product_types pt_rel ON s_pt_rel.product_type_id = pt_rel.id
        WHERE s_pt_rel.style_code = ${viewAlias}.style_code
          AND LOWER(REPLACE(REPLACE(pt_rel.name, '-', ''), ' ', '')) ILIKE $${typeParamIdx}
      ) THEN 50 ELSE 0 END)` : '0'}
    )::int as relevance_score
  `;

  return {
    conditions,
    params,
    relevanceSelect,
    // Deterministic tie-breaker (style_code ASC) ensures pagination stability
    relevanceOrder: 'relevance_score DESC, style_code ASC',
    nextParamIndex: idx,
    parsed
  };
}

/**
 * Builds a fuzzy fallback query when primary search returns no results.
 * Uses trigram similarity with a lower threshold.
 */
async function buildFuzzyFallback(rawQuery, viewAlias = 'psm', paramIndex = 1) {
  // Simplified fallback: broaden trigram threshold
  const searchText = rawQuery.toLowerCase().trim();
  const conditions = [
    `(${viewAlias}.style_name % $${paramIndex} OR ${viewAlias}.brand % $${paramIndex})`
  ];
  const params = [searchText];

  const relevanceSelect = `
    (GREATEST(
      similarity(${viewAlias}.style_name, $${paramIndex}),
      similarity(${viewAlias}.brand, $${paramIndex})
    ) * 100)::int as relevance_score
  `;

  return {
    conditions,
    params,
    relevanceSelect,
    relevanceOrder: 'relevance_score DESC',
    nextParamIndex: paramIndex + 1
  };
}

/**
 * Gets typeahead suggestions for a search query.
 * Returns Brands, Product Types, and top matching Products for dropdown.
 */
async function getSearchSuggestions(query) {
  const searchTerm = (query || '').trim();
  if (!searchTerm || searchTerm.length < 2) {
    return { brands: [], types: [], products: [] };
  }

  const likeTerm = `${searchTerm}%`;  // Prefix match

  // Parallel queries to fetch suggestions
  const [brandsRes, typesRes, productsRes] = await Promise.all([
    // 1. Brands (Prefix match)
    queryWithTimeout(`
      SELECT name, slug FROM brands 
      WHERE name ILIKE $1 
      ORDER BY name ASC 
      LIMIT 3
    `, [likeTerm]),

    // 2. Product Types (Prefix match)
    queryWithTimeout(`
      SELECT name, slug FROM product_types 
      WHERE name ILIKE $1 
      ORDER BY name ASC 
      LIMIT 3
    `, [likeTerm]),

    // 3. Products (Trigram match on name OR style code prefix)
    // Querying base tables to ensure robust column access (images, etc)
    queryWithTimeout(`
      SELECT DISTINCT ON (s.style_code)
        s.style_code, 
        s.style_name, 
        p.primary_image_url, 
        b.name as brand
      FROM styles s
      JOIN products p ON s.style_code = p.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE p.sku_status = 'Live'
        AND (s.style_name ILIKE $1 OR s.style_code ILIKE $1 OR b.name ILIKE $1)
      LIMIT 5
    `, [`%${searchTerm}%`])
  ]);

  return {
    brands: brandsRes.rows.map(r => ({ label: r.name, value: r.slug, type: 'brand' })),
    types: typesRes.rows.map(r => ({ label: r.name, value: r.slug, type: 'type' })),
    products: productsRes.rows.map(r => ({
      label: r.style_name,
      value: r.style_code,
      image: r.primary_image_url,
      brand: r.brand,
      type: 'product'
    }))
  };
}

module.exports = { buildSearchConditions, buildFuzzyFallback, getSearchSuggestions };
