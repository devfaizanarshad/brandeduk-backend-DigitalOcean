// config/database.js - Production PostgreSQL Pool for 1GB RAM Server
const { Pool } = require('pg');
require('dotenv').config();

// Configuration optimized for 1GB RAM e-commerce server
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'brandeduk_prod',
  user: process.env.DB_USER || 'brandeduk',
  password: process.env.DB_PASSWORD || 'omglol123',
  
  // 🎯 CRITICAL: Optimized for 1GB RAM
  max: parseInt(process.env.DB_POOL_MAX) || 8,      // MAX: 8 connections (was 50)
  min: parseInt(process.env.DB_POOL_MIN) || 2,      // MIN: 2 connections (was 5)
  idleTimeoutMillis: 10000,                         // 10 seconds idle (was 30000)
  
  // 🚀 Balanced timeout strategy - allow queries to complete but fail fast on real issues
  connectionTimeoutMillis: 5000,                    // 5s connection timeout (was 2s - too aggressive)
  statement_timeout: 30000,                        // PostgreSQL kills queries >30s (was 5s - too short)
  query_timeout: 30000,                            // App-level timeout 30s (was 5s - too short)
  
  // Application settings
  application_name: 'branded-uk-api',
  allowExitOnIdle: false,
  
  // SSL - only for remote connections
  ssl: process.env.DB_HOST !== 'localhost' ? { rejectUnauthorized: false } : false
});

// Simple monitoring (low memory footprint)
const poolStats = {
  totalConnections: 0,
  activeQueries: 0,
  errors: 0,
  slowQueries: 0
};

// Minimal event listeners
pool.on('connect', () => {
  poolStats.totalConnections++;
  if (poolStats.totalConnections % 5 === 0) { // Log every 5th connection
    console.log(`[DB] Connections: ${poolStats.totalConnections}, Active: ${poolStats.activeQueries}`);
  }
});

pool.on('acquire', () => {
  poolStats.activeQueries++;
});

pool.on('release', () => {
  poolStats.activeQueries = Math.max(0, poolStats.activeQueries - 1);
});

pool.on('error', (err) => {
  poolStats.errors++;
  console.error('[DB] Pool error:', err.message);
});

// Health check - FAST and SIMPLE
async function checkDatabaseHealth() {
  try {
    const result = await pool.query('SELECT 1 as healthy');
    return {
      healthy: true,
      connections: poolStats.totalConnections,
      active: poolStats.activeQueries,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// 🎯 OPTIMIZED QUERY WITH SMART TIMEOUT
// Default: 20 seconds for product queries, 10 seconds for simple queries
async function queryWithTimeout(text, params, timeoutMs = 20000) {
  const startTime = Date.now();
  const queryType = detectQueryType(text);
  const adjustedTimeout = adjustTimeout(timeoutMs, queryType);
  
  try {
    const queryPromise = pool.query(text, params);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        poolStats.slowQueries++;
        reject(new Error(`Query timeout after ${adjustedTimeout}ms`));
      }, adjustedTimeout)
    );

    const result = await Promise.race([queryPromise, timeoutPromise]);
    const duration = Date.now() - startTime;
    
    // Log only truly slow queries (>3s)
    if (duration > 3000) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 80) + '...');
      poolStats.slowQueries++;
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[DB] Query failed:', {
      type: queryType,
      duration: `${duration}ms`,
      error: error.message,
      query: text.substring(0, 60) + '...'
    });
    throw error;
  }
}

// Helper: Detect query type for smart timeout adjustment
function detectQueryType(query) {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('select count(*)') || lowerQuery.includes('select 1')) {
    return 'count';
  }
  if (lowerQuery.includes('product_search_materialized') && 
      (lowerQuery.includes('where') || lowerQuery.includes('filter'))) {
    return 'product_search';
  }
  if (lowerQuery.includes('join') || lowerQuery.includes('union') || lowerQuery.includes('with')) {
    return 'complex';
  }
  return 'simple';
}

// Helper: Adjust timeout based on query type
function adjustTimeout(baseTimeout, queryType) {
  const adjustments = {
    'count': 5000,           // Count queries: 5s (was 1s - too short)
    'simple': 10000,         // Simple SELECTs: 10s (was 2s - too short)
    'product_search': 20000, // Product searches: 20s (was 5s - too short)
    'complex': 30000         // Complex joins: 30s (was 8s - too short)
  };
  
  return Math.min(adjustments[queryType] || baseTimeout, 30000); // Cap at 30s
}

// 🛡️ Resilient query with exponential backoff
async function resilientQuery(text, params, maxRetries = 2) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryWithTimeout(text, params);
    } catch (error) {
      lastError = error;
      
      // Don't retry timeouts or syntax errors
      if (error.message.includes('timeout') || 
          error.message.includes('syntax') ||
          error.message.includes('permission')) {
        break;
      }
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`[DB] Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Graceful shutdown
async function closePool() {
  console.log('[DB] Closing pool with', poolStats.activeQueries, 'active queries...');
  try {
    await pool.end();
    console.log('[DB] Pool closed successfully');
  } catch (error) {
    console.error('[DB] Error closing pool:', error.message);
  }
}

// Export public API
module.exports = {
  pool,
  queryWithTimeout,
  resilientQuery,
  checkDatabaseHealth,
  closePool,
  
  // Simple stats getter
  getStats: () => ({ ...poolStats }),
  
  // Quick connection test
  testConnection: async () => {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
};