/**
 * Redis Configuration
 * 
 * Provides Redis connection with graceful fallback for local development.
 * If Redis is not available, the system will use in-memory caching instead.
 * 
 * Environment variables:
 * - REDIS_HOST: Redis server host (default: localhost)
 * - REDIS_PORT: Redis server port (default: 6379)
 * - REDIS_PASSWORD: Redis password (optional)
 * - REDIS_ENABLED: Set to 'false' to force in-memory caching
 */

const Redis = require('ioredis');

// Check if Redis should be enabled
const redisEnabled = process.env.REDIS_ENABLED !== 'false';

let redis = null;
let isConnected = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

if (redisEnabled) {
    const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
            if (times > MAX_CONNECTION_ATTEMPTS) {
                console.log('[REDIS] Max connection attempts reached, using in-memory fallback');
                return null; // Stop retrying
            }
            return Math.min(times * 200, 2000); // Retry with exponential backoff
        },
        lazyConnect: true,
        enableOfflineQueue: false, // Don't queue commands when disconnected
        connectTimeout: 5000,
    };

    // Add password if provided
    if (process.env.REDIS_PASSWORD) {
        redisConfig.password = process.env.REDIS_PASSWORD;
    }

    redis = new Redis(redisConfig);

    redis.on('connect', () => {
        isConnected = true;
        connectionAttempts = 0;
        console.log('[REDIS] Connected successfully');
    });

    redis.on('ready', () => {
        console.log('[REDIS] Ready to accept commands');
    });

    redis.on('error', (err) => {
        connectionAttempts++;
        if (connectionAttempts <= MAX_CONNECTION_ATTEMPTS) {
            console.warn(`[REDIS] Connection error (attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}):`, err.message);
        }
    });

    redis.on('close', () => {
        isConnected = false;
        console.log('[REDIS] Connection closed');
    });

    redis.on('reconnecting', () => {
        console.log('[REDIS] Reconnecting...');
    });

    // Attempt initial connection (non-blocking)
    redis.connect().catch((err) => {
        console.warn('[REDIS] Initial connection failed, will use in-memory fallback:', err.message);
    });
} else {
    console.log('[REDIS] Disabled via REDIS_ENABLED=false, using in-memory caching');
}

/**
 * Check if Redis is currently connected and available
 */
function isRedisAvailable() {
    return redisEnabled && isConnected && redis !== null;
}

/**
 * Get the Redis client (may be null if not available)
 */
function getClient() {
    return redis;
}

/**
 * Gracefully close Redis connection
 */
async function closeConnection() {
    if (redis) {
        try {
            await redis.quit();
            console.log('[REDIS] Connection closed gracefully');
        } catch (err) {
            console.warn('[REDIS] Error closing connection:', err.message);
        }
    }
}

module.exports = {
    redis,
    isRedisAvailable,
    getClient,
    closeConnection
};
