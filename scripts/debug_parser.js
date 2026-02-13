const { parseSearchQuery } = require('../services/search/searchQueryParser');
const { pool } = require('../config/database');

async function debugParser() {
    try {
        const rawQuery = "red gildan golf polo long seleeves crew neck";
        console.log(`\n🔎 ANALYZING QUERY: "${rawQuery}"\n`);

        const parsed = await parseSearchQuery(rawQuery);

        console.log('Free Text:', parsed.freeText);
        const tsQueryRaw = parsed.freeText.map(t => `${t}:*`).join(' & ');
        console.log('Generated TSQuery:', tsQueryRaw);

        try {
            const checkSql = `SELECT to_tsquery('english', $1) as valid`;
            const check = await pool.query(checkSql, [tsQueryRaw]);
            console.log('✅ TSQuery Valid:', check.rows[0].valid);
        } catch (e) {
            console.log('❌ TSQuery INVALID:', e.message);
        }

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        pool.end();
    }
}

debugParser();
