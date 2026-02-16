const { buildSearchConditions } = require('../services/search/searchService');
const { pool } = require('../config/database');

async function simpleCheck() {
    try {
        // Check if any Gildan Red Polo exists
        const res = await pool.query(`
      SELECT COUNT(*) 
      FROM product_search_materialized psm 
      WHERE brand ILIKE 'Gildan' 
      AND (primary_colour ILIKE 'Red' OR colour_name ILIKE '%Red%')
      AND (style_name ILIKE '%Polo%' OR EXISTS (SELECT 1 FROM styles s JOIN product_types pt ON s.product_type_id=pt.id WHERE s.style_code=psm.style_code AND pt.name ILIKE 'Polo%'))
    `);
        console.log('Gildan Red Polos count:', res.rows[0].count);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
simpleCheck();
