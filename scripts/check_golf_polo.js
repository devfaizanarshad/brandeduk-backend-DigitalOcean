const { pool } = require('../config/database');

async function checkGolfPolo() {
    try {
        console.log('================================================');
        console.log('  DATABASE CHECK: "golf polo" - Complete Audit');
        console.log('================================================\n');

        // --- NAME-BASED SEARCH ---
        console.log('--- 1. NAME-BASED MATCHING ---\n');

        const poloStyles = await pool.query(
            "SELECT COUNT(DISTINCT s.style_code) as count FROM styles s JOIN products p ON s.style_code = p.style_code WHERE p.sku_status = 'Live' AND LOWER(s.style_name) LIKE '%polo%'"
        );
        console.log('Live styles with "polo" in name:', poloStyles.rows[0].count);

        const golfStyles = await pool.query(
            "SELECT COUNT(DISTINCT s.style_code) as count FROM styles s JOIN products p ON s.style_code = p.style_code WHERE p.sku_status = 'Live' AND LOWER(s.style_name) LIKE '%golf%'"
        );
        console.log('Live styles with "golf" in name:', golfStyles.rows[0].count);

        const golfPoloNames = await pool.query(
            "SELECT COUNT(DISTINCT s.style_code) as count FROM styles s JOIN products p ON s.style_code = p.style_code WHERE p.sku_status = 'Live' AND LOWER(s.style_name) LIKE '%golf%' AND LOWER(s.style_name) LIKE '%polo%'"
        );
        console.log('Live styles with "golf" AND "polo" in name:', golfPoloNames.rows[0].count);

        // --- PRODUCT TYPE MATCHING ---
        console.log('\n--- 2. PRODUCT TYPE MATCHING ---\n');

        const poloType = await pool.query(
            "SELECT COUNT(DISTINCT s.style_code) as count FROM styles s JOIN products p ON s.style_code = p.style_code JOIN product_types pt ON s.product_type_id = pt.id WHERE p.sku_status = 'Live' AND LOWER(pt.name) = 'polos'"
        );
        console.log('Live styles with product_type = "Polos":', poloType.rows[0].count);

        // --- SPORT FILTER MATCHING (via product_sports -> products -> styles) ---
        console.log('\n--- 3. SPORT FILTER MATCHING ---\n');

        const golfSport = await pool.query(
            "SELECT COUNT(DISTINCT s.style_code) as count FROM styles s JOIN products p ON s.style_code = p.style_code JOIN product_sports ps ON p.id = ps.product_id JOIN related_sports rs ON ps.sport_id = rs.id WHERE p.sku_status = 'Live' AND LOWER(rs.name) = 'golf'"
        );
        console.log('Live styles with sport = "Golf":', golfSport.rows[0].count);

        // --- THE KEY COMBO: Golf sport + Polos type ---
        console.log('\n--- 4. COMBINED: sport="Golf" + product_type="Polos" ---\n');

        const golfPoloCombo = await pool.query(
            "SELECT COUNT(DISTINCT s.style_code) as count FROM styles s JOIN products p ON s.style_code = p.style_code JOIN product_types pt ON s.product_type_id = pt.id JOIN product_sports ps ON p.id = ps.product_id JOIN related_sports rs ON ps.sport_id = rs.id WHERE p.sku_status = 'Live' AND LOWER(pt.name) = 'polos' AND LOWER(rs.name) = 'golf'"
        );
        console.log('IDEAL "golf polo" count (sport+type):', golfPoloCombo.rows[0].count);

        // Sample products
        const samples = await pool.query(
            "SELECT DISTINCT s.style_code, s.style_name, pt.name as product_type FROM styles s JOIN products p ON s.style_code = p.style_code JOIN product_types pt ON s.product_type_id = pt.id JOIN product_sports ps ON p.id = ps.product_id JOIN related_sports rs ON ps.sport_id = rs.id WHERE p.sku_status = 'Live' AND LOWER(pt.name) = 'polos' AND LOWER(rs.name) = 'golf' ORDER BY s.style_name LIMIT 20"
        );
        console.log('\nSample golf polo styles:');
        samples.rows.forEach(s => console.log('  -', s.style_code, '|', s.style_name));

        // --- GOLF breakdown by product type ---
        console.log('\n--- 5. GOLF SPORT: Product Type Breakdown ---\n');

        const golfProductTypes = await pool.query(
            "SELECT pt.name, COUNT(DISTINCT s.style_code) as count FROM styles s JOIN products p ON s.style_code = p.style_code JOIN product_types pt ON s.product_type_id = pt.id JOIN product_sports ps ON p.id = ps.product_id JOIN related_sports rs ON ps.sport_id = rs.id WHERE p.sku_status = 'Live' AND LOWER(rs.name) = 'golf' GROUP BY pt.name ORDER BY count DESC"
        );
        console.log('All product types for golf sport:');
        golfProductTypes.rows.forEach(t => console.log('  -', t.name + ':', t.count));

        // --- CHECK THE MV ---
        console.log('\n--- 6. MATERIALIZED VIEW CHECK ---\n');

        const mvCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'product_search_materialized' ORDER BY ordinal_position");
        console.log('MV columns:', mvCols.rows.map(r => r.column_name).join(', '));

        // Try to query MV for golf polo
        if (mvCols.rows.length > 0) {
            const colNames = mvCols.rows.map(r => r.column_name);
            console.log('\nChecking if MV has sport info...');

            if (colNames.includes('sport_slugs')) {
                const mvGolfPolo = await pool.query(
                    "SELECT COUNT(*) as count FROM product_search_materialized WHERE LOWER(product_type) = 'polos' AND 'golf' = ANY(sport_slugs)"
                );
                console.log('MV: Polos with golf in sport_slugs:', mvGolfPolo.rows[0].count);
            } else {
                console.log('MV does not have sport_slugs column. Available:', colNames.join(', '));
            }
        }

        console.log('\n================================================');
        console.log('  SUMMARY');
        console.log('================================================');
        console.log('When user searches "golf polo", the system should:');
        console.log('  1. Match "golf" -> sport filter (Golf, count:', golfSport.rows[0].count, ')');
        console.log('  2. Match "polo" -> product type (Polos, count:', poloType.rows[0].count, ')');
        console.log('  3. COMBINE both -> Golf + Polos =', golfPoloCombo.rows[0].count, 'results');
        console.log('  (vs just name search "golf AND polo" =', golfPoloNames.rows[0].count, 'results)');

        pool.end();
    } catch (e) {
        console.error('Error:', e.message);
        pool.end();
    }
}

checkGolfPolo();
