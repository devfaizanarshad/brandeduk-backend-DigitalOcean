/**
 * COMPREHENSIVE E-COMMERCE SEARCH TEST SUITE
 * Tests ALL filter classifications + real-world user search scenarios
 */
const { parseSearchQuery, invalidateCache } = require('../services/search/searchQueryParser');
const { buildSearchConditions } = require('../services/search/searchService');
const { queryWithTimeout, pool } = require('../config/database');
const { refreshSynonyms } = require('../services/search/searchSynonyms');
const fs = require('fs');

const output = [];
const log = (...args) => {
    const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    console.log(line);
    output.push(line);
};

async function getCount(query, params = []) {
    const r = await queryWithTimeout(query, params, 30000);
    return parseInt(r.rows[0].count || r.rows[0].c || 0);
}

async function testParse(searchTerm) {
    const parsed = await parseSearchQuery(searchTerm);
    const classified = {};
    if (parsed.brand) classified.brand = parsed.brand;
    if (parsed.productType) classified.productType = parsed.productType;
    if (parsed.sports && parsed.sports.length) classified.sports = parsed.sports;
    if (parsed.fits && parsed.fits.length) classified.fits = parsed.fits;
    if (parsed.sleeves && parsed.sleeves.length) classified.sleeves = parsed.sleeves;
    if (parsed.necklines && parsed.necklines.length) classified.necklines = parsed.necklines;
    if (parsed.fabrics && parsed.fabrics.length) classified.fabrics = parsed.fabrics;
    if (parsed.sectors && parsed.sectors.length) classified.sectors = parsed.sectors;
    if (parsed.colours && parsed.colours.length) classified.colours = parsed.colours;
    if (parsed.features && parsed.features.length) classified.features = parsed.features;
    if (parsed.freeText && parsed.freeText.length) classified.freeText = parsed.freeText;
    return { parsed, classified };
}

async function testSearchCount(searchTerm) {
    try {
        const search = await buildSearchConditions(searchTerm, 'psm', 1);
        const whereClause = search.conditions.length > 0
            ? 'AND ' + search.conditions.join(' AND ') : '';
        const count = await getCount(`
      SELECT COUNT(DISTINCT psm.style_code) as count
      FROM product_search_mv psm
      WHERE psm.sku_status = 'Live' ${whereClause}
    `, search.params);
        return count;
    } catch (e) {
        return `ERROR: ${e.message}`;
    }
}

