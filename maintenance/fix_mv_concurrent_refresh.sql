-- Add unique indexes to materialized views to allow CONCURRENT refreshes
-- Concurrent refresh requires a unique index on at least one column.

-- 1. Check if unique index exists on product_search_mv
-- If not, create it on 'id' column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'product_search_mv'
        AND indexname = 'idx_product_search_mv_unique_id'
    ) THEN
        CREATE UNIQUE INDEX idx_product_search_mv_unique_id ON public.product_search_mv (id);
        RAISE NOTICE 'Created unique index on product_search_mv (id)';
    END IF;
END $$;

-- 2. Ensure product_search_materialized also has its unique index (id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'product_search_materialized'
        AND indexname = 'idx_product_search_materialized_unique_id'
    ) THEN
        CREATE UNIQUE INDEX idx_product_search_materialized_unique_id ON public.product_search_materialized (id);
        RAISE NOTICE 'Created unique index on product_search_materialized (id)';
    END IF;
END $$;

-- 3. Verify that we can now refresh concurrently
-- (This might take a moment)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.product_search_mv;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.product_search_materialized;
