// config/database.js - Production PostgreSQL Pool with PROPER Connection Management
const { Pool } = require('pg');
require('dotenv').config();

const NODE_ENV = (process.env.NODE_ENV || 'development').toLowerCase();

// Defaults: safe for local testing, explicit for production
const DEFAULTS =
  NODE_ENV === 'production'
    ? {
        host: 'localhost',
        port: 5432,
        database: 'brandeduk_prod',
        user: 'brandeduk',
        password: 'omglol123',
        ssl: true,
      }
    : {
        host: 'localhost',
        port: 5432,
        database: 'brandeduk_ralawise_backup',
        user: 'postgres',
        password: '1234',
        ssl: false,
      };

const resolved = {
  host: process.env.DB_HOST || DEFAULTS.host,
  port: parseInt(process.env.DB_PORT || DEFAULTS.port, 10),
  database: process.env.DB_NAME || DEFAULTS.database,
  user: process.env.DB_USER || DEFAULTS.user,
  password: process.env.DB_PASSWORD || DEFAULTS.password,
};

// Safety: prevent accidental prod DB usage during testing
if (
  NODE_ENV !== 'production' &&
  /prod/i.test(resolved.database) &&
  process.env.ALLOW_PROD_DB !== 'true'
) {
  throw new Error(
    `[DB] Refusing to connect to production-like database "${resolved.database}" when NODE_ENV="${NODE_ENV}". Set ALLOW_PROD_DB=true to override.`
  );
}

// SSL: use DB_SSL if explicitly set, otherwise infer from host
const dbSslRaw = process.env.DB_SSL;
const sslEnabled =
  typeof dbSslRaw === 'string'
    ? dbSslRaw.toLowerCase() === 'true'
    : DEFAULTS.ssl || (resolved.host !== 'localhost' && resolved.host !== '127.0.0.1');

// Configuration optimized for LIMITED connections (shared hosting scenario)
const pool = new Pool({
  ...resolved,

  // 🎯 CRITICAL: Minimal connections to avoid hitting per-role limits
  max: parseInt(process.env.DB_POOL_MAX) || 3,      // MAX: 3 connections (very conservative)
  min: parseInt(process.env.DB_POOL_MIN) || 1,      // MIN: 1 connection
  idleTimeoutMillis: 5000,                          // 5 seconds idle before release (faster cleanup)

  // Connection management
  connectionTimeoutMillis: 30000,                   // 30s to acquire connection (wait longer)
  statement_timeout: 600000,                        // PostgreSQL kills queries >10min (needed for MV refresh)
  query_timeout: 600000,                            // App-level timeout 10min

  // Application settings
  application_name: 'branded-uk-api',
  allowExitOnIdle: true,                            // Allow connections to close when idle

  // SSL - enabled only when configured/required
  ssl: sslEnabled ? { rejectUnauthorized: false } : false
});

// 🔒 SEMAPHORE: Limit concurrent queries to prevent connection exhaustion
const MAX_CONCURRENT_QUERIES = 2; // Maximum concurrent queries (very conservative for limited connections)
let activeQueryCount = 0;
const queryQueue = [];

// Pool statistics
const poolStats = {
  totalConnections: 0,
  activeQueries: 0,
  queuedQueries: 0,
  completedQueries: 0,
  timeoutErrors: 0,
  connectionErrors: 0,
  peakConcurrent: 0
};

// Event listeners for monitoring
pool.on('connect', (client) => {
  poolStats.totalConnections++;
});

pool.on('acquire', () => {
  poolStats.activeQueries++;
  if (poolStats.activeQueries > poolStats.peakConcurrent) {
    poolStats.peakConcurrent = poolStats.activeQueries;
  }
});

pool.on('release', () => {
  poolStats.activeQueries = Math.max(0, poolStats.activeQueries - 1);
});

pool.on('error', (err, client) => {
  poolStats.connectionErrors++;
  console.error('[DB] Pool error:', err.message);
});

pool.on('remove', () => {
  // Connection removed from pool
});

