-- FIX_CONNECTIONS.sql
-- Run these commands as a PostgreSQL superuser (e.g., postgres) to clear zombie connections

-- ============================================================================
-- STEP 1: Check current connections for brandeduk role
-- ============================================================================
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    state,
    query_start,
    state_change,
    EXTRACT(EPOCH FROM (now() - state_change))::int as idle_seconds,
    LEFT(query, 100) as query_preview
FROM pg_stat_activity 
WHERE usename = 'brandeduk'
ORDER BY state_change DESC;

-- ============================================================================
-- STEP 2: Check connection limit for brandeduk role
-- ============================================================================
SELECT rolname, rolconnlimit 
FROM pg_roles 
WHERE rolname = 'brandeduk';

-- ============================================================================
-- STEP 3: Terminate ALL connections for brandeduk (BE CAREFUL!)
-- This will disconnect all active sessions, including any running queries
-- ============================================================================

-- Option A: Terminate idle connections only (safer)
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE usename = 'brandeduk' 
  AND state = 'idle';

-- Option B: Terminate ALL connections (more aggressive - use if Option A doesn't work)
-- SELECT pg_terminate_backend(pid) 
-- FROM pg_stat_activity 
-- WHERE usename = 'brandeduk' 
--   AND pid <> pg_backend_pid();

-- ============================================================================
-- STEP 4: Increase connection limit for brandeduk role (RECOMMENDED)
-- Default might be 10-20, increase to 50+ for e-commerce workloads
-- ============================================================================
-- ALTER ROLE brandeduk CONNECTION LIMIT 50;

-- ============================================================================
-- STEP 5: Verify connections were terminated
-- ============================================================================
SELECT COUNT(*) as active_connections, usename 
FROM pg_stat_activity 
WHERE usename = 'brandeduk' 
GROUP BY usename;

-- ============================================================================
-- POSTGRESQL SERVER CONFIGURATION RECOMMENDATIONS
-- Add these to postgresql.conf for better connection handling:
-- ============================================================================
-- 
-- # Idle connection timeout (terminate connections idle longer than this)
-- idle_in_transaction_session_timeout = 300000  -- 5 minutes
-- 
-- # Statement timeout (kill queries running longer than this)
-- statement_timeout = 30000  -- 30 seconds
--
-- # Increase max connections if needed
-- max_connections = 200

