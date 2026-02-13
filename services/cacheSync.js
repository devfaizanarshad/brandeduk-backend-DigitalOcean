/**
 * Cross-Instance Cache Synchronization
 * 
 * This module provides cache invalidation broadcasting across PM2 cluster instances.
 * When an admin makes changes, ALL instances are notified to invalidate their caches.
 * 
 * How it works:
 * 1. Admin makes a change (e.g., updates product price)
 * 2. The handling instance calls broadcastCacheInvalidation()
 * 3. PM2 IPC broadcasts the message to all instances
 * 4. Each instance invalidates its local cache
 * 5. Redis cache is also invalidated (if available)
 * 
 * This ensures:
 * - Immediate cache invalidation across all instances
 * - No stale data served to any user
 * - Works with both Redis and in-memory fallback
 */

const cache = require('./cacheService');
const { refreshMaterializedViews } = require('../utils/refreshViews');

// Debounce mechanism to prevent rapid consecutive invalidations
let invalidationDebounceTimer = null;
const DEBOUNCE_MS = 1000; // Wait 1 second to batch rapid changes

// Track recent invalidations to prevent duplicate processing
let lastInvalidationTimestamp = 0;
const MIN_INVALIDATION_INTERVAL = 500; // Minimum ms between invalidations

/**
 * Listen for cache invalidation messages from other PM2 instances
 */
function setupIPCListener() {
    process.on('message', async (packet) => {
        if (packet && packet.topic === 'cache:invalidate') {
            const now = Date.now();

            // Ignore if we just invalidated (prevents duplicate processing)
            if (now - lastInvalidationTimestamp < MIN_INVALIDATION_INTERVAL) {
                console.log('[CACHE SYNC] Ignoring duplicate invalidation signal');
                return;
            }

            console.log('[CACHE SYNC] Received invalidation signal from another instance');
            lastInvalidationTimestamp = now;

            // Invalidate centralized cache (Redis/memory)
            await cache.invalidateProductCache();

            // CRITICAL: Also clear productService's internal caches
            // These are separate in-memory Maps that also need to be cleared
            try {
                const productService = require('./productService');
                if (productService.clearCache) {
                    // clearCache is now async, but we don't await to avoid blocking
                    productService.clearCache().catch(err => {
                        console.warn('[CACHE SYNC] ProductService cache clear error:', err.message);
                    });
                }
            } catch (err) {
                console.warn('[CACHE SYNC] Could not clear productService cache:', err.message);
            }
        }
    });

    console.log('[CACHE SYNC] IPC listener initialized');
}

/**
 * Broadcast cache invalidation to all PM2 instances
 * Also invalidates Redis cache directly
 * 
 * @param {Object} options - Invalidation options
 * @param {boolean} options.refreshViews - Whether to also refresh materialized views
 * @param {string} options.reason - Reason for invalidation (for logging)
 */
async function broadcastCacheInvalidation(options = {}) {
    const { refreshViews = false, reason = 'admin_change' } = options;

    console.log(`[CACHE SYNC] Broadcasting invalidation (reason: ${reason})`);

    // Clear debounce if exists
    if (invalidationDebounceTimer) {
        clearTimeout(invalidationDebounceTimer);
    }

    // Invalidate local cache immediately
    lastInvalidationTimestamp = Date.now();

    // Clear centralized cache (Redis or cacheService memory)
    await cache.invalidateProductCache();

    // CRITICAL: Also clear productService's internal caches
    // ProductService maintains its own queryCache and aggregationCache Maps
    // These MUST be cleared for display_order changes to take effect
    try {
        const productService = require('./productService');
        if (productService.clearCache) {
            await productService.clearCache();
            console.log('[CACHE SYNC] ProductService caches cleared');
        }
    } catch (err) {
        console.warn('[CACHE SYNC] Could not clear productService cache:', err.message);
    }

    // Broadcast to other PM2 instances via IPC
    if (process.send) {
        try {
            process.send({
                type: 'process:msg',
                topic: 'cache:invalidate',
                data: {
                    timestamp: lastInvalidationTimestamp,
                    reason
                }
            });
            console.log('[CACHE SYNC] Broadcasted to PM2 cluster');
        } catch (err) {
            console.warn('[CACHE SYNC] PM2 broadcast failed:', err.message);
        }
    }

    // Optionally refresh materialized views
    if (refreshViews) {
        // Debounce MV refresh to avoid hammering the database
        invalidationDebounceTimer = setTimeout(async () => {
            console.log('[CACHE SYNC] Triggering materialized view refresh...');
            try {
                const result = await refreshMaterializedViews();
                if (result.success) {
                    console.log('[CACHE SYNC] Materialized views refreshed successfully');
                    // Invalidate cache again after MV refresh
                    await cache.invalidateProductCache();
                    // Also clear productService cache after MV refresh
                    try {
                        const productService = require('./productService');
                        if (productService.clearCache) {
                            await productService.clearCache();
                        }
                    } catch (e) { /* ignore */ }
                } else {
                    console.error('[CACHE SYNC] Materialized view refresh failed:', result.error);
                }
            } catch (err) {
                console.error('[CACHE SYNC] Materialized view refresh error:', err.message);
            }
        }, DEBOUNCE_MS);
    }
}

/**
 * Invalidate cache for a specific product
 * More targeted than full invalidation
 * 
 * @param {string} styleCode - Product style code
 */
async function invalidateProduct(styleCode) {
    console.log(`[CACHE SYNC] Invalidating cache for product: ${styleCode}`);

    try {
        // Delete specific product cache
        await cache.del(`product:${styleCode}`);
        await cache.del(`product:${styleCode.toUpperCase()}`);
        await cache.del(`product:${styleCode.toLowerCase()}`);

        // Also invalidate list caches since product may appear in lists
        // Using pattern deletion for related list caches
        await cache.delPattern('products:*');
        await cache.delPattern('aggregations:*');

        // Broadcast to other instances
        if (process.send) {
            process.send({
                type: 'process:msg',
                topic: 'cache:invalidate',
                data: {
                    timestamp: Date.now(),
                    reason: `product_update:${styleCode}`
                }
            });
        }
    } catch (err) {
        console.error('[CACHE SYNC] Product invalidation error:', err.message);
        // Fallback to full invalidation
        await broadcastCacheInvalidation({ reason: `product_update:${styleCode}` });
    }
}

/**
 * Invalidate cache for pricing changes
 * This includes price breaks and all product lists
 */
async function invalidatePricing() {
    console.log('[CACHE SYNC] Invalidating pricing caches');

    await cache.delPattern('pricebreaks:*');
    await cache.delPattern('products:*');

    // Broadcast to other instances
    await broadcastCacheInvalidation({ reason: 'pricing_change' });
}

// Initialize IPC listener when module is loaded
setupIPCListener();

module.exports = {
    broadcastCacheInvalidation,
    invalidateProduct,
    invalidatePricing,
    setupIPCListener
};
