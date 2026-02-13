const { parseSearchQuery } = require('../services/search/searchQueryParser');
const { buildSearchConditions } = require('../services/search/searchService');
const { pool } = require('../config/database');

async function verifyComplexSearch() {
    try {
        const rawQuery = "red gildan golf polo long seleeves crew neck";
        console.log(`\n🔎 ANALYZING QUERY: "${rawQuery}"\n`);

        // 1. Check Parser Output
        const parsed = await parseSearchQuery(rawQuery);

        console.log('--- 🧠 Parser Classification ---');
        console.log('Brand:      ', parsed.brand || '❌');
        console.log('Type:       ', parsed.productType || '❌');
        console.log('Colours:    ', parsed.colours.join(', ') || '❌');
        console.log('Fits:       ', parsed.fits.join(', ') || '❌');
        console.log('Sleeves:    ', parsed.sleeves.join(', ') || '❌ (Note: "seleeves" typo might cause this)');
        console.log('Necklines:  ', parsed.necklines.join(', ') || '❌');
        console.log('Sports:     ', parsed.sports.join(', ') || '❌');
        console.log('Free Text:  ', parsed.freeText.join(' ') || '(none)');

        // Debug TSQuery generation
        const tsQueryRaw = parsed.freeText.map(t => `${t}:*`).join(' & ');
        console.log('Generated TSQuery:', tsQueryRaw);

        // Test to_tsquery validity
        try {
            const checkSql = `SELECT to_tsquery('english', $1) as valid`;
            const check = await pool.query(checkSql, [tsQueryRaw]);
            console.log('✅ TSQuery Valid:', check.rows[0].valid);
        } catch (e) {
            console.log('❌ TSQuery INVALID:', e.code, e.message);
        }

        // 2. Build SQL
        const searchResult = await buildSearchConditions(rawQuery, 'psm', 1);

        // 3. Execute Search (Count)
        const whereClause = searchResult.conditions.length > 0
            ? 'WHERE ' + searchResult.conditions.join(' AND ')
            : '';

        const countSql = `
      SELECT COUNT(*) as count, ARRAY_AGG(psm.style_code) as codes
      FROM product_search_materialized psm 
      ${whereClause}
    `;

        console.log('\n--- 🚀 Running Search Query ---');
        console.log('Params:', searchResult.params);
        const start = Date.now();
        const res = await pool.query(countSql, searchResult.params);
        const duration = Date.now() - start;

        const count = parseInt(res.rows[0].count);
        console.log(`Found: ${count} products`);
        console.log(`Time:  ${duration}ms`);
        if (count > 0 && count < 10) {
            console.log('Matches:', res.rows[0].codes.join(', '));
        }

        // 4. Ground Truth Verification (Manual SQL ignoring typos)
        console.log('\n--- ⚖️ Manual Verification (Ground Truth) ---');
        const verifySql = `
      SELECT COUNT(DISTINCT s.style_code) as true_count
      FROM styles s
      JOIN brands b ON s.brand_id = b.id
      JOIN products p ON s.style_code = p.style_code
      JOIN product_types pt ON s.product_type_id = pt.id
      LEFT JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
      LEFT JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE b.name ILIKE 'Gildan'
        AND (p.primary_colour ILIKE 'Red' OR p.colour_name ILIKE '%Red%')
        AND pt.name ILIKE '%Polo%'
        -- We check for "Long Sleeve" explicitly
        AND EXISTS (
            SELECT 1 FROM style_keywords sk2 
            JOIN style_keywords_mapping skm2 ON sk2.id = skm2.keyword_id
            WHERE skm2.style_code = s.style_code 
            AND sk2.name ILIKE 'Long Sleeve'
        )
        -- We check for "Crew Neck"
        AND EXISTS (
          SELECT 1 FROM style_keywords sk3
          JOIN style_keywords_mapping skm3 ON sk3.id = skm3.keyword_id
          WHERE skm3.style_code = s.style_code
          AND sk3.name ILIKE 'Crew Neck'
        )
    `;

        const verifyRes = await pool.query(verifySql);
        const trueCount = parseInt(verifyRes.rows[0].true_count);

        console.log(`Manual DB Count (corrected typo): ${trueCount}`);

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        pool.end();
    }
}

verifyComplexSearch();
