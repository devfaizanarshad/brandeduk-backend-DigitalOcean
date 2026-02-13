const { parseSearchQuery, invalidateCache } = require('../services/search/searchQueryParser');
const { buildSearchConditions } = require('../services/search/searchService');
const { queryWithTimeout } = require('../config/database');
const { refreshSynonyms } = require('../services/search/searchSynonyms');
const fs = require('fs');

async function testGolfPoloAPI() {
  const output = [];
  const log = (...args) => {
    const line = args.join(' ');
    console.log(line);
    output.push(line);
  };

  try {
    log('=== API SEARCH TEST: "golf polo" ===\n');

    log('Refreshing caches...');
    invalidateCache();
    await refreshSynonyms();

    // 1. Parse the query
    const parsed = await parseSearchQuery('golf polo');
    log('Parsed "golf polo":', JSON.stringify(parsed, null, 2));

    // 2. Build the search conditions
    const search = await buildSearchConditions('golf polo', 'psm', 1);
    log('\nConditions:', JSON.stringify(search.conditions));
    log('Params:', JSON.stringify(search.params));

    // 3. Count how many results the API would return
    const whereClause = search.conditions.length > 0
      ? 'AND ' + search.conditions.join(' AND ')
      : '';

    const countQuery = `
      SELECT COUNT(DISTINCT psm.style_code) as total
      FROM product_search_materialized psm
      WHERE psm.sku_status = 'Live' ${whereClause}
    `;

    const result = await queryWithTimeout(countQuery, search.params);
    log('\n*** API would return:', result.rows[0].total, 'results ***');

    // 4. Get sample results
    const sampleQuery = `
      SELECT DISTINCT psm.style_code, psm.style_name, psm.brand,
        ${search.relevanceSelect}
      FROM product_search_materialized psm
      WHERE psm.sku_status = 'Live' ${whereClause}
      ORDER BY ${search.relevanceOrder}
      LIMIT 10
    `;

    const samples = await queryWithTimeout(sampleQuery, search.params);
    log('\nTop 10 results:');
    samples.rows.forEach((r, i) => {
      log(`  ${i + 1}. [${r.style_code}] ${r.style_name} (${r.brand}) relevance=${r.relevance_score}`);
    });

    log('\n=== COMPARISON ===');
    log('Database (sport=Golf + type=Polos): 23 styles');
    log('API search "golf polo":', result.rows[0].total, 'styles');
    log('Match:', parseInt(result.rows[0].total) === 23 ? 'EXACT MATCH' : 'MISMATCH');

    fs.writeFileSync('test_results.txt', output.join('\n'));
    process.exit(0);
  } catch (e) {
    log('Error:', e.message);
    log(e.stack);
    fs.writeFileSync('test_results.txt', output.join('\n'));
    process.exit(1);
  }
}

testGolfPoloAPI();
