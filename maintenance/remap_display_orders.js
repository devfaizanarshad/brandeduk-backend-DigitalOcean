/**
 * Remap Deleted Products to Their Correct Category
 * 
 * These products were deleted because they were in the wrong category.
 * This script adds them to their CORRECT category at the end of the existing list.
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

async function run() {
    const client = await pool.connect();
    try {
        console.log('='.repeat(80));
        console.log('  REMAPPING DELETED PRODUCTS TO CORRECT CATEGORIES');
        console.log('='.repeat(80));
        console.log('');

        // Products that need remapping to their correct category
        const stylesToRemap = [
            'R159X', 'R369X', 'RC060',           // → Beanies
            'KK360', 'KK702',                     // → Blouses
            'PR664',                               // → Chef Jackets
            'R907X', 'RG134', 'RG352',            // → Fleece
            '8720M', 'KB913', 'PR803', 'PR804', 'RE44A', // → Gilets & Body Warmers
            'GD57B', 'J266M', 'J575M',            // → Hoodies
            'YK046',                               // → Jackets
            'BG100',                               // → Keyrings
            'RE95A',                               // → Rain Suits
            'B280R',                               // → Snoods
            'J040M', 'J140M', 'R121A', 'R128X', 'R231M', 'RG073', 'RG147', 'RG150', 'SN130', 'SN131', // → Softshells
            'GD066', 'TJ018'                       // → Sweatshirts
        ];

        // Get each product's ACTUAL product_type_id
        const styleInfo = await client.query(`
            SELECT style_code, product_type_id, brand_id, style_name
            FROM styles 
            WHERE style_code = ANY($1)
        `, [stylesToRemap]);

        // Group by product_type_id
        const byType = {};
        for (const row of styleInfo.rows) {
            if (!byType[row.product_type_id]) {
                byType[row.product_type_id] = [];
            }
            byType[row.product_type_id].push(row);
        }

        await client.query('BEGIN');

        let totalInserted = 0;

        for (const [typeId, styles] of Object.entries(byType)) {
            // Get the current max display_order for this product type
            const maxResult = await client.query(`
                SELECT COALESCE(MAX(display_order), 0) as max_order
                FROM product_display_order
                WHERE product_type_id = $1
            `, [parseInt(typeId)]);

            let nextOrder = parseInt(maxResult.rows[0].max_order) + 1;

            // Get the product type name for logging
            const typeNameResult = await client.query(`SELECT name FROM product_types WHERE id = $1`, [parseInt(typeId)]);
            const typeName = typeNameResult.rows[0]?.name || `Type ${typeId}`;

            console.log(`\n📦 ${typeName} (type_id: ${typeId}) — Starting from order ${nextOrder}:`);

            for (const style of styles) {
                // Check if already exists in correct category
                const existCheck = await client.query(`
                    SELECT id FROM product_display_order 
                    WHERE style_code = $1 AND product_type_id = $2
                `, [style.style_code, parseInt(typeId)]);

                if (existCheck.rows.length > 0) {
                    console.log(`  ⏭️  ${style.style_code} (${style.style_name?.substring(0, 40)}) — already exists, skipping`);
                    continue;
                }

                await client.query(`
                    INSERT INTO product_display_order (style_code, brand_id, product_type_id, display_order, updated_at)
                    VALUES ($1, NULL, $2, $3, CURRENT_TIMESTAMP)
                `, [style.style_code, parseInt(typeId), nextOrder]);

                console.log(`  ✅ ${style.style_code} (${style.style_name?.substring(0, 40)}) → order ${nextOrder}`);
                nextOrder++;
                totalInserted++;
            }
        }

        await client.query('COMMIT');

        console.log(`\n${'='.repeat(80)}`);
        console.log(`  ✅ Remapped ${totalInserted} products to their correct categories`);
        console.log('='.repeat(80));

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
