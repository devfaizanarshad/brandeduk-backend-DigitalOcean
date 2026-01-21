-- ============================================================================
-- PRICING RULES TABLE CREATION SCRIPT
-- Run this on your PRODUCTION database
-- ============================================================================
-- This table stores the tiered markup rules for calculating sell_price
-- ============================================================================

-- Step 1: Create the pricing_rules table
CREATE TABLE IF NOT EXISTS public.pricing_rules (
    id SERIAL PRIMARY KEY,
    version VARCHAR(50) NOT NULL DEFAULT '1.0',
    from_price NUMERIC(10,2) NOT NULL,
    to_price NUMERIC(10,2) NOT NULL,
    markup_percent NUMERIC(5,2) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_price_range CHECK (to_price >= from_price),
    CONSTRAINT check_markup_positive CHECK (markup_percent >= 0)
);

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pricing_rules_active ON public.pricing_rules (active);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_price_range ON public.pricing_rules (from_price, to_price);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_version ON public.pricing_rules (version);

-- Step 3: Insert the pricing rules (based on your MARKUP_TIERS)
-- Note: For the last tier (45.00+), we use a large number like 999999.99
INSERT INTO public.pricing_rules (version, from_price, to_price, markup_percent, active, description) VALUES
('1.0', 0.01, 1.99, 200.00, true, '200% markup for £0.01-£1.99'),
('1.0', 2.00, 2.99, 80.00, true, '80% markup for £2.00-£2.99'),
('1.0', 3.00, 4.99, 150.00, true, '150% markup for £3.00-£4.99'),
('1.0', 5.00, 9.99, 138.00, true, '138% markup for £5.00-£9.99'),
('1.0', 10.00, 14.99, 132.00, true, '132% markup for £10.00-£14.99'),
('1.0', 15.00, 24.99, 90.00, true, '90% markup for £15.00-£24.99'),
('1.0', 25.00, 29.99, 105.50, true, '105.5% markup for £25.00-£29.99'),
('1.0', 30.00, 34.99, 110.30, true, '110.3% markup for £30.00-£34.99'),
('1.0', 35.00, 39.99, 90.80, true, '90.8% markup for £35.00-£39.99'),
('1.0', 40.00, 44.99, 85.70, true, '85.7% markup for £40.00-£44.99'),
('1.0', 45.00, 999999.99, 60.80, true, '60.8% markup for £45.00+')
ON CONFLICT DO NOTHING;

-- Step 4: Verify the rules were inserted
-- SELECT * FROM pricing_rules WHERE active = true ORDER BY from_price;

-- ============================================================================
-- USEFUL QUERIES FOR MANAGING PRICING RULES
-- ============================================================================

-- View all active rules
-- SELECT id, version, from_price, to_price, markup_percent, description 
-- FROM pricing_rules 
-- WHERE active = true 
-- ORDER BY from_price;

-- Deactivate all rules (when updating to new version)
-- UPDATE pricing_rules SET active = false WHERE active = true;

-- Activate rules for a specific version
-- UPDATE pricing_rules SET active = true WHERE version = '1.0';

-- Add a new rule
-- INSERT INTO pricing_rules (version, from_price, to_price, markup_percent, active, description)
-- VALUES ('1.0', 50.00, 99.99, 55.00, true, '55% markup for £50.00-£99.99');

-- Update an existing rule
-- UPDATE pricing_rules 
-- SET markup_percent = 65.00, updated_at = NOW() 
-- WHERE id = 11;

-- ============================================================================
-- NOTES:
-- ============================================================================
-- 1. The version field allows you to maintain multiple rule sets
-- 2. Only rules with active = true are used by the reprice script
-- 3. Price ranges should not overlap (each price should match exactly one rule)
-- 4. The last tier uses 999999.99 as to_price to cover all prices above 45.00
-- 5. When updating rules, deactivate old ones and insert new ones with a new version
-- ============================================================================

