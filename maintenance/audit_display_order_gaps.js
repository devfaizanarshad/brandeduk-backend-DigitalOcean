/**
 * Audit Display Order Gaps & Missing Remaps
 * 
 * This script:
 * 1. Shows all display orders per product type with their actual order numbers
 * 2. Identifies gaps in sequential ordering (1,2,4,7 instead of 1,2,3,4)
 * 3. Shows which products were deleted that should have been remapped
 * 4. Optionally fixes gaps by re-sequencing (--fix flag)
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
        console.log('='.repeat(80));
        console.log('  DISPLAY ORDER - GAP AUDIT & RE-SEQUENCING');
        console.log('  Mode:', FIX_MODE ? '🔧 FIX (will re-sequence gaps)' : '🔍 AUDIT ONLY');
        console.log('='.repeat(80));
        console.log('');

        // ====================================================================
        // 1. Get all display orders grouped by product_type, show order numbers
        // ====================================================================
        const allOrders = await client.query(`
            SELECT 
                pdo.id,
                pdo.style_code,
                pdo.display_order,
                pdo.product_type_id,
                pt.name AS product_type_name,
                pdo.brand_id,
                b.name AS brand_name,
                s.style_name
            FROM product_display_order pdo
            INNER JOIN styles s ON pdo.style_code = s.style_code
            LEFT JOIN product_types pt ON pdo.product_type_id = pt.id
            LEFT JOIN brands b ON pdo.brand_id = b.id
            WHERE pdo.display_order IS NOT NULL
            ORDER BY pt.name, pdo.display_order ASC
        `);

        // Group by product type
        const byType = {};
        for (const row of allOrders.rows) {
            const key = row.product_type_name || `brand_${row.brand_id}`;
            if (!byType[key]) {
                byType[key] = { product_type_id: row.product_type_id, brand_id: row.brand_id, entries: [] };
            }
            byType[key].entries.push(row);
        }

        let totalGaps = 0;
        let totalFixable = 0;
        const fixCommands = []; // SQL commands to resequence

        for (const [typeName, data] of Object.entries(byType).sort((a, b) => a[0].localeCompare(b[0]))) {
            const entries = data.entries;
            const orders = entries.map(e => e.display_order);

            // Check for gaps
            const gaps = [];
            for (let i = 0; i < orders.length; i++) {
                const expected = i + 1;
                if (orders[i] !== expected) {
                    gaps.push({ position: i, expected, actual: orders[i] });
                }
            }

            // Check for duplicates
            const duplicates = [];
            for (let i = 1; i < orders.length; i++) {
                if (orders[i] === orders[i - 1]) {
                    duplicates.push({ position: i, value: orders[i] });
                }
            }

            const hasIssues = gaps.length > 0 || duplicates.length > 0;

            if (hasIssues) {
                console.log(`\n📋 ${typeName} (${entries.length} entries) ${gaps.length > 0 ? '⚠️ HAS GAPS' : ''} ${duplicates.length > 0 ? '🔴 HAS DUPLICATES' : ''}`);
                console.log('  Pos | Order | Style  | Product Name');
                console.log('  ' + '-'.repeat(70));

                for (let i = 0; i < entries.length; i++) {
                    const e = entries[i];
                    const expected = i + 1;
                    const marker = e.display_order !== expected ? ` ← should be ${expected}` : '';
                    const dupMarker = duplicates.some(d => d.position === i) ? ' 🔴 DUPLICATE' : '';
                    const name = (e.style_name || '').substring(0, 35);
                    console.log(`  ${String(i + 1).padEnd(4)}| ${String(e.display_order).padEnd(6)}| ${e.style_code.padEnd(7)}| ${name}${marker}${dupMarker}`);
                }

                totalGaps += gaps.length;

                // Build fix commands
                if (gaps.length > 0) {
                    totalFixable += gaps.length;
                    for (let i = 0; i < entries.length; i++) {
                        const expected = i + 1;
                        if (entries[i].display_order !== expected) {
                            fixCommands.push({
                                id: entries[i].id,
                                style_code: entries[i].style_code,
                                typeName,
                                oldOrder: entries[i].display_order,
                                newOrder: expected
                            });
                        }
                    }
                }
            } else {
                console.log(`\n✅ ${typeName} (${entries.length} entries) — Sequential: 1-${entries.length}, no gaps`);
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log(`\n📊 SUMMARY:`);
        console.log(`  Total product types with display orders: ${Object.keys(byType).length}`);
        console.log(`  Total entries: ${allOrders.rows.length}`);
        console.log(`  Total gaps found: ${totalGaps}`);
        console.log(`  Total entries that need re-sequencing: ${totalFixable}`);

        // ====================================================================
        // 2. Show the products that were deleted (cross-category) and whether
        //    they already have a correct-category entry
        // ====================================================================
        console.log('\n' + '='.repeat(80));
        console.log('\n📋 PREVIOUSLY DELETED CROSS-CATEGORY PRODUCTS - DO THEY NEED REMAPPING?');
        console.log('  (Checking if these products already have a display order in their correct category)\n');

        // These are the style codes that were deleted
        const deletedStyles = [
            // Caps -> Beanies
            'R369X', 'R159X', 'RC930',
            // Caps -> other
            'YK046', 'TJ018', 'GD057',
            // Fleece -> Gilets
            'PR803', '8720M', 'KB913', 'PR804', 'RE44A',
            // Fleece -> Snoods
            'B280R',
            // Fleece -> Sweatshirts/Hoodies
            'GD066', 'GD067',
            // Hats -> Beanies
            'RC060',
            // Hoodies -> Aprons
            'PR190', 'PR191', 'PR113', 'PR181', 'PR110',
            // Jackets -> Softshells/Fleece/etc
            'SN130', 'RG073', 'RG134', 'RE95A', 'R121A', 'SN131', 'R231M', 'RG147', 'RG150', 'R128X', 'J140M', 'R907X', 'RG352', 'J040M', 'PR664',
            // Shirts -> Blouses
            'KK702', 'KK360',
            // Sweatshirts -> Hoodies
            'J575M', 'GD57B', 'J266M',
            // Bags -> Keyrings
            'BG100'
        ];

        const remapCheck = await client.query(`
            SELECT 
                s.style_code,
                s.style_name,
                s.product_type_id AS actual_type_id,
                pt.name AS actual_type_name,
                pdo.id AS existing_pdo_id,
                pdo.display_order AS existing_display_order,
                pdo.product_type_id AS existing_pdo_type_id
            FROM styles s
            LEFT JOIN product_types pt ON s.product_type_id = pt.id
            LEFT JOIN product_display_order pdo ON s.style_code = pdo.style_code 
                AND pdo.product_type_id = s.product_type_id
            WHERE s.style_code = ANY($1)
            ORDER BY pt.name, s.style_code
        `, [deletedStyles]);

        const needsRemap = [];
        const alreadyHasOrder = [];

        for (const row of remapCheck.rows) {
            if (row.existing_pdo_id) {
                alreadyHasOrder.push(row);
            } else {
                needsRemap.push(row);
            }
        }

        if (alreadyHasOrder.length > 0) {
            console.log(`  ✅ ${alreadyHasOrder.length} products ALREADY have display order in their correct category:`);
            for (const r of alreadyHasOrder) {
                console.log(`     ${r.style_code} → ${r.actual_type_name} (order: ${r.existing_display_order})`);
            }
            console.log('');
        }

        if (needsRemap.length > 0) {
            console.log(`  ⚠️  ${needsRemap.length} products have NO display order in their correct category:`);
            for (const r of needsRemap) {
                console.log(`     ${r.style_code} (${r.style_name?.substring(0, 40)}) → should be in: ${r.actual_type_name}`);
            }
            console.log('');
        } else {
            console.log(`  ✅ All previously deleted products either already have correct-category entries or don't need remapping.\n`);
        }

        // ====================================================================
        // 3. Apply fixes if --fix flag is set
        // ====================================================================
        if (FIX_MODE && fixCommands.length > 0) {
            console.log('\n' + '='.repeat(80));
            console.log('\n🔧 RE-SEQUENCING GAPS...\n');

            await client.query('BEGIN');

            for (const fix of fixCommands) {
                await client.query(
                    `UPDATE product_display_order SET display_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                    [fix.newOrder, fix.id]
                );
                console.log(`  ${fix.typeName}: ${fix.style_code} order ${fix.oldOrder} → ${fix.newOrder}`);
            }

            await client.query('COMMIT');
            console.log(`\n✅ Re-sequenced ${fixCommands.length} entries.`);
        } else if (FIX_MODE && fixCommands.length === 0) {
            console.log('\n✅ No gaps to fix!');
        }

        console.log('\n' + '='.repeat(80));
        if (!FIX_MODE && (fixCommands.length > 0 || needsRemap.length > 0)) {
            console.log('  To fix gaps, run: node maintenance/audit_display_order_gaps.js --fix');
        }
        console.log('='.repeat(80));

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
