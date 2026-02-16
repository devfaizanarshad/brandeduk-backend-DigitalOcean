const fs = require('fs');
const path = require('path');
const { queryWithTimeout, pool } = require('../config/database');

/**
 * Maintenance script to apply the Brand Visibility Fix and refresh Materialized Views.
 * This version uses a more aggressive cleanup to avoid "duplicate key" catalog errors.
 */
async function runMaintenance() {
    console.log('🚀 Starting Robust Brand Visibility Maintenance...');
    const startTime = Date.now();

    try {
        // 1. Force cleanup first
        console.log('🧹 Force dropping existing views...');
        try {
            await queryWithTimeout('DROP MATERIALIZED VIEW IF EXISTS public.product_search_materialized CASCADE', [], 60000);
            await queryWithTimeout('DROP MATERIALIZED VIEW IF EXISTS public.product_search_mv CASCADE', [], 60000);
            // Small pause for PG catalog to update
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.warn('   ⚠️ Cleanup warning:', e.message);
        }

        // 2. Read the updated SQL definition
        const sqlPath = path.join(__dirname, 'FIX_MISSING_FILTERS.sql');
        console.log('📄 Reading SQL definition...');
        let sql = fs.readFileSync(sqlPath, 'utf8');

        // 3. Extract the CREATE MATERIALIZED VIEW statement for product_search_mv
        // We will run this WITHOUT "IF NOT EXISTS" to be explicit
        const psmvMatch = sql.match(/CREATE MATERIALIZED VIEW IF NOT EXISTS public\.product_search_mv[\s\S]+?WITH DATA;/i);
        if (!psmvMatch) throw new Error('Could not find product_search_mv definition in SQL file');

        const psmvSql = psmvMatch[0].replace(/IF NOT EXISTS /i, '');

        console.log('🔨 Creating product_search_mv (this takes 3-5 minutes)...');
        await queryWithTimeout(psmvSql, [], 600000);

        // 4. Create product_search_materialized from it
        console.log('🔨 Creating product_search_materialized...');
        const psmMatch = sql.match(/CREATE MATERIALIZED VIEW IF NOT EXISTS public\.product_search_materialized[\s\S]+?WITH DATA;/i);
        if (psmMatch) {
            const psmSql = psmMatch[0].replace(/IF NOT EXISTS /i, '');
            await queryWithTimeout(psmSql, [], 600000);
        }

        // 5. Re-run all the CREATE INDEX statements
        console.log('🔨 Recreating indexes...');
        const indexMatches = sql.matchAll(/CREATE (?:UNIQUE )?INDEX[\s\S]+?;/gi);
        let indexCount = 0;
        for (const match of indexMatches) {
            try {
                await queryWithTimeout(match[0], [], 60000);
                indexCount++;
            } catch (e) {
                if (!e.message.includes('already exists')) {
                    console.warn(`   ⚠️ Index warning: ${e.message}`);
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Success! Brand visibility logic applied. Created ${indexCount} indexes in ${duration}s`);

    } catch (error) {
        console.error('❌ Maintenance Failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMaintenance();
