const { queryWithTimeout } = require('../config/database');

/**
 * Refreshes the product search materialized views.
 * Tries CONCURRENTLY first, falls back to standard refresh if that fails.
 * Checks both product_search_mv and product_search_materialized.
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function refreshMaterializedViews() {
    let success = true;
    let errors = [];

    const views = ['product_search_mv', 'product_search_materialized'];

    for (const view of views) {
        try {
            console.log(`[REFRESH] Attempting CONCURRENT refresh for ${view}...`);
            await queryWithTimeout(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`, [], 600000); // 10 mins max
            console.log(`[REFRESH] CONCURRENT refresh successful for ${view}`);
        } catch (err) {
            console.warn(`[REFRESH] CONCURRENT refresh failed for ${view}: ${err.message}. Retrying with standard refresh...`);
            try {
                await queryWithTimeout(`REFRESH MATERIALIZED VIEW ${view}`, [], 600000);
                console.log(`[REFRESH] Standard refresh successful for ${view}`);
            } catch (err2) {
                console.error(`[REFRESH] Standard refresh failed for ${view}: ${err2.message}`);
                errors.push(`${view}: ${err2.message}`);
                success = false;
            }
        }
    }

    return {
        success,
        error: errors.length > 0 ? errors.join('; ') : null
    };
}

module.exports = { refreshMaterializedViews };
