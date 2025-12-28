const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'Branded_UK',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
  max: parseInt(process.env.DB_POOL_MAX) || 50,
  min: parseInt(process.env.DB_POOL_MIN) || 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  application_name: 'branded-uk-api',
  allowExitOnIdle: false,
  // SSL configuration for Render PostgreSQL
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
});

let poolStats = {
  totalConnections: 0,
  idleConnections: 0,
  waitingCount: 0,
  lastError: null,
  lastErrorTime: null,
};

pool.on('error', (err, client) => {
  console.error('[DB] Pool error:', {
    message: err.message,
    code: err.code,
    timestamp: new Date().toISOString(),
  });
  
  poolStats.lastError = err.message;
  poolStats.lastErrorTime = new Date().toISOString();
  
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    console.error('[DB] Critical connection error - queries will fail until connection restored');
  }
});

pool.on('connect', (client) => {
  poolStats.totalConnections++;
  console.log(`[DB] Connection established (total: ${poolStats.totalConnections})`);
});

pool.on('acquire', (client) => {
  poolStats.idleConnections = Math.max(0, poolStats.idleConnections - 1);
});

pool.on('remove', (client) => {
  poolStats.totalConnections = Math.max(0, poolStats.totalConnections - 1);
});

function getPoolStats() {
  return {
    ...poolStats,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

async function checkDatabaseHealth() {
  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    return {
      healthy: true,
      timestamp: result.rows[0].current_time,
      version: result.rows[0].pg_version.split(' ')[0] + ' ' + result.rows[0].pg_version.split(' ')[1],
      pool: getPoolStats(),
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      pool: getPoolStats(),
    };
  }
}

async function closePool() {
  console.log('[DB] Closing connection pool');
  try {
    await pool.end();
    console.log('[DB] Connection pool closed');
  } catch (error) {
    console.error('[DB] Error closing pool:', error.message);
  }
}

async function queryWithTimeout(text, params, timeoutMs = 30000) {
  const startTime = Date.now();
  
  try {
    const queryPromise = pool.query(text, params);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Query timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    
    const result = await Promise.race([queryPromise, timeoutPromise]);
    const duration = Date.now() - startTime;
    
    if (duration > 1000) {
      console.warn(`[DB] Slow query: ${duration}ms`, {
        query: text.substring(0, 100) + '...',
        duration,
      });
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[DB] Query error:', {
      message: error.message,
      duration,
      query: text.substring(0, 100) + '...',
    });
    throw error;
  }
}

module.exports = {
  pool,
  queryWithTimeout,
  getPoolStats,
  checkDatabaseHealth,
  closePool,
};

