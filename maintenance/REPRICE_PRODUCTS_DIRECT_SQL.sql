-- ============================================================================
-- REPRICE ALL PRODUCTS - DIRECT SQL QUERY
-- Run this directly in your database to update all product sell_price values
-- based on the updated pricing_rules (with 5% reduced markups)
-- ============================================================================

-- This query updates all products' sell_price based on the active pricing rules
-- It uses carton_price if available (and not 0), otherwise falls back to single_price
UPDATE products p
SET 
    sell_price = ROUND(
        COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
        * (1 + (
            SELECT markup_percent / 100
            FROM pricing_rules r
            WHERE r.active = true
                AND COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0))
                    BETWEEN r.from_price AND r.to_price
            ORDER BY r.from_price
            LIMIT 1
        )), 2
    ),
    pricing_version = (
        SELECT version 
        FROM pricing_rules r 
        WHERE r.active = true 
        LIMIT 1
    ),
    last_priced_at = NOW()
WHERE COALESCE(NULLIF(p.carton_price, 0), NULLIF(p.single_price, 0)) IS NOT NULL;

-- ============================================================================
-- STEP 2: REFRESH MATERIALIZED VIEW
-- ============================================================================
-- IMPORTANT: Refresh the materialized view to update sell_price in search results
-- Use CONCURRENTLY to avoid locking (requires unique index on the view)
REFRESH MATERIALIZED VIEW CONCURRENTLY product_search_materialized;

-- If CONCURRENTLY fails (no unique index), use regular refresh:
-- REFRESH MATERIALIZED VIEW product_search_materialized;

-- ============================================================================
-- VERIFICATION QUERIES (run these after the update to check results)
-- ============================================================================

-- Check how many products were updated
SELECT COUNT(*) as total_products_updated
FROM products
WHERE last_priced_at >= NOW() - INTERVAL '1 minute';

-- Sample of updated products with their prices
SELECT 
    style_code,
    carton_price,
    single_price,
    sell_price,
    pricing_version,
    last_priced_at
FROM products
WHERE last_priced_at >= NOW() - INTERVAL '1 minute'
ORDER BY last_priced_at DESC
LIMIT 20;

-- Check products by price range to verify markup is applied correctly
SELECT 
    CASE 
        WHEN COALESCE(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 0.01 AND 1.99 THEN '£0.01-£1.99 (195% markup)'
        WHEN COALESCE(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 2.00 AND 2.99 THEN '£2.00-£2.99 (75% markup)'
        WHEN COALESCE(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 3.00 AND 4.99 THEN '£3.00-£4.99 (145% markup)'
        WHEN COALESCE(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 5.00 AND 9.99 THEN '£5.00-£9.99 (133% markup)'
        WHEN COALES(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 10.00 AND 14.99 THEN '£10.00-£14.99 (127% markup)'
        WHEN COALES(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 15.00 AND 24.99 THEN '£15.00-£24.99 (85% markup)'
        WHEN COALES(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 25.00 AND 29.99 THEN '£25.00-£29.99 (100.5% markup)'
        WHEN COALES(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 30.00 AND 34.99 THEN '£30.00-£34.99 (105.3% markup)'
        WHEN COALES(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 35.00 AND 39.99 THEN '£35.00-£39.99 (85.8% markup)'
        WHEN COALES(NULLIF(carton_price, 0), NULLIF(single_price, 0)) BETWEEN 40.00 AND 44.99 THEN '£40.00-£44.99 (80.7% markup)'
        WHEN COALES(NULLIF(carton_price, 0), NULLIF(single_price, 0)) >= 45.00 THEN '£45.00+ (55.8% markup)'
        ELSE 'No price'
    END as price_tier,
    COUNT(*) as product_count,
    AVG(COALESCE(NULLIF(carton_price, 0), NULLIF(single_price, 0))) as avg_cost_price,
    AVG(sell_price) as avg_sell_price
FROM products
WHERE COALESCE(NULLIF(carton_price, 0), NULLIF(single_price, 0)) IS NOT NULL
GROUP BY price_tier
ORDER BY MIN(COALESCE(NULLIF(carton_price, 0), NULLIF(single_price, 0)));

