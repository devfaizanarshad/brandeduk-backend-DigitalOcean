const { parseSearchQuery } = require('../services/search/searchQueryParser');
const { buildSearchConditions } = require('../services/search/searchService');
const { pool } = require('../config/database');

async function checkGolfPolo() {
    try {
        const rawQuery = "golf polo";
        console.log(`\n🔎 CHECKING QUERY: "${rawQuery}"\n`);

        // 1. API Logic Check
        console.log('--- 🧠 API Logic ---');
        const parsed = await parseSearchQuery(rawQuery);
        console.log('Classified:', JSON.stringify(parsed, null, 2));

        const searchResult = await buildSearchConditions(rawQuery, 'psm', 1);

        const whereClause = searchResult.conditions.length > 0
            ? 'WHERE ' + searchResult.conditions.join(' AND ')
            : '';

        const apiCountSql = `
      SELECT COUNT(*) as count, ARRAY_AGG(psm.style_code) as codes
      FROM product_search_materialized psm 
      ${whereClause}
    `;

        console.log('\n--- 🚀 API Execution ---');
        // console.log('SQL:', apiCountSql);
        // console.log('Params:', searchResult.params);

        const apiRes = await pool.query(apiCountSql, searchResult.params);
        const apiCount = parseInt(apiRes.rows[0].count);
        console.log(`API Found: ${apiCount} products`);
        if (apiCount > 0) {
            console.log('Sample matches:', apiRes.rows[0].codes.slice(0, 5).join(', '));
        }

        // 2. Database Manual Verification (Ground Truth)
        console.log('\n--- ⚖️ Database Ground Truth ---');

        // We check for Product Type "Polo" AND (Sport "Golf" OR "Golf" in name)
        const dbSql = `
      SELECT COUNT(DISTINCT s.style_code) as count
      FROM styles s
      JOIN product_types pt ON s.product_type_id = pt.id
      LEFT JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
      LEFT JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE pt.name ILIKE '%Polo%'
      AND (
        s.style_name ILIKE '%Golf%' 
        OR (sk.name ILIKE 'Golf' AND sk.keyword_type = 'sport')
      )
    `;

        const dbRes = await pool.query(dbSql);
        const dbCount = parseInt(dbRes.rows[0].count);
        console.log(`DB Count (Polo type + Golf keyword/name): ${dbCount}`);

        if (apiCount === dbCount) {
            console.log('\n✅ MATCH: API and DB return the same count.');
        } else {
            console.log(`\n⚠️ DISCREPANCY: API ${apiCount} vs DB ${dbCount}`);
            console.log('Note: API strictness might differ (e.g. strict sport match vs free text).');
        }

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        pool.end();
    }
}

checkGolfPolo();
