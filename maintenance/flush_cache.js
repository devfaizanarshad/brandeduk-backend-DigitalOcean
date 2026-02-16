const { invalidateProductCache } = require('../services/cacheService');

async function flush() {
    console.log('Starting cache invalidation...');
    await invalidateProductCache();
    console.log('Cache invalidation complete.');
    process.exit(0);
}

flush().catch(err => {
    console.error('Failed to invalidate cache:', err);
    process.exit(1);
});
