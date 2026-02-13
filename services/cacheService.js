/**
 * Unified Cache Service
 * 
 * Provides a unified caching interface that:
 * 1. Uses Redis when available (production/staging with Redis installed)
 * 2. Falls back to in-memory Map when Redis is unavailable (local development)
 * 
 * This ensures the application works seamlessly in both environments
 * without any code changes.
 * 
 * Cache Key Prefixes:
 * - products:* - Product list cache
 * - product:* - Individual product cache
 * - aggregations:* - Filter aggregation cache
 * - count:* - Total count cache
 * - pricebreaks:* - Price breaks cache
 */

const { redis, isRedisAvailable } = require('../config/redis');

// In-memory fallback cache
const memoryCache = new Map();

// Cache configuration
const CACHE_CONFIG = {
    // Default TTL in seconds
    // Admin pricing sync and cache invalidation endpoints handle clearing stale data
    DEFAULT_TTL: 300,          // 5 minutes
    PRODUCTS_TTL: 300,         // 5 minutes for product lists
    PRODUCT_DETAIL_TTL: 600,   // 10 minutes for product details (change less often)
    AGGREGATIONS_TTL: 300,     // 5 minutes for filter aggregations
    COUNT_TTL: 600,            // 10 minutes for counts (expensive to compute)
    PRICE_BREAKS_TTL: 600,     // 10 minutes for price breaks (less volatile)

    // Memory cache limits
    MAX_MEMORY_ENTRIES: 1000,

    // Stats
    stats: {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        errors: 0
    }
};

/**
 * Get cached value
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Cached value or null if not found
 */
async function get(key) {
    try {
        if (isRedisAvailable()) {
            const data = await redis.get(key);
            if (data) {
                CACHE_CONFIG.stats.hits++;
                return JSON.parse(data);
            }
            CACHE_CONFIG.stats.misses++;
            return null;
        }

        // Fallback to memory cache
        const cached = memoryCache.get(key);
        if (cached && Date.now() < cached.expires) {
            CACHE_CONFIG.stats.hits++;
            return cached.data;
        }

        // Clean up expired entry
        if (cached) {
            memoryCache.delete(key);
        }

        CACHE_CONFIG.stats.misses++;
        return null;
    } catch (err) {
        CACHE_CONFIG.stats.errors++;
        console.error('[CACHE] Get error:', err.message);
        return null;
    }
}

/**
 * Set cached value with TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to cache (will be JSON serialized)
 * @param {number} ttlSeconds - Time to live in seconds
 */
async function set(key, data, ttlSeconds = CACHE_CONFIG.DEFAULT_TTL) {
    try {
        CACHE_CONFIG.stats.sets++;

        if (isRedisAvailable()) {
            await redis.setex(key, ttlSeconds, JSON.stringify(data));
            return;
        }

        // Fallback to memory cache
        // Enforce size limit
        if (memoryCache.size >= CACHE_CONFIG.MAX_MEMORY_ENTRIES) {
            // Remove oldest entry (first key)
            const firstKey = memoryCache.keys().next().value;
            memoryCache.delete(firstKey);
        }

        memoryCache.set(key, {
            data,
            expires: Date.now() + (ttlSeconds * 1000)
        });
    } catch (err) {
        CACHE_CONFIG.stats.errors++;
        console.error('[CACHE] Set error:', err.message);
    }
}

/**
 * Delete specific cache key
 * @param {string} key - Cache key to delete
 */
async function del(key) {
    try {
        CACHE_CONFIG.stats.deletes++;

        if (isRedisAvailable()) {
            await redis.del(key);
            return;
        }

        memoryCache.delete(key);
    } catch (err) {
        CACHE_CONFIG.stats.errors++;
        console.error('[CACHE] Del error:', err.message);
    }
}

/**
 * Delete all keys matching a pattern
 * Uses SCAN for Redis (non-blocking) or filter for memory cache
 * @param {string} pattern - Pattern to match (e.g., "products:*")
 */