// Health check
async function checkDatabaseHealth() {
  try {
    const result = await pool.query('SELECT 1 as healthy');
    return {
      healthy: true,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      },
      stats: { ...poolStats },
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

// 🎯 FIXED: Query with proper connection management, guaranteed release, and retry on connection errors
async function queryWithTimeout(text, params, timeoutMs = 20000) {
  const startTime = Date.now();
  const queryType = detectQueryType(text);
  const adjustedTimeout = adjustTimeout(timeoutMs, queryType);

  // Retry logic for connection errors
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Wait for semaphore slot
    await acquireSemaphore();

    let client = null;
    let timeoutId = null;
    let queryCompleted = false;

    try {
      // Get a dedicated client from the pool with timeout
      const connectPromise = pool.connect();
      const connectTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection acquisition timeout')), 15000);
      });

      client = await Promise.race([connectPromise, connectTimeoutPromise]);

      // Create a promise that will reject on timeout
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!queryCompleted) {
            poolStats.timeoutErrors++;
            reject(new Error(`Query timeout after ${adjustedTimeout}ms`));
          }
        }, adjustedTimeout);
      });

      // Execute the actual query
      const queryPromise = client.query(text, params);

      // Race between query and timeout
      const result = await Promise.race([queryPromise, timeoutPromise]);
      queryCompleted = true;

      const duration = Date.now() - startTime;
      poolStats.completedQueries++;

      // Log slow queries (>5s)
      if (duration > 5000) {
        console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 100) + '...');
      }

      return result;
    } catch (error) {
      lastError = error;
      const duration = Date.now() - startTime;

      // Check if this is a connection limit error that might be recoverable
      const isConnectionError = error.message.includes('too many connections') ||
        error.message.includes('too many clients') ||
        error.message.includes('Connection acquisition timeout') ||
        error.message.includes('connection slots');

      if (isConnectionError && attempt < maxRetries - 1) {
        // Wait before retrying (exponential backoff)
        const retryDelay = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.warn(`[DB] Connection limit hit, retrying in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }

      // Log the error
      console.error('[DB] Query failed:', {
        type: queryType,
        duration: `${duration}ms`,
        error: error.message,
        query: text.substring(0, 80) + '...'
      });

      throw error;
    } finally {
      // 🔒 CRITICAL: Always clear timeout and release client
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (client) {
        try {
          client.release(true); // Release with destroy=true to not reuse problematic connections
        } catch (releaseError) {
          // Ignore release errors
        }
      }

      releaseSemaphore();
    }
  }

  // If we've exhausted all retries, throw the last error
  throw lastError;
}

// 🔒 Semaphore acquisition - limits concurrent queries
function acquireSemaphore() {
  return new Promise((resolve) => {
    if (activeQueryCount < MAX_CONCURRENT_QUERIES) {
      activeQueryCount++;
      resolve();
    } else {
      poolStats.queuedQueries++;
      queryQueue.push(resolve);
    }
  });
}

// 🔒 Semaphore release
function releaseSemaphore() {
  activeQueryCount--;

  if (queryQueue.length > 0) {
    const next = queryQueue.shift();
    activeQueryCount++;
    poolStats.queuedQueries = Math.max(0, poolStats.queuedQueries - 1);
    next();
  }
}

// Helper: Detect query type for smart timeout adjustment
function detectQueryType(query) {
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes('select count(*)') || lowerQuery.includes('select 1')) {
    return 'count';
  }
  if (lowerQuery.includes('total_count') || lowerQuery.includes('count(*) as total')) {
    return 'count';
  }
  if (lowerQuery.includes('unnest') || lowerQuery.includes('array_agg')) {
    return 'aggregation';
  }
  if (lowerQuery.includes('product_search_materialized')) {
    return 'product_search';
  }
  if (lowerQuery.includes('join') || lowerQuery.includes('union') || lowerQuery.includes('with')) {
    return 'complex';
  }
  return 'simple';
}

// Helper: Adjust timeout based on query type
function adjustTimeout(baseTimeout, queryType) {
  // usage: queryWithTimeout(sql, params, 600000) -> should respect 600000
  if (baseTimeout > 30000) {
    return baseTimeout;
  }

  const adjustments = {
    'count': 15000,          // Count queries: 15s (can be heavy with CTEs)
    'simple': 10000,         // Simple SELECTs: 10s
    'aggregation': 15000,    // Aggregation queries: 15s
    'product_search': 20000, // Product searches: 20s
    'complex': 25000         // Complex joins: 25s
  };

  return Math.min(adjustments[queryType] || baseTimeout, 25000);
}

// 🛡️ Simple query (for non-critical queries that can use pool.query directly)
async function simpleQuery(text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    console.error('[DB] Simple query failed:', error.message);
    throw error;
  }
}

// 🛡️ Resilient query with exponential backoff (uses proper connection management)
async function resilientQuery(text, params, maxRetries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryWithTimeout(text, params);
    } catch (error) {
      lastError = error;

      // Don't retry timeouts, syntax errors, or connection limit errors
      if (error.message.includes('timeout') ||
        error.message.includes('syntax') ||
        error.message.includes('permission') ||
        error.message.includes('too many connections') ||
        error.message.includes('too many clients')) {
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
  console.log('[DB] Closing pool...', {
    activeQueries: poolStats.activeQueries,
    queuedQueries: queryQueue.length
  });

  // Wait for queued queries to drain (max 10s)
  const drainStart = Date.now();
  while (queryQueue.length > 0 && Date.now() - drainStart < 10000) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

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
  simpleQuery,
  resilientQuery,
  checkDatabaseHealth,
  closePool,

  // Stats getter
  getStats: () => ({
    ...poolStats,
    poolTotal: pool.totalCount,
    poolIdle: pool.idleCount,
    poolWaiting: pool.waitingCount,
    activeQueryCount,
    queueLength: queryQueue.length
  }),

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
