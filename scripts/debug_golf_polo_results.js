const { pool } = require('../config/database');
const { buildSearchConditions } = require('../services/search/searchService');

async function debugResults() {
    try {
        const rawQuery = "golf polo";
        const searchResult = await buildSearchConditions(rawQuery, 'psm', 1);

        const whereClause = searchResult.conditions.length > 0
            ? 'WHERE ' + searchResult.conditions.join(' AND ')
            : '';

        const sql = `
      SELECT psm.style_code, psm.style_name, psm.brand
      FROM product_search_materialized psm 
      ${whereClause}
      LIMIT 10
    `;

        const res = await pool.query(sql, searchResult.params);
        console.log('Sample Results for "golf polo":');
        res.rows.forEach(r => console.log(`- [${r.style_code}] ${r.brand} ${r.style_name}`));

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

debugResults();