async function delPattern(pattern) {
    try {
        if (isRedisAvailable()) {
            // Use SCAN to find matching keys (non-blocking)
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;

                if (keys.length > 0) {
                    await redis.del(...keys);
                    CACHE_CONFIG.stats.deletes += keys.length;
                }
            } while (cursor !== '0');
            return;
        }

        // Fallback: filter memory cache
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        for (const key of memoryCache.keys()) {
            if (regex.test(key)) {
                memoryCache.delete(key);
                CACHE_CONFIG.stats.deletes++;
            }
        }
    } catch (err) {
        CACHE_CONFIG.stats.errors++;
        console.error('[CACHE] DelPattern error:', err.message);
    }
}

/**
 * Invalidate all product-related caches
 * Called after admin changes to ensure data freshness
 */
async function invalidateProductCache() {
    console.log('[CACHE] Invalidating all product caches...');
    const startTime = Date.now();

    try {
        if (isRedisAvailable()) {
            // Use Redis pipeline for efficiency
            const patterns = ['products:*', 'product:*', 'aggregations:*', 'count:*', 'pricebreaks:*'];

            for (const pattern of patterns) {
                await delPattern(pattern);
            }

            console.log(`[CACHE] Redis cache invalidated in ${Date.now() - startTime}ms`);
        } else {
            // Clear entire memory cache
            const size = memoryCache.size;
            memoryCache.clear();
            console.log(`[CACHE] Memory cache cleared (${size} entries) in ${Date.now() - startTime}ms`);
        }
    } catch (err) {
        CACHE_CONFIG.stats.errors++;
        console.error('[CACHE] Invalidation error:', err.message);

        // Fallback: clear memory cache anyway
        memoryCache.clear();
    }
}

/**
 * Clear all caches (both Redis and memory)
 */
async function clearAll() {
    try {
        if (isRedisAvailable()) {
            await redis.flushdb();
        }
        memoryCache.clear();
        console.log('[CACHE] All caches cleared');
    } catch (err) {
        console.error('[CACHE] ClearAll error:', err.message);
        memoryCache.clear();
    }
}

/**
 * Get cache health and statistics
 */
async function getHealth() {
    const health = {
        backend: isRedisAvailable() ? 'redis' : 'memory',
        healthy: true,
        stats: { ...CACHE_CONFIG.stats },
        memoryEntries: memoryCache.size
    };

    if (isRedisAvailable()) {
        try {
            const info = await redis.info('memory');
            const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
            health.redisMemory = usedMemoryMatch ? usedMemoryMatch[1] : 'unknown';

            const keyCount = await redis.dbsize();
            health.redisKeys = keyCount;
        } catch (err) {
            health.healthy = false;
            health.error = err.message;
        }
    }

    // Calculate hit rate
    const totalRequests = health.stats.hits + health.stats.misses;
    health.hitRate = totalRequests > 0
        ? ((health.stats.hits / totalRequests) * 100).toFixed(2) + '%'
        : 'N/A';

    return health;
}

/**
 * Reset statistics
 */
function resetStats() {
    CACHE_CONFIG.stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        errors: 0
    };
}

// Export cache configuration for TTL values
module.exports = {
    get,
    set,
    del,
    delPattern,
    invalidateProductCache,
    clearAll,
    getHealth,
    resetStats,

    // TTL constants for use by other modules
    TTL: {
        PRODUCTS: CACHE_CONFIG.PRODUCTS_TTL,
        PRODUCT_DETAIL: CACHE_CONFIG.PRODUCT_DETAIL_TTL,
        AGGREGATIONS: CACHE_CONFIG.AGGREGATIONS_TTL,
        COUNT: CACHE_CONFIG.COUNT_TTL,
        PRICE_BREAKS: CACHE_CONFIG.PRICE_BREAKS_TTL
    }
};
