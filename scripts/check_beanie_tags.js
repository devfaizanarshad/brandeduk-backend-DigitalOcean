const { pool } = require('../config/database');

async function checkBeanieTags() {
    try {
        // 1. Get total Beanies
        const totalRes = await pool.query(`
      SELECT COUNT(DISTINCT psm.style_code)
      FROM product_search_materialized psm
      JOIN styles s ON psm.style_code = s.style_code
      JOIN product_types pt ON s.product_type_id = pt.id
      WHERE pt.name = 'Beanies' AND psm.sku_status = 'Live'
    `);
        const total = parseInt(totalRes.rows[0].count);
        console.log(`Total Beanies: ${total}`);

        // 2. Get Beanies with ANY style keyword (as seen in sidebar)
        // Sidebar uses 'style_keyword_slugs' but filters for 'style' type keywords explicitly via join.
        // The query used in productService is: 
        //   SELECT 'style' as filter_type, sk.slug, sk.name, COUNT(*) ...
        //   FROM base_products bp, unnest(bp.style_keyword_slugs) as arr_slug
        //   JOIN style_keywords sk ON arr_slug = sk.slug
        //   ...
        // But 'style_keyword_slugs' ARRAY column in PSM might contain keywords of ALL types (style, fit, feature).
        // We need to see which ones are TYPE='style'.

        const taggedRes = await pool.query(`
      WITH beanies AS (
        SELECT psm.style_code, psm.style_keyword_slugs
        FROM product_search_materialized psm
        JOIN styles s ON psm.style_code = s.style_code
        JOIN product_types pt ON s.product_type_id = pt.id
        WHERE pt.name = 'Beanies' AND psm.sku_status = 'Live'
      )
      SELECT COUNT(DISTINCT b.style_code)
      FROM beanies b, unnest(b.style_keyword_slugs) as k_slug
      JOIN style_keywords sk ON k_slug = sk.slug
      WHERE sk.keyword_type = 'style' -- Checking for 'style' type keywords specifically
    `);

        const taggedCount = parseInt(taggedRes.rows[0].count);
        console.log(`Beanies with explicit 'style' tags (keyword_type='style'): ${taggedCount}`);
        console.log(`Untagged Beanies: ${total - taggedCount}`);

        // Let's list some of the "Untagged" beanies to verify they are just "Beanies"
        const untaggedRes = await pool.query(`
      WITH beanies AS (
        SELECT psm.style_code, psm.style_name, psm.style_keyword_slugs
        FROM product_search_materialized psm
        JOIN styles s ON psm.style_code = s.style_code
        JOIN product_types pt ON s.product_type_id = pt.id
        WHERE pt.name = 'Beanies' AND psm.sku_status = 'Live'
      ),
      tagged_beanies AS (
        SELECT DISTINCT b.style_code
        FROM beanies b, unnest(b.style_keyword_slugs) as k_slug
        JOIN style_keywords sk ON k_slug = sk.slug
        WHERE sk.keyword_type = 'style'
      )
      SELECT b.style_code, b.style_name, b.style_keyword_slugs
      FROM beanies b
      LEFT JOIN tagged_beanies tb ON b.style_code = tb.style_code
      WHERE tb.style_code IS NULL
      LIMIT 5
    `);

        console.log('\nSample Untagged Beanies:');
        untaggedRes.rows.forEach(row => {
            console.log(`${row.style_code}: ${row.style_name} (Keywords: ${row.style_keyword_slugs})`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkBeanieTags();
