/**
 * TEST STYLE CODE SEARCH
 */
const { parseSearchQuery, invalidateCache } = require('../services/search/searchQueryParser');
const { buildSearchConditions } = require('../services/search/searchService');
const { queryWithTimeout, pool } = require('../config/database');
const { refreshSynonyms } = require('../services/search/searchSynonyms');

async function test(searchTerm, expectedCode) {
    const parsed = await parseSearchQuery(searchTerm);
    console.log(`\n"${searchTerm}"`);
    console.log(`  styleCode: ${parsed.styleCode || 'null'}`);
    console.log(`  freeText: [${parsed.freeText}]`);

    const search = await buildSearchConditions(searchTerm, 'psm', 1);
    const where = search.conditions.length ? 'AND ' + search.conditions.join(' AND ') : '';

    const r = await queryWithTimeout(`
    SELECT DISTINCT psm.style_code, psm.style_name
    FROM product_search_mv psm
    WHERE psm.sku_status = 'Live' ${where}
    ORDER BY psm.style_code
    LIMIT 5
  `, search.params, 30000);

    console.log(`  Results: ${r.rows.length} (first 5)`);
    r.rows.forEach(row => console.log(`    → ${row.style_code}: ${row.style_name}`));

    const ok = r.rows.some(row => row.style_code.toUpperCase() === expectedCode.toUpperCase());
    console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'} — expected to find "${expectedCode}"`);
    return ok;
}

async function run() {
    console.log('=== STYLE CODE SEARCH TESTS ===');
    invalidateCache();
    await refreshSynonyms();

    let pass = 0;
    let total = 0;

    // Test exact style codes
    total++; if (await test('AD002', 'AD002')) pass++;
    total++; if (await test('NK170', 'NK170')) pass++;
    total++; if (await test('7620B', '7620B')) pass++;
    total++; if (await test('AC004', 'AC004')) pass++;

    // Test lowercase
    total++; if (await test('ad002', 'AD002')) pass++;
    total++; if (await test('nk170', 'NK170')) pass++;

    // Test partial style codes (should still find via ILIKE)
    console.log('\n--- Partial style codes (freeText fallback) ---');
    const partialParsed = await parseSearchQuery('AD');
    console.log(`"AD" → styleCode: ${partialParsed.styleCode}, freeText: [${partialParsed.freeText}]`);
    // "AD" won't match style code pattern (no digits), goes to freeText

    // No false positives on real words that look like codes
    console.log('\n--- False positive checks ---');
    const fpTests = ['polo', 'blue', 'nike', 'xl', 'xs'];
    for (const fp of fpTests) {
        const p = await parseSearchQuery(fp);
        const isFP = p.styleCode !== null;
        console.log(`  "${fp}" → styleCode: ${p.styleCode || 'null'} ${isFP ? '⚠ FALSE POSITIVE' : '✓ OK'}`);
    }

    console.log(`\n=== SUMMARY: ${pass}/${total} style code tests passed ===`);
    pool.end();
}

run().catch(e => { console.error(e.message, e.stack); pool.end(); });
