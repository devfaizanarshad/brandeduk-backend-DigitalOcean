-- ============================================================================
-- UPDATE PRICING RULES - REDUCE ALL MARKUPS BY 5%
-- Run this on your PRODUCTION database to update existing pricing rules
-- ============================================================================

-- Step 1: Update all active pricing rules, reducing markup by 5%
UPDATE public.pricing_rules
SET 
    markup_percent = CASE 
        WHEN from_price = 0.01 AND to_price = 1.99 THEN 195.00
        WHEN from_price = 2.00 AND to_price = 2.99 THEN 75.00
        WHEN from_price = 3.00 AND to_price = 4.99 THEN 145.00
        WHEN from_price = 5.00 AND to_price = 9.99 THEN 133.00
        WHEN from_price = 10.00 AND to_price = 14.99 THEN 127.00
        WHEN from_price = 15.00 AND to_price = 24.99 THEN 85.00
        WHEN from_price = 25.00 AND to_price = 29.99 THEN 100.50
        WHEN from_price = 30.00 AND to_price = 34.99 THEN 105.30
        WHEN from_price = 35.00 AND to_price = 39.99 THEN 85.80
        WHEN from_price = 40.00 AND to_price = 44.99 THEN 80.70
        WHEN from_price = 45.00 AND to_price >= 999999.00 THEN 55.80
        ELSE markup_percent - 5.00  -- Fallback: reduce by 5% for any other rules
    END,
    description = CASE 
        WHEN from_price = 0.01 AND to_price = 1.99 THEN '195% markup for £0.01-£1.99 (reduced by 5%)'
        WHEN from_price = 2.00 AND to_price = 2.99 THEN '75% markup for £2.00-£2.99 (reduced by 5%)'
        WHEN from_price = 3.00 AND to_price = 4.99 THEN '145% markup for £3.00-£4.99 (reduced by 5%)'
        WHEN from_price = 5.00 AND to_price = 9.99 THEN '133% markup for £5.00-£9.99 (reduced by 5%)'
        WHEN from_price = 10.00 AND to_price = 14.99 THEN '127% markup for £10.00-£14.99 (reduced by 5%)'
        WHEN from_price = 15.00 AND to_price = 24.99 THEN '85% markup for £15.00-£24.99 (reduced by 5%)'
        WHEN from_price = 25.00 AND to_price = 29.99 THEN '100.5% markup for £25.00-£29.99 (reduced by 5%)'
        WHEN from_price = 30.00 AND to_price = 34.99 THEN '105.3% markup for £30.00-£34.99 (reduced by 5%)'
        WHEN from_price = 35.00 AND to_price = 39.99 THEN '85.8% markup for £35.00-£39.99 (reduced by 5%)'
        WHEN from_price = 40.00 AND to_price = 44.99 THEN '80.7% markup for £40.00-£44.99 (reduced by 5%)'
        WHEN from_price = 45.00 AND to_price >= 999999.00 THEN '55.8% markup for £45.00+ (reduced by 5%)'
        ELSE description || ' (reduced by 5%)'
    END,
    updated_at = NOW()
WHERE active = true;

-- Step 2: Verify the updates
SELECT id, version, from_price, to_price, markup_percent, description 
FROM public.pricing_rules 
WHERE active = true 
ORDER BY from_price;

-- ============================================================================
-- NOTES:
-- ============================================================================
-- After running this update, you should run the reprice.js script to update
-- all product sell_price values based on the new markup rules:
-- node utils/reprice.js
-- ============================================================================