async function runTests() {
    log('╔══════════════════════════════════════════════════════════════╗');
    log('║  COMPREHENSIVE E-COMMERCE SEARCH TEST SUITE                ║');
    log('║  Testing ALL filter categories + Real-world scenarios      ║');
    log('╚══════════════════════════════════════════════════════════════╝');
    log('');

    invalidateCache();
    await refreshSynonyms();

    const results = [];
    let passCount = 0;
    let failCount = 0;
    let testNum = 0;

    async function test(searchTerm, expectedClassification, description) {
        testNum++;
        try {
            const { classified } = await testParse(searchTerm);
            const apiCount = await testSearchCount(searchTerm);

            // Check classification
            let classOk = true;
            const issues = [];
            for (const [key, expectedVal] of Object.entries(expectedClassification)) {
                const actual = classified[key];
                const actualStr = JSON.stringify(actual);
                const expectedStr = JSON.stringify(expectedVal);
                if (actualStr !== expectedStr) {
                    classOk = false;
                    issues.push(`${key}: expected=${expectedStr} got=${actualStr}`);
                }
            }
            // Also check no unexpected classifications
            for (const key of Object.keys(classified)) {
                if (!(key in expectedClassification) && key !== 'freeText') {
                    // Unexpected classification - might be ok but note it
                }
            }

            const status = classOk && (typeof apiCount === 'number' && apiCount >= 0) ? 'PASS' : 'FAIL';
            if (status === 'PASS') passCount++; else failCount++;

            log(`  ${testNum}. [${status}] "${searchTerm}" → ${JSON.stringify(classified)} → ${apiCount} results`);
            if (!classOk) issues.forEach(i => log(`     ⚠ ${i}`));
            if (description) log(`     📝 ${description}`);

            results.push({ testNum, searchTerm, status, classified, apiCount, issues, description });
        } catch (e) {
            failCount++;
            log(`  ${testNum}. [ERROR] "${searchTerm}" → ${e.message}`);
            results.push({ testNum, searchTerm, status: 'ERROR', error: e.message });
        }
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 1: SINGLE FILTER CLASSIFICATION TESTS
    // Testing each filter category individually
    // ══════════════════════════════════════════════════════════
    log('\n━━━ SECTION 1: SINGLE FILTER CATEGORY TESTS ━━━');

    log('\n  --- 1A. SPORTS (from related_sports) ---');
    await test('golf', { sports: ['golf'] }, 'Single sport lookup');
    await test('gym', { sports: ['gym'] }, 'Single sport lookup');
    await test('swimming', { sports: ['swimming'] }, 'Single sport lookup');
    await test('rugby', { sports: ['rugby'] }, 'Single sport lookup');

    log('\n  --- 1B. PRODUCT TYPES (from product_types) ---');
    await test('polos', { productType: 'polos' }, 'Direct product type');
    await test('jackets', { productType: 'jackets' }, 'Direct product type');
    await test('hoodies', { productType: 'hoodies' }, 'Direct product type');
    await test('sweatshirts', { productType: 'sweatshirts' }, 'Direct product type');
    await test('caps', { productType: 'caps' }, 'Direct product type');
    await test('fleece', { productType: 'fleece' }, 'Type that could be feature too');
    await test('shorts', { productType: 'shorts' }, 'Direct product type');
    await test('bags', { productType: 'bags' }, 'Direct product type');
    await test('beanies', { productType: 'beanies' }, 'Direct product type');
    await test('leggings', { productType: 'leggings' }, 'Direct product type');

    log('\n  --- 1C. BRANDS (from brands) ---');
    await test('nike', { brand: 'nike' }, 'Brand recognition');
    await test('adidas', { brand: 'adidas' }, 'Brand recognition');
    await test('gildan', { brand: 'gildan' }, 'Brand recognition');
    await test('stormtech', { brand: 'stormtech' }, 'Brand recognition');
    await test('beechfield', { brand: 'beechfield' }, 'Brand recognition');
    await test('premier', { brand: 'premier' }, 'Brand recognition');

    log('\n  --- 1D. FITS (from style_keywords fit) ---');
    await test('slim fit', { fits: ['slim fit'] }, 'Multi-word fit');
    await test('classic fit', { fits: ['classic fit'] }, 'Multi-word fit');
    await test('tailored fit', { fits: ['tailored fit'] }, 'Multi-word fit');
    await test('oversized', { fits: ['oversized'] }, 'Single word fit');
    await test('stretch', { fits: ['stretch'] }, 'Single word fit');
    await test('cropped', { fits: ['cropped'] }, 'Single word fit');
    await test('fitted', { fits: ['fitted'] }, 'Single word fit');

    log('\n  --- 1E. SLEEVES (from style_keywords sleeve) ---');
    await test('long sleeve', { sleeves: ['long sleeve'] }, 'Multi-word sleeve');
    await test('short sleeve', { sleeves: ['short sleeve'] }, 'Multi-word sleeve');
    await test('sleeveless', { sleeves: ['sleeveless'] }, 'Single word sleeve');

    log('\n  --- 1F. NECKLINES (from style_keywords neckline) ---');
    await test('v-neck', { necklines: ['v-neck'] }, 'Hyphenated neckline');
    await test('crew neck', { necklines: ['crew neck'] }, 'Multi-word neckline');
    await test('mandarin', { necklines: ['mandarin'] }, 'Single word neckline');
    await test('roll neck', { necklines: ['roll neck'] }, 'Multi-word neckline');

    log('\n  --- 1G. FEATURES (from style_keywords feature) ---');
    await test('waterproof', { features: ['waterproof'] }, 'Feature recognition');
    await test('padded', { features: ['padded'] }, 'Feature recognition');
    await test('hooded', { features: ['hooded'] }, 'Feature recognition');
    await test('quilted', { features: ['quilted'] }, 'Feature recognition');
    await test('lightweight', { features: ['lightweight'] }, 'Feature recognition');
    await test('breathable', { features: ['breathable'] }, 'Feature recognition');

    log('\n  --- 1H. COLOURS (from products.primary_colour) ---');
    await test('black', { colours: ['black'] }, 'Colour recognition');
    await test('blue', { colours: ['blue'] }, 'Colour recognition');
    await test('red', { colours: ['red'] }, 'Colour recognition');
    await test('green', { colours: ['green'] }, 'Colour recognition');
    await test('white', { colours: ['white'] }, 'Colour recognition');
    await test('pink', { colours: ['pink'] }, 'Colour recognition');

    log('\n  --- 1I. SECTORS (from related_sectors) ---');
    await test('corporate', { sectors: ['corporate'] }, 'Sector recognition');
    await test('hospitality', { sectors: ['hospitality'] }, 'Sector recognition');
    await test('athleisure', { sectors: ['athleisure'] }, 'Sector recognition');
    await test('outdoor', { sectors: ['outdoor'] }, 'Sector recognition');
    await test('school', { sectors: ['school'] }, 'Sector recognition');

    // ══════════════════════════════════════════════════════════
    // SECTION 2: MULTI-FILTER COMBINATION TESTS
    // ══════════════════════════════════════════════════════════
    log('\n\n━━━ SECTION 2: MULTI-FILTER COMBINATIONS ━━━');

    log('\n  --- 2A. SPORT + PRODUCT TYPE ---');
    await test('golf polo', { productType: 'polos', sports: ['golf'] }, 'Sport + Type');
    await test('golf jacket', { productType: 'jackets', sports: ['golf'] }, 'Sport + Type');
    await test('gym shorts', { productType: 'shorts', sports: ['gym'] }, 'Sport + Type');
    await test('rugby shirts', { productType: 'shirts', sports: ['rugby'] }, 'Sport + Type — note: "Rugby Shirts" is also a product type');

    log('\n  --- 2B. BRAND + PRODUCT TYPE ---');
    await test('nike polo', { brand: 'nike', productType: 'polos' }, 'Brand + Type');
    await test('nike jacket', { brand: 'nike', productType: 'jackets' }, 'Brand + Type');
    await test('gildan tshirt', { brand: 'gildan', productType: 't-shirts' }, 'Brand + Type (synonym)');
    await test('beechfield caps', { brand: 'beechfield', productType: 'caps' }, 'Brand + Type');
    await test('premier shirts', { brand: 'premier', productType: 'shirts' }, 'Brand + Type');

    log('\n  --- 2C. COLOUR + PRODUCT TYPE ---');
    await test('black tshirt', { productType: 't-shirts', colours: ['black'] }, 'Colour + Type (synonym)');
    await test('black hoodie', { productType: 'hoodies', colours: ['black'] }, 'Colour + Type (synonym)');
    await test('blue polo', { productType: 'polos', colours: ['blue'] }, 'Colour + Type');
    await test('red jacket', { productType: 'jackets', colours: ['red'] }, 'Colour + Type');
    await test('white shirts', { productType: 'shirts', colours: ['white'] }, 'Colour + Type');
    await test('green fleece', { productType: 'fleece', colours: ['green'] }, 'Colour + Type');

    log('\n  --- 2D. FIT/SLEEVE/NECKLINE + TYPE ---');
    await test('slim fit polo', { productType: 'polos', fits: ['slim fit'] }, 'Fit + Type');
    await test('long sleeve polo', { productType: 'polos', sleeves: ['long sleeve'] }, 'Sleeve + Type');
    await test('v-neck sweatshirts', { productType: 'sweatshirts', necklines: ['v-neck'] }, 'Neckline + Type');
    await test('oversized hoodie', { productType: 'hoodies', fits: ['oversized'] }, 'Fit + Type (synonym)');

    log('\n  --- 2E. FEATURE + TYPE ---');
    await test('waterproof jacket', { productType: 'jackets', features: ['waterproof'] }, 'Feature + Type');
    await test('padded jacket', { productType: 'jackets', features: ['padded'] }, 'Feature + Type');
    await test('hooded sweatshirt', { productType: 'sweatshirts', features: ['hooded'] }, 'Feature + Type (synonym)');

    log('\n  --- 2F. SECTOR + TYPE ---');
    await test('corporate polo', { productType: 'polos', sectors: ['corporate'] }, 'Sector + Type');
    await test('hospitality shirt', { productType: 'shirts', sectors: ['hospitality'] }, 'Sector + Type — "shirt" may be freeText');

    // ══════════════════════════════════════════════════════════
    // SECTION 3: REAL-WORLD USER SEARCHES (crazy level)
    // ══════════════════════════════════════════════════════════
    log('\n\n━━━ SECTION 3: REAL-WORLD USER SEARCHES (E-COMMERCE STYLE) ━━━');

    log('\n  --- 3A. Casual shopper searches ---');
    await test('polo', { productType: 'polos' }, 'Simple singular → should resolve via synonym to product type');
    await test('tshirt', { productType: 't-shirts' }, 'Common abbreviation');
    await test('hoodie', { productType: 'hoodies' }, 'Singular slang → synonym to hoodies');
    await test('sweatshirt', { productType: 'sweatshirts' }, 'Singular → synonym to sweatshirts');
    await test('t-shirt', { productType: 't-shirts' }, 'Hyphenated variant');

    log('\n  --- 3B. Colour-first searches ---');
    await test('black polo', { productType: 'polos', colours: ['black'] }, 'Colour first');
    await test('navy polo', {}, 'Shade name — may not be primary colour');
    await test('red hoodie', { productType: 'hoodies', colours: ['red'] }, 'Colour + singular synonym');
    await test('white t-shirt', { productType: 't-shirts', colours: ['white'] }, 'Colour + hyphenated type');

    log('\n  --- 3C. Brand-heavy searches ---');
    await test('nike', { brand: 'nike' }, 'Brand-only search');
    await test('under armour', { brand: 'under armour' }, 'Multi-word brand');
    await test('nike golf polo', { brand: 'nike', productType: 'polos', sports: ['golf'] }, '3-filter combination');
    await test('gildan hoodie', { brand: 'gildan', productType: 'hoodies' }, 'Brand + synonym type');
    await test('under armour polo', { brand: 'under armour', productType: 'polos' }, 'Multi-word brand + type');

    log('\n  --- 3D. Triple-filter searches ---');
    await test('black nike polo', { brand: 'nike', productType: 'polos', colours: ['black'] }, 'Colour + Brand + Type');
    await test('blue golf polo', { productType: 'polos', sports: ['golf'], colours: ['blue'] }, 'Colour + Sport + Type');
    await test('red corporate polo', { productType: 'polos', sectors: ['corporate'], colours: ['red'] }, 'Colour + Sector + Type');
    await test('black slim fit polo', { productType: 'polos', fits: ['slim fit'], colours: ['black'] }, 'Colour + Fit + Type');

    log('\n  --- 3E. Feature-specific searches (workwear/uniform buyer) ---');
    await test('waterproof jacket', { productType: 'jackets', features: ['waterproof'] }, 'Practical feature search');
    await test('high visibility', { features: ['high visibility'] }, 'Safety feature');
    await test('non-iron shirt', { productType: 'shirts', features: ['non-iron'] }, 'Workwear feature — note hyphen');
    await test('easycare polo', { productType: 'polos', features: ['easycare'] }, 'Workwear feature');

    log('\n  --- 3F. Misspellings & edge cases ---');
    await test('poloshirt', {}, 'No space — may go to freeText (trigram fallback)');
    await test('t shirts', { productType: 't-shirts' }, 'Space instead of hyphen');
    await test('tee shirt', {}, 'Colloquial term — depends on synonyms');
    await test('jumper', {}, 'UK English term — may not be in product types');
    await test('tracksuit', {}, 'Composite term — may be trackwear');

    log('\n  --- 3G. Gender-aware searches ---');
    await test('mens polo', { productType: 'polos' }, 'Gender prefix — gender not parsed, type should be');
    await test('womens hoodie', { productType: 'hoodies' }, 'Gender prefix — gender not parsed');
    await test('kids tshirt', { productType: 't-shirts' }, 'Age group prefix + synonym');

    log('\n  --- 3H. Style-code searches ---');
    await test('AD002', {}, 'Style code — should be handled by FTS/trigram');
    await test('NK170', {}, 'Style code — should be handled by FTS/trigram');

    // ══════════════════════════════════════════════════════════
    // SECTION 4: VERIFY COUNTS AGAINST FILTER DATA
    // ══════════════════════════════════════════════════════════
    log('\n\n━━━ SECTION 4: FILTER COUNT VERIFICATION ━━━');
    log('  Comparing search API counts vs filter data counts...');

    // Sports from filter data
    const sportTests = [
        { name: 'Golf', filterCount: 97 },
        { name: 'Gym', filterCount: 24 },
        { name: 'Swimming', filterCount: 15 },
        { name: 'Rugby', filterCount: 7 }
    ];

    log('\n  --- Sports ---');
    for (const s of sportTests) {
        const apiCount = await testSearchCount(s.name.toLowerCase());
        const dbCount = await getCount(`
      SELECT COUNT(DISTINCT p.style_code) as count FROM products p
      JOIN product_sports psp ON p.id = psp.product_id
      JOIN related_sports rsp ON psp.sport_id = rsp.id
      WHERE p.sku_status = 'Live' AND LOWER(rsp.name) = $1
    `, [s.name.toLowerCase()]);
        const match = apiCount === dbCount ? '✓' : '✗';
        log(`  ${match} ${s.name}: API=${apiCount} DB=${dbCount} Filter=${s.filterCount}`);
    }

    // Sectors from filter data
    const sectorTests = [
        { name: 'Corporate', filterCount: 1044 },
        { name: 'Fashion', filterCount: 765 },
        { name: 'Hospitality', filterCount: 477 },
        { name: 'Athleisure', filterCount: 291 },
        { name: 'Safety', filterCount: 178 }
    ];

    log('\n  --- Sectors ---');
    for (const s of sectorTests) {
        const apiCount = await testSearchCount(s.name.toLowerCase());
        const dbCount = await getCount(`
      SELECT COUNT(DISTINCT p.style_code) as count FROM products p
      JOIN product_sectors ps ON p.id = ps.product_id
      JOIN related_sectors rs ON ps.sector_id = rs.id
      WHERE p.sku_status = 'Live' AND LOWER(rs.name) = $1
    `, [s.name.toLowerCase()]);
        log(`  ${s.name}: API=${apiCount} DB=${dbCount} Filter=${s.filterCount}`);
    }

    // Fits
    const fitTests = ['Slim Fit', 'Classic Fit', 'Oversized', 'Stretch'];
    log('\n  --- Fits ---');
    for (const f of fitTests) {
        const apiCount = await testSearchCount(f.toLowerCase());
        const dbCount = await getCount(`
      SELECT COUNT(DISTINCT s.style_code) as count FROM styles s
      JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
      JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE sk.keyword_type = 'fit' AND LOWER(sk.name) = $1
    `, [f.toLowerCase()]);
        log(`  ${f}: API=${apiCount} DB=${dbCount}`);
    }

    // Necklines
    const neckTests = ['V-Neck', 'Crew Neck'];
    log('\n  --- Necklines ---');
    for (const n of neckTests) {
        const apiCount = await testSearchCount(n.toLowerCase());
        const dbCount = await getCount(`
      SELECT COUNT(DISTINCT s.style_code) as count FROM styles s
      JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
      JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE sk.keyword_type = 'neckline' AND LOWER(sk.name) = $1
    `, [n.toLowerCase()]);
        log(`  ${n}: API=${apiCount} DB=${dbCount}`);
    }

    // Sleeves
    const sleeveTests = ['Long Sleeve', 'Short Sleeve', 'Sleeveless'];
    log('\n  --- Sleeves ---');
    for (const sl of sleeveTests) {
        const apiCount = await testSearchCount(sl.toLowerCase());
        const dbCount = await getCount(`
      SELECT COUNT(DISTINCT s.style_code) as count FROM styles s
      JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
      JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE sk.keyword_type = 'sleeve' AND LOWER(sk.name) = $1
    `, [sl.toLowerCase()]);
        log(`  ${sl}: API=${apiCount} DB=${dbCount}`);
    }

    // ══════════════════════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════════════════════
    log('\n\n╔══════════════════════════════════════════════════════════════╗');
    log(`║  TEST SUMMARY: ${passCount} PASSED / ${failCount} FAILED / ${testNum} TOTAL        ║`);
    log('╚══════════════════════════════════════════════════════════════╝');

    if (failCount > 0) {
        log('\nFailed tests:');
        results.filter(r => r.status === 'FAIL' || r.status === 'ERROR').forEach(r => {
            log(`  #${r.testNum} "${r.searchTerm}"`);
            if (r.issues) r.issues.forEach(i => log(`    → ${i}`));
            if (r.error) log(`    → ${r.error}`);
        });
    }

    fs.writeFileSync('comprehensive_test_results.txt', output.join('\n'));
    log('\nResults written to comprehensive_test_results.txt');
    pool.end();
}

runTests().catch(e => {
    log('FATAL:', e.message, e.stack);
    fs.writeFileSync('comprehensive_test_results.txt', output.join('\n'));
    pool.end();
});
