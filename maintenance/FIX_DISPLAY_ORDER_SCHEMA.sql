-- =====================================================
-- MIGRATION: Fix product_display_order table for reliability
-- =====================================================
-- This migration fixes three critical issues:
-- 1. NULL handling in unique constraint (PostgreSQL NULLs are not equal)
-- 2. Adds audit trail table for change tracking
-- 3. Adds proper unique index using COALESCE for NULL-safe upserts
-- =====================================================

-- Step 1: Create a proper unique index that handles NULLs correctly
-- PostgreSQL treats NULL != NULL, so UNIQUE(a, b, c) won't work when b or c is NULL
-- We use COALESCE to convert NULLs to 0 for uniqueness checking
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdo_unique_context 
ON product_display_order (style_code, COALESCE(brand_id, 0), COALESCE(product_type_id, 0));

-- Step 2: Create audit trail table
CREATE TABLE IF NOT EXISTS product_display_order_audit (
    id SERIAL PRIMARY KEY,
    action VARCHAR(20) NOT NULL,        -- 'INSERT', 'UPDATE', 'DELETE', 'BULK_REPLACE'
    style_code VARCHAR(50),
    product_type_id INTEGER,
    brand_id INTEGER,
    old_display_order INTEGER,
    new_display_order INTEGER,
    context TEXT,                        -- Description of what triggered the change
    batch_id VARCHAR(50),               -- Groups related changes together
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(50) DEFAULT 'api'    -- 'api', 'admin', 'maintenance_script', etc.
);

CREATE INDEX IF NOT EXISTS idx_pdo_audit_batch ON product_display_order_audit(batch_id);
CREATE INDEX IF NOT EXISTS idx_pdo_audit_style ON product_display_order_audit(style_code);
CREATE INDEX IF NOT EXISTS idx_pdo_audit_created ON product_display_order_audit(created_at);

-- Step 3: Remove duplicate entries (keep the one with lowest id)
DELETE FROM product_display_order a
USING product_display_order b
WHERE a.id > b.id
  AND a.style_code = b.style_code
  AND COALESCE(a.brand_id, 0) = COALESCE(b.brand_id, 0)
  AND COALESCE(a.product_type_id, 0) = COALESCE(b.product_type_id, 0);

-- Step 4: Clean up any NULL display_order entries (these are orphaned)
DELETE FROM product_display_order WHERE display_order IS NULL;

COMMENT ON TABLE product_display_order_audit IS 'Audit trail for all display order changes. Used for debugging and recovery.';
