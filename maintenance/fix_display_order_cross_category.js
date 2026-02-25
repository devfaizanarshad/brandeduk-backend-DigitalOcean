/**
 * Fix Cross-Category Display Order Entries
 * 
 * This script:
 * 1. Finds all display_order entries where the style_code's actual product_type
 *    doesn't match the product_type_id stored in the display_order entry
 * 2. Reports these invalid cross-category entries
 * 3. Optionally deletes them (pass --fix flag)
 * 
 * Usage:
 *   node maintenance/fix_display_order_cross_category.js          # Audit only
 *   node maintenance/fix_display_order_cross_category.js --fix    # Audit + Fix
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'brandeduk_prod',
    user: process.env.DB_USER || 'brandeduk',
    password: process.env.DB_PASSWORD || 'omglol123',
    ssl: process.env.DB_HOST !== 'localhost' ? { rejectUnauthorized: false } : false
});

const FIX_MODE = process.argv.includes('--fix');

async function run() {
    const client = await pool.connect();
    try {
        console.log('='.repeat(70));
        console.log('  PRODUCT DISPLAY ORDER - CROSS-CATEGORY AUDIT');
        console.log('  Mode:', FIX_MODE ? '🔧 FIX (will delete invalid entries)' : '🔍 AUDIT ONLY');
        console.log('='.repeat(70));
        console.log('');

        // =========================================================================
        // 1. Find cross-category entries (style assigned to wrong product_type)
        // =========================================================================
        console.log('--- 1. CROSS-CATEGORY ENTRIES ---');
        console.log('Finding entries where product_type_id does NOT match the style\'s actual product_type...\n');

        const crossCategoryResult = await client.query(`
      SELECT 
        pdo.id,
        pdo.style_code,
        pdo.product_type_id AS assigned_type_id,
        pt_assigned.name AS assigned_type_name,
        s.product_type_id AS actual_type_id,
        pt_actual.name AS actual_type_name,
        pdo.display_order,
        pdo.brand_id,
        b.name AS brand_name
      FROM product_display_order pdo
      INNER JOIN styles s ON pdo.style_code = s.style_code
      LEFT JOIN product_types pt_assigned ON pdo.product_type_id = pt_assigned.id
      LEFT JOIN product_types pt_actual ON s.product_type_id = pt_actual.id
      LEFT JOIN brands b ON pdo.brand_id = b.id
      WHERE pdo.product_type_id IS NOT NULL
        AND s.product_type_id IS NOT NULL
        AND pdo.product_type_id != s.product_type_id
      ORDER BY pt_assigned.name, pdo.display_order
    `);

        if (crossCategoryResult.rows.length === 0) {
            console.log('✅ No cross-category entries found! All entries are correctly assigned.\n');
        } else {
            console.log(`⚠️  Found ${crossCategoryResult.rows.length} CROSS-CATEGORY entries:\n`);
            console.log('  ID  | Style  | Assigned To        | Actually Belongs To | Order | Brand');
            console.log('  ' + '-'.repeat(85));
            for (const row of crossCategoryResult.rows) {
                console.log(`  ${String(row.id).padEnd(4)}| ${row.style_code.padEnd(7)}| ${(row.assigned_type_name || 'NULL').padEnd(19)}| ${(row.actual_type_name || 'NULL').padEnd(20)}| ${String(row.display_order).padEnd(6)}| ${row.brand_name || 'NULL'}`);
            }
            console.log('');

            if (FIX_MODE) {
                const ids = crossCategoryResult.rows.map(r => r.id);
                const deleteResult = await client.query(
                    `DELETE FROM product_display_order WHERE id = ANY($1) RETURNING id, style_code`,
                    [ids]
                );
                console.log(`🔧 DELETED ${deleteResult.rows.length} cross-category entries.\n`);
            } else {
                console.log('  ℹ️  Run with --fix flag to delete these entries.\n');
            }
        }

        // =========================================================================
        // 2. Find entries where style_code has brand_id that doesn't match
        // =========================================================================
        console.log('--- 2. CROSS-BRAND ENTRIES ---');
        console.log('Finding entries where brand_id does NOT match the style\'s actual brand...\n');

        const crossBrandResult = await client.query(`
      SELECT 
        pdo.id,
        pdo.style_code,
        pdo.brand_id AS assigned_brand_id,
        b_assigned.name AS assigned_brand_name,
        s.brand_id AS actual_brand_id,
        b_actual.name AS actual_brand_name,
        pdo.display_order,
        pdo.product_type_id,
        pt.name AS product_type_name
      FROM product_display_order pdo
      INNER JOIN styles s ON pdo.style_code = s.style_code
      LEFT JOIN brands b_assigned ON pdo.brand_id = b_assigned.id
      LEFT JOIN brands b_actual ON s.brand_id = b_actual.id
      LEFT JOIN product_types pt ON pdo.product_type_id = pt.id
      WHERE pdo.brand_id IS NOT NULL
        AND s.brand_id IS NOT NULL
        AND pdo.brand_id != s.brand_id
      ORDER BY b_assigned.name, pdo.display_order
    `);

        if (crossBrandResult.rows.length === 0) {
            console.log('✅ No cross-brand entries found! All brand assignments are correct.\n');
        } else {
            console.log(`⚠️  Found ${crossBrandResult.rows.length} CROSS-BRAND entries:\n`);
            console.log('  ID  | Style  | Assigned Brand     | Actually Brand       | Order | Type');
            console.log('  ' + '-'.repeat(85));
            for (const row of crossBrandResult.rows) {
                console.log(`  ${String(row.id).padEnd(4)}| ${row.style_code.padEnd(7)}| ${(row.assigned_brand_name || 'NULL').padEnd(19)}| ${(row.actual_brand_name || 'NULL').padEnd(21)}| ${String(row.display_order).padEnd(6)}| ${row.product_type_name || 'NULL'}`);
            }
            console.log('');

            if (FIX_MODE) {
                const ids = crossBrandResult.rows.map(r => r.id);
                const deleteResult = await client.query(
                    `DELETE FROM product_display_order WHERE id = ANY($1) RETURNING id, style_code`,
                    [ids]
                );
                console.log(`🔧 DELETED ${deleteResult.rows.length} cross-brand entries.\n`);
            } else {
                console.log('  ℹ️  Run with --fix flag to delete these entries.\n');
            }
        }

        // =========================================================================
        // 3. Find orphaned entries (style_code no longer exists in styles table)
        // =========================================================================
        console.log('--- 3. ORPHANED ENTRIES ---');
        console.log('Finding entries where style_code no longer exists in styles table...\n');

        const orphanedResult = await client.query(`
      SELECT 
        pdo.id,
        pdo.style_code,
        pdo.product_type_id,
        pt.name AS product_type_name,
        pdo.brand_id,
        b.name AS brand_name,
        pdo.display_order
      FROM product_display_order pdo
      LEFT JOIN styles s ON pdo.style_code = s.style_code
      LEFT JOIN product_types pt ON pdo.product_type_id = pt.id
      LEFT JOIN brands b ON pdo.brand_id = b.id
      WHERE s.style_code IS NULL
      ORDER BY pdo.style_code
    `);

        if (orphanedResult.rows.length === 0) {
            console.log('✅ No orphaned entries found! All style_codes exist.\n');
        } else {
            console.log(`⚠️  Found ${orphanedResult.rows.length} ORPHANED entries:\n`);
            for (const row of orphanedResult.rows) {
                console.log(`  ID=${row.id} | ${row.style_code} | Type: ${row.product_type_name || 'NULL'} | Brand: ${row.brand_name || 'NULL'} | Order: ${row.display_order}`);
            }
            console.log('');

            if (FIX_MODE) {
                const ids = orphanedResult.rows.map(r => r.id);
                const deleteResult = await client.query(
                    `DELETE FROM product_display_order WHERE id = ANY($1) RETURNING id, style_code`,
                    [ids]
                );
                console.log(`🔧 DELETED ${deleteResult.rows.length} orphaned entries.\n`);
            }
        }

        // =========================================================================
        // 4. Find entries for products that are no longer 'Live'
        // =========================================================================
        console.log('--- 4. NON-LIVE PRODUCT ENTRIES ---');
        console.log('Finding entries for products that have NO live SKUs...\n');

        const nonLiveResult = await client.query(`
      SELECT 
        pdo.id,
        pdo.style_code,
        pdo.product_type_id,
        pt.name AS product_type_name,
        pdo.brand_id,
        b.name AS brand_name,
        pdo.display_order,
        COUNT(CASE WHEN p.sku_status = 'Live' THEN 1 END) AS live_count,
        COUNT(p.id) AS total_count
      FROM product_display_order pdo
      INNER JOIN styles s ON pdo.style_code = s.style_code
      LEFT JOIN products p ON s.style_code = p.style_code
      LEFT JOIN product_types pt ON pdo.product_type_id = pt.id
      LEFT JOIN brands b ON pdo.brand_id = b.id
      GROUP BY pdo.id, pdo.style_code, pdo.product_type_id, pt.name, pdo.brand_id, b.name, pdo.display_order
      HAVING COUNT(CASE WHEN p.sku_status = 'Live' THEN 1 END) = 0
      ORDER BY pdo.style_code
    `);

        if (nonLiveResult.rows.length === 0) {
            console.log('✅ No entries for non-live products found!\n');
        } else {
            console.log(`⚠️  Found ${nonLiveResult.rows.length} entries for NON-LIVE products:\n`);
            for (const row of nonLiveResult.rows) {
                console.log(`  ID=${row.id} | ${row.style_code} | Type: ${row.product_type_name || 'NULL'} | Brand: ${row.brand_name || 'NULL'} | Order: ${row.display_order} | Live: ${row.live_count}/${row.total_count}`);
            }
            console.log('');

            if (FIX_MODE) {
                const ids = nonLiveResult.rows.map(r => r.id);
                const deleteResult = await client.query(
                    `DELETE FROM product_display_order WHERE id = ANY($1) RETURNING id, style_code`,
                    [ids]
                );
                console.log(`🔧 DELETED ${deleteResult.rows.length} non-live entries.\n`);
            }
        }

        // =========================================================================
        // 5. Find duplicate/NULL display_order entries
        // =========================================================================
        console.log('--- 5. NULL OR DUPLICATE DISPLAY ORDER VALUES ---');

        const nullOrderResult = await client.query(`
      SELECT id, style_code, product_type_id, brand_id, display_order
      FROM product_display_order
      WHERE display_order IS NULL
      ORDER BY style_code
    `);

        if (nullOrderResult.rows.length === 0) {
            console.log('✅ No NULL display_order values found!\n');
        } else {
            console.log(`⚠️  Found ${nullOrderResult.rows.length} entries with NULL display_order:\n`);
            for (const row of nullOrderResult.rows) {
                console.log(`  ID=${row.id} | ${row.style_code} | TypeID: ${row.product_type_id} | BrandID: ${row.brand_id}`);
            }
            console.log('');

            if (FIX_MODE) {
                const ids = nullOrderResult.rows.map(r => r.id);
                const deleteResult = await client.query(
                    `DELETE FROM product_display_order WHERE id = ANY($1) RETURNING id, style_code`,
                    [ids]
                );
                console.log(`🔧 DELETED ${deleteResult.rows.length} NULL display_order entries.\n`);
            }
        }

        // =========================================================================
        // 6. Summary: Valid display orders per product type
        // =========================================================================
        console.log('--- 6. VALID DISPLAY ORDERS SUMMARY (after cleanup) ---\n');

        const summaryResult = await client.query(`
      SELECT 
        pt.name AS product_type,
        COUNT(pdo.id) AS display_order_count,
        STRING_AGG(DISTINCT pdo.style_code, ', ' ORDER BY pdo.style_code) AS style_codes
      FROM product_display_order pdo
      INNER JOIN styles s ON pdo.style_code = s.style_code
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      LEFT JOIN product_types pt ON pdo.product_type_id = pt.id
      WHERE pdo.product_type_id IS NOT NULL
        AND pdo.product_type_id = s.product_type_id
        AND pdo.display_order IS NOT NULL
      GROUP BY pt.name
      ORDER BY display_order_count DESC
    `);

        console.log('  Product Type          | Valid Orders | Style Codes');
        console.log('  ' + '-'.repeat(80));
        for (const row of summaryResult.rows) {
            const codes = row.style_codes.length > 60 ? row.style_codes.substring(0, 57) + '...' : row.style_codes;
            console.log(`  ${(row.product_type || 'NULL').padEnd(23)}| ${String(row.display_order_count).padEnd(13)}| ${codes}`);
        }

        // =========================================================================
        // 7. Total count comparison
        // =========================================================================
        console.log('\n--- 7. TOTAL ENTRIES BREAKDOWN ---\n');

        const totalResult = await client.query(`SELECT COUNT(*) as total FROM product_display_order`);
        const validResult = await client.query(`
      SELECT COUNT(*) as total FROM product_display_order pdo
      INNER JOIN styles s ON pdo.style_code = s.style_code
      WHERE (pdo.product_type_id IS NULL OR pdo.product_type_id = s.product_type_id)
        AND (pdo.brand_id IS NULL OR pdo.brand_id = s.brand_id)
        AND pdo.display_order IS NOT NULL
    `);

        console.log(`  Total entries in product_display_order: ${totalResult.rows[0].total}`);
        console.log(`  Valid entries (correct category+brand):  ${validResult.rows[0].total}`);
        console.log(`  Invalid/orphaned entries:                ${totalResult.rows[0].total - validResult.rows[0].total}`);

        console.log('\n' + '='.repeat(70));
        console.log('  AUDIT COMPLETE');
        if (!FIX_MODE) {
            console.log('  To fix all issues, run: node maintenance/fix_display_order_cross_category.js --fix');
        }
        console.log('='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
