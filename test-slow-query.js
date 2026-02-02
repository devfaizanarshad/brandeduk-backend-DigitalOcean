// Test script to diagnose slow product query
const { pool, queryWithTimeout } = require('./config/database');

async function testQueries() {
    console.log('Testing database queries...\n');

    // Test 1: Simple count from materialized view
    console.log('TEST 1: Simple count from materialized view');
    let start = Date.now();
    try {
        const result = await queryWithTimeout(
            `SELECT COUNT(DISTINCT style_code) FROM product_search_materialized WHERE sku_status = 'Live'`,
            [],
            30000
        );
        console.log(`  Result: ${result.rows[0].count} products`);
        console.log(`  Time: ${Date.now() - start}ms\n`);
    } catch (err) {
        console.log(`  ERROR: ${err.message}\n`);
    }

    // Test 2: Simple paginated query from materialized view ONLY
    console.log('TEST 2: Simple paginated query (no JOINs)');
    start = Date.now();
    try {
        const result = await queryWithTimeout(
            `SELECT DISTINCT style_code 
       FROM product_search_materialized 
       WHERE sku_status = 'Live' 
       ORDER BY created_at DESC 
       LIMIT 28`,
            [],
            30000
        );
        console.log(`  Result: ${result.rows.length} style codes`);
        console.log(`  Time: ${Date.now() - start}ms\n`);
    } catch (err) {
        console.log(`  ERROR: ${err.message}\n`);
    }

    // Test 3: Query with products table JOIN
    console.log('TEST 3: Query with products table JOIN');
    start = Date.now();
    try {
        const result = await queryWithTimeout(
            `SELECT DISTINCT psm.style_code, MIN(p.sell_price) as sell_price
       FROM product_search_materialized psm
       INNER JOIN products p ON psm.style_code = p.style_code AND p.sku_status = 'Live'
       WHERE psm.sku_status = 'Live'
       GROUP BY psm.style_code
       ORDER BY MIN(psm.created_at) DESC 
       LIMIT 28`,
            [],
            30000
        );
        console.log(`  Result: ${result.rows.length} products`);
        console.log(`  Time: ${Date.now() - start}ms\n`);
    } catch (err) {
        console.log(`  ERROR: ${err.message}\n`);
    }

    // Test 4: Full CTE query (the problematic one)
    console.log('TEST 4: Full CTE query with all JOINs');
    start = Date.now();
    try {
        const result = await queryWithTimeout(
            `WITH style_codes_filtered AS (
        SELECT DISTINCT style_code
        FROM product_search_materialized
        WHERE sku_status = 'Live'
      ),
      style_codes_with_meta AS (
        SELECT 
          scf.style_code,
          MIN(psm.style_name) as style_name,
          MIN(p.sell_price) as sell_price,
          MIN(psm.created_at) as created_at,
          MIN(COALESCE(pt.display_order, 999)) as product_type_priority,
          MIN(COALESCE(b.name, '')) as brand_name,
          999999 as custom_display_order,
          0 as is_best,
          0 as is_recommended
        FROM style_codes_filtered scf
        INNER JOIN product_search_materialized psm ON scf.style_code = psm.style_code
        INNER JOIN products p ON psm.style_code = p.style_code AND p.sku_status = 'Live'
        LEFT JOIN styles s ON psm.style_code = s.style_code
        LEFT JOIN product_types pt ON s.product_type_id = pt.id
        LEFT JOIN brands b ON s.brand_id = b.id
        WHERE psm.sku_status = 'Live'
        GROUP BY scf.style_code
        HAVING MIN(p.sell_price) IS NOT NULL
      )
      SELECT style_code, sell_price
      FROM style_codes_with_meta
      ORDER BY custom_display_order ASC, product_type_priority ASC, created_at DESC
      LIMIT 28`,
            [],
            30000
        );
        console.log(`  Result: ${result.rows.length} products`);
        console.log(`  Time: ${Date.now() - start}ms\n`);
    } catch (err) {
        console.log(`  ERROR: ${err.message}\n`);
    }

    // Test 5: Check if product_display_order table is causing issues
    console.log('TEST 5: Count in product_display_order table');
    start = Date.now();
    try {
        const result = await queryWithTimeout(
            `SELECT COUNT(*) FROM product_display_order`,
            [],
            10000
        );
        console.log(`  Result: ${result.rows[0].count} rows`);
        console.log(`  Time: ${Date.now() - start}ms\n`);
    } catch (err) {
        console.log(`  ERROR: ${err.message}\n`);
    }

    // Test 6: Check product_flags join performance
    console.log('TEST 6: Count in product_flags table');
    start = Date.now();
    try {
        const result = await queryWithTimeout(
            `SELECT COUNT(*) FROM product_flags`,
            [],
            10000
        );
        console.log(`  Result: ${result.rows[0].count} rows`);
        console.log(`  Time: ${Date.now() - start}ms\n`);
    } catch (err) {
        console.log(`  ERROR: ${err.message}\n`);
    }

    await pool.end();
    console.log('Done!');
}

testQueries().catch(console.error);
