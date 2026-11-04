/**
 * Catalogue search conditions, relevance ranking, and lightweight suggestions.
 */

const { parseSearchQuery } = require('./searchQueryParser');
const { queryWithTimeout } = require('../../config/database');

function prefixTsQuery(terms, operator = ' | ') {
  return terms
    .flatMap(term => String(term).split(/\s+/))
    .map(term => term.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .map(term => `${term}:*`)
    .join(operator);
}

async function buildSearchConditions(rawQuery, viewAlias = 'psm', paramIndex = 1) {
  const parsed = await parseSearchQuery(rawQuery);
  const conditions = [];
  const params = [];
  const softMatches = [];
  let nextIndex = paramIndex;
  let brandParamIndex = -1;
  let typeParamIndex = -1;
  let styleCodeParamIndex = -1;
  let ftsParamIndex = -1;
  let textParamIndex = -1;

  const addParam = value => {
    const index = nextIndex++;
    params.push(value);
    return index;
  };
  const addSoftArrayMatch = (column, values, weight) => {
    if (!values || values.length === 0) return;
    [...new Set(values)].forEach(value => {
      const index = addParam([value]);
      softMatches.push({
        expression: `${viewAlias}.${column}::text[] && $${index}::text[]`,
        weight
      });
    });
  };
  const addSoftFeatureMatch = (values, weight) => {
    if (!values || values.length === 0) return;
    [...new Set(values)].forEach(value => {
      const slugIndex = addParam([value]);
      const nameIndex = addParam([`%${String(value).replace(/-/g, ' ')}%`]);
      softMatches.push({
        expression: `(${viewAlias}.feature_slugs::text[] && $${slugIndex}::text[] OR ${viewAlias}.style_name ILIKE ANY($${nameIndex}::text[]))`,
        weight
      });
    });
  };

  const isAmbiguous = parsed.brand && parsed.productType && parsed.brand === parsed.productType;
  if (isAmbiguous) {
    brandParamIndex = addParam(parsed.brand);
    typeParamIndex = addParam(parsed.productType.replace(/-/g, '').replace(/ /g, ''));
    conditions.push(`(
      ${viewAlias}.brand ILIKE $${brandParamIndex}
      OR EXISTS (
        SELECT 1 FROM styles s_pt
        INNER JOIN product_types pt_s ON s_pt.product_type_id = pt_s.id
        WHERE s_pt.style_code = ${viewAlias}.style_code
          AND LOWER(REPLACE(REPLACE(pt_s.name, '-', ''), ' ', '')) ILIKE $${typeParamIndex}
      )
    )`);
  } else {
    if (parsed.brand) {
      brandParamIndex = addParam(parsed.brand);
      conditions.push(`${viewAlias}.brand ILIKE $${brandParamIndex}`);
    }
    if (parsed.productType) {
      typeParamIndex = addParam(parsed.productType.replace(/-/g, '').replace(/ /g, ''));
      conditions.push(`EXISTS (
        SELECT 1 FROM styles s_pt
        INNER JOIN product_types pt_s ON s_pt.product_type_id = pt_s.id
        WHERE s_pt.style_code = ${viewAlias}.style_code
          AND LOWER(REPLACE(REPLACE(pt_s.name, '-', ''), ' ', '')) ILIKE $${typeParamIndex}
      )`);
    }
  }

  if (parsed.styleCode) {
    styleCodeParamIndex = addParam(`${parsed.styleCode}%`);
    conditions.push(`${viewAlias}.style_code ILIKE $${styleCodeParamIndex}`);
  }

  if (parsed.genders.length > 0) {
    const index = addParam([...new Set(parsed.genders)]);
    conditions.push(`${viewAlias}.gender_slug = ANY($${index}::text[])`);
  }
  if (parsed.ageGroups.length > 0) {
    const index = addParam([...new Set(parsed.ageGroups)]);
    conditions.push(`${viewAlias}.age_group_slug = ANY($${index}::text[])`);
  }
  if (parsed.requiredFeatures.length > 0) {
    const index = addParam([...new Set(parsed.requiredFeatures)]);
    conditions.push(`${viewAlias}.feature_slugs::text[] && $${index}::text[]`);
  }
  parsed.requiredNameGroups.forEach(group => {
    const patterns = group.map(term => `\\m${String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\M`);
    const index = addParam(patterns);
    conditions.push(`${viewAlias}.style_name ~* ANY($${index}::text[])`);
  });
  if (parsed.excludedNameTerms.length > 0) {
    const index = addParam(parsed.excludedNameTerms.map(term => `%${term}%`));
    conditions.push(`NOT (${viewAlias}.style_name ILIKE ANY($${index}::text[]))`);
  }
  if (parsed.sports.length > 0) {
    const index = addParam([...new Set(parsed.sports)]);
    conditions.push(`${viewAlias}.sport_slugs::text[] && $${index}::text[]`);
  }
  if (parsed.sectors.length > 0) {
    const index = addParam([...new Set(parsed.sectors)]);
    conditions.push(`${viewAlias}.sector_slugs::text[] && $${index}::text[]`);
  }
  if (parsed.colours.length > 0) {
    const index = addParam([...new Set(parsed.colours)]);
    conditions.push(`EXISTS (
      SELECT 1 FROM products p_col
      WHERE p_col.style_code = ${viewAlias}.style_code
        AND (p_col.primary_colour ILIKE ANY($${index}) OR p_col.colour_name ILIKE ANY($${index}))
    )`);
  }

  addSoftArrayMatch('fit_slugs', parsed.fits, 28);
  addSoftArrayMatch('sleeve_slugs', parsed.sleeves, 28);
  addSoftArrayMatch('neckline_slugs', parsed.necklines, 28);
  addSoftArrayMatch('fabric_slugs', parsed.fabrics, 30);
  addSoftFeatureMatch(parsed.features, 32);
  addSoftArrayMatch('style_keyword_slugs', parsed.keywords, 34);

  const searchText = parsed.freeText.join(' ').trim();
  if (!parsed.styleCode && searchText) {
    const tsQuery = prefixTsQuery(parsed.freeText);
    if (tsQuery) {
      ftsParamIndex = addParam(tsQuery);
      textParamIndex = addParam(searchText);
      softMatches.push({
        expression: `(
          ${viewAlias}.search_vector @@ to_tsquery('english', $${ftsParamIndex})
          OR ${viewAlias}.style_name % $${textParamIndex}
          OR ${viewAlias}.style_name ILIKE ('%' || $${textParamIndex} || '%')
          OR word_similarity($${textParamIndex}, ${viewAlias}.style_name) >= 0.42
          OR word_similarity($${textParamIndex}, ${viewAlias}.brand) >= 0.45
          OR ${viewAlias}.style_code ILIKE $${textParamIndex}
        )`,
        weight: 40
      });
    }
  }

  if (softMatches.length === 1) {
    conditions.push(softMatches[0].expression);
  } else if (softMatches.length > 1) {
    conditions.push(`(${softMatches.map(match => match.expression).join(' OR ')})`);
  }

  const softScore = softMatches.length > 0
    ? softMatches.map(match => `(CASE WHEN ${match.expression} THEN ${match.weight} ELSE 0 END)`).join(' + ')
    : '0';
  const allSignalsBonus = softMatches.length > 1
    ? `(CASE WHEN ${softMatches.map(match => match.expression).join(' AND ')} THEN 120 ELSE 0 END)`
    : '0';
  const ftsScore = ftsParamIndex > 0
    ? `(ts_rank_cd(${viewAlias}.search_vector, to_tsquery('english', $${ftsParamIndex}), 32) * 100)`
    : '0';
  const textSimilarityScore = textParamIndex > 0
    ? `(GREATEST(
        similarity(${viewAlias}.style_name, $${textParamIndex}),
        similarity(${viewAlias}.brand, $${textParamIndex}),
        word_similarity($${textParamIndex}, ${viewAlias}.style_name),
        word_similarity($${textParamIndex}, ${viewAlias}.brand)
      ) * 40)`
    : '0';

  const relevanceSelect = `
    (
      ${styleCodeParamIndex > 0 ? `(CASE WHEN ${viewAlias}.style_code ILIKE $${styleCodeParamIndex} THEN 200 ELSE 0 END)` : '0'} +
      ${brandParamIndex > 0 ? `(CASE WHEN ${viewAlias}.brand ILIKE $${brandParamIndex} THEN 60 ELSE 0 END)` : '0'} +
      ${typeParamIndex > 0 ? `(CASE WHEN EXISTS (
        SELECT 1 FROM styles s_pt_rel
        INNER JOIN product_types pt_rel ON s_pt_rel.product_type_id = pt_rel.id
        WHERE s_pt_rel.style_code = ${viewAlias}.style_code
          AND LOWER(REPLACE(REPLACE(pt_rel.name, '-', ''), ' ', '')) ILIKE $${typeParamIndex}
      ) THEN 50 ELSE 0 END)` : '0'} +
      ${softScore} +
      ${allSignalsBonus} +
      ${ftsScore} +
      ${textSimilarityScore}
    )::int as relevance_score
  `;

  return {
    conditions,
    params,
    relevanceSelect,
    relevanceOrder: 'relevance_score DESC, style_code ASC',
    nextParamIndex: nextIndex,
    parsed
  };
}

async function buildFuzzyFallback(rawQuery, viewAlias = 'psm', paramIndex = 1) {
  const searchText = rawQuery.toLowerCase().trim();
  return {
    conditions: [`(
      word_similarity($${paramIndex}, ${viewAlias}.style_name) >= 0.42
      OR word_similarity($${paramIndex}, ${viewAlias}.brand) >= 0.45
    )`],
    params: [searchText],
    relevanceSelect: `(GREATEST(
      word_similarity($${paramIndex}, ${viewAlias}.style_name),
      word_similarity($${paramIndex}, ${viewAlias}.brand)
    ) * 100)::int as relevance_score`,
    relevanceOrder: 'relevance_score DESC',
    nextParamIndex: paramIndex + 1
  };
}

async function getSearchSuggestions(query, requestedLimit = 12) {
  const searchTerm = String(query || '').trim();
  if (!searchTerm) return { brands: [], types: [], products: [], total: 0 };

  const limit = Math.min(12, Math.max(1, Number(requestedLimit) || 12));
  const search = searchTerm.length === 1
    ? {
        conditions: ['(psm.style_code ILIKE $1 OR psm.brand ILIKE $1 OR psm.style_name ILIKE $1)'],
        params: [`${searchTerm}%`],
        relevanceSelect: `(
          CASE
            WHEN psm.style_code ILIKE $1 THEN 200
            WHEN psm.brand ILIKE $1 THEN 100
            WHEN psm.style_name ILIKE $1 THEN 80
            ELSE 0
          END
        )::int as relevance_score`
      }
    : await buildSearchConditions(searchTerm, 'psm', 1);
  const brandLookupTerm = searchTerm.toLowerCase();
  const typeLookupTerm = search.parsed?.productType || brandLookupTerm;
  const brandLookupParams = [[`%${brandLookupTerm}%`], brandLookupTerm];
  const typeLookupParams = [[`%${typeLookupTerm}%`], typeLookupTerm];
  const lookupCondition = `(name ILIKE ANY($1::text[]) OR word_similarity($2, name) >= 0.42)`;
  const productLimitIndex = search.params.length + 1;
  const productWhere = search.conditions.length > 0 ? `AND ${search.conditions.join(' AND ')}` : '';

  const [brandsResult, typesResult, keywordsResult, productsResult] = await Promise.all([
    queryWithTimeout(`
      SELECT name, slug FROM brands
      WHERE ${lookupCondition}
      ORDER BY name ASC
      LIMIT 3
    `, brandLookupParams),
    queryWithTimeout(`
      SELECT name, slug FROM product_types
      WHERE ${lookupCondition}
      ORDER BY name ASC
      LIMIT 3
    `, typeLookupParams),
    queryWithTimeout(`
      WITH keyword_candidates AS (
        SELECT name AS label, 100 AS source_priority
        FROM product_types
        UNION ALL
        SELECT name AS label, 70 AS source_priority
        FROM style_keywords
        WHERE keyword_type IN ('feature', 'style', 'sector', 'sport')
        UNION ALL
        SELECT canonical AS label, 50 AS source_priority
        FROM search_synonyms
        WHERE synonym_type IN ('product_type', 'attribute')
      ), ranked_keywords AS (
        SELECT
          label,
          MAX(source_priority) AS source_priority,
          word_similarity($1, label) AS match_score
        FROM keyword_candidates
        WHERE label IS NOT NULL
          AND (label ILIKE $2 OR word_similarity($1, label) >= 0.42)
        GROUP BY label
      )
      SELECT label
      FROM ranked_keywords
      ORDER BY
        CASE
          WHEN LOWER(label) = $1 THEN 0
          WHEN LOWER(label) LIKE ($1 || '%') THEN 1
          ELSE 2
        END,
        match_score DESC,
        source_priority DESC,
        label ASC
      LIMIT 3
    `, [brandLookupTerm, `%${brandLookupTerm}%`]),
    queryWithTimeout(`
      WITH matching AS (
        SELECT
          ranked_rows.style_code,
          MAX(ranked_rows.relevance_score) AS relevance_score
        FROM (
          SELECT psm.style_code, ${search.relevanceSelect}
          FROM product_search_mv psm
          WHERE psm.sku_status = 'Live'
            ${productWhere}
        ) ranked_rows
        GROUP BY ranked_rows.style_code
      ), ranked AS (
        SELECT
          matching.style_code,
          matching.relevance_score,
          COUNT(*) OVER()::int AS total_count
        FROM matching
        ORDER BY relevance_score DESC, matching.style_code ASC
        LIMIT $${productLimitIndex}
      )
      SELECT
        ranked.style_code,
        MIN(s.style_name) AS style_name,
        MIN(NULLIF(p.primary_image_url, 'Not available')) AS primary_image_url,
        MIN(b.name) AS brand,
        MIN(p.sell_price) AS price,
        MAX(ranked.total_count)::int AS total_count
      FROM ranked
      INNER JOIN styles s ON s.style_code = ranked.style_code
      INNER JOIN products p ON p.style_code = ranked.style_code AND p.sku_status = 'Live'
      LEFT JOIN brands b ON b.id = s.brand_id
      GROUP BY ranked.style_code, ranked.relevance_score
      ORDER BY ranked.relevance_score DESC, ranked.style_code ASC
    `, [...search.params, limit])
  ]);

  return {
    brands: brandsResult.rows.map(row => ({ label: row.name, value: row.slug, type: 'brand' })),
    types: typesResult.rows.map(row => ({ label: row.name, value: row.slug, type: 'type' })),
    keywords: keywordsResult.rows.map(row => ({ label: row.label, value: row.label, type: 'keyword' })),
    total: productsResult.rows.length > 0 ? Number(productsResult.rows[0].total_count) || 0 : 0,
    products: productsResult.rows.map(row => ({
      label: row.style_name,
      value: row.style_code,
      code: row.style_code,
      name: row.style_name,
      image: row.primary_image_url,
      brand: row.brand,
      price: Number(row.price) || 0,
      type: 'product'
    }))
  };
}

module.exports = {
  buildSearchConditions,
  buildFuzzyFallback,
  getSearchSuggestions,
  prefixTsQuery
};
