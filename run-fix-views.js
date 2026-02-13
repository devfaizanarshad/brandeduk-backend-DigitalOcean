/**
 * Script to run the FIX_MISSING_FILTERS.sql to recreate materialized views
 * with all the new filter columns properly populated
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Create a connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'brandeduk_prod',
  user: process.env.DB_USER || 'brandeduk',
  password: process.env.DB_PASSWORD || 'omglol123',
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 600000, // 10 minutes for large operations
});

async function runFixViews() {
  const client = await pool.connect();

  try {
    console.log('========================================');
    console.log('FIXING MATERIALIZED VIEWS');
    console.log('========================================');
    console.log('');

    // Step 1: Drop existing views
    console.log('[1/5] Dropping existing materialized views...');
    await client.query('DROP MATERIALIZED VIEW IF EXISTS public.product_search_materialized CASCADE');
    await client.query('DROP MATERIALIZED VIEW IF EXISTS public.product_search_mv CASCADE');
    console.log('      ✓ Views dropped');

    // Step 2: Create product_search_mv
    console.log('[2/5] Creating product_search_mv (this may take a few minutes)...');
    const createMvQuery = `
      CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_search_mv
      TABLESPACE pg_default
      AS
      SELECT 
          p.id,
          p.style_code,
          p.colour_name,
          p.primary_colour,
          p.colour_shade,
          p.single_price,
          p.sell_price,
          p.sku_status,
          p.primary_image_url,
          p.created_at,
          s.style_name,
          b.name AS brand,
          g.slug AS gender_slug,
          ag.slug AS age_group_slug,
          sz.slug AS size_slug,
          t.slug AS tag_slug,
          s.is_best_seller,
          s.is_recommended,
          
          array_agg(DISTINCT cat.id) FILTER (WHERE cat.id IS NOT NULL) AS category_ids,
          array_agg(DISTINCT f.id) FILTER (WHERE f.id IS NOT NULL) AS fabric_ids,
          array_agg(DISTINCT sf.id) FILTER (WHERE sf.id IS NOT NULL) AS flag_ids,
          array_agg(DISTINCT acc.id) FILTER (WHERE acc.id IS NOT NULL) AS accreditation_ids,
          
          array_agg(DISTINCT sk.slug) FILTER (WHERE sk.slug IS NOT NULL) AS style_keywords,
          array_agg(DISTINCT f.slug) FILTER (WHERE f.slug IS NOT NULL) AS fabric_slugs,
          array_agg(DISTINCT sz.slug) FILTER (WHERE sz.slug IS NOT NULL) AS size_slugs,
          array_agg(DISTINCT sk.slug) FILTER (WHERE sk.slug IS NOT NULL) AS style_keyword_slugs,
          array_agg(DISTINCT lower(COALESCE(p.colour_name, p.primary_colour)::text)) 
              FILTER (WHERE p.colour_name IS NOT NULL OR p.primary_colour IS NOT NULL) AS colour_slugs,
          
          -- FIXED: Neckline and sleeve from style_keywords
          array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'neckline' AND sk.slug IS NOT NULL) AS neckline_slugs,
          array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'sleeve' AND sk.slug IS NOT NULL) AS sleeve_slugs,
          array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'fit' AND sk.slug IS NOT NULL) AS fit_slugs,
          array_agg(DISTINCT sk.slug) FILTER (WHERE sk.keyword_type = 'feature' AND sk.slug IS NOT NULL) AS feature_slugs,
          
          array_agg(DISTINCT acc.slug) FILTER (WHERE acc.slug IS NOT NULL) AS accreditation_slugs,
          array_agg(DISTINCT e.slug) FILTER (WHERE e.slug IS NOT NULL) AS effects_arr,
          array_agg(DISTINCT rs.slug) FILTER (WHERE rs.slug IS NOT NULL) AS sector_slugs,
          array_agg(DISTINCT rsp.slug) FILTER (WHERE rsp.slug IS NOT NULL) AS sport_slugs,
          array_agg(DISTINCT wr.slug) FILTER (WHERE wr.slug IS NOT NULL) AS weight_slugs,
          
          to_tsvector('english'::regconfig, 
              COALESCE(s.style_name, '')::text || ' ' || 
              COALESCE(b.name, '')::text || ' ' || 
              COALESCE(p.colour_name, '')::text || ' ' || 
              COALESCE(p.primary_colour, '')::text || ' ' || 
              COALESCE(sz.slug, '')::text || ' ' || 
              COALESCE(t.slug, '')::text
          ) AS search_vector

      FROM products p
      JOIN styles s ON p.style_code = s.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      LEFT JOIN genders g ON s.gender_id = g.id
      LEFT JOIN age_groups ag ON s.age_group_id = ag.id
      LEFT JOIN sizes sz ON p.size_id = sz.id
      LEFT JOIN tags t ON p.tag_id = t.id
      LEFT JOIN product_categories pc ON p.id = pc.product_id
      LEFT JOIN categories cat ON pc.category_id = cat.id
      LEFT JOIN product_fabrics pfab ON p.id = pfab.product_id
      LEFT JOIN fabrics f ON pfab.fabric_id = f.id
      LEFT JOIN product_flags pf ON p.id = pf.product_id
      LEFT JOIN special_flags sf ON pf.flag_id = sf.id
      LEFT JOIN product_accreditations pa ON p.id = pa.product_id
      LEFT JOIN accreditations acc ON pa.accreditation_id = acc.id
      LEFT JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
      LEFT JOIN style_keywords sk ON skm.keyword_id = sk.id
      LEFT JOIN product_effects pe ON p.id = pe.product_id
      LEFT JOIN effects e ON pe.effect_id = e.id
      LEFT JOIN product_sectors ps ON p.id = ps.product_id
      LEFT JOIN related_sectors rs ON ps.sector_id = rs.id
      LEFT JOIN product_sports psp ON p.id = psp.product_id
      LEFT JOIN related_sports rsp ON psp.sport_id = rsp.id
      LEFT JOIN product_weight_ranges pwr ON p.id = pwr.product_id
      LEFT JOIN weight_ranges wr ON pwr.weight_range_id = wr.id
      WHERE p.sku_status = 'Live'
      GROUP BY p.id, s.style_code, s.style_name, b.name, g.slug, ag.slug, sz.slug, t.slug, s.is_best_seller, s.is_recommended
      WITH DATA
    `;
    await client.query(createMvQuery);
    console.log('      ✓ product_search_mv created');

    // Step 3: Create product_search_materialized
    console.log('[3/5] Creating product_search_materialized...');
    const createPsmQuery = `
      CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_search_materialized
      WITH (autovacuum_analyze_scale_factor = 0.005, autovacuum_vacuum_scale_factor = 0.01)
      TABLESPACE pg_default
      AS
      SELECT * FROM product_search_mv
      WITH DATA
    `;
    await client.query(createPsmQuery);
    console.log('      ✓ product_search_materialized created');

    // Step 4: Create indexes
    console.log('[4/5] Creating indexes (this may take a few minutes)...');

    const indexes = [
      // Unique indexes
      'CREATE UNIQUE INDEX idx_psm_unique ON public.product_search_materialized USING btree (id)',

      // Basic indexes
      'CREATE INDEX idx_psm_style_code ON public.product_search_materialized USING btree (style_code)',
      'CREATE INDEX idx_psm_sku_status ON public.product_search_materialized USING btree (sku_status)',
      'CREATE INDEX idx_psm_created ON public.product_search_materialized USING btree (created_at) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_sell_price ON public.product_search_materialized USING btree (sell_price) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_gender ON public.product_search_materialized USING btree (gender_slug) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_brand ON public.product_search_materialized USING btree (brand) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_primary_colour ON public.product_search_materialized USING btree (primary_colour) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_is_best ON public.product_search_materialized USING btree (is_best_seller) WHERE sku_status = \'Live\' AND is_best_seller = true',
      'CREATE INDEX idx_psm_is_recommended ON public.product_search_materialized USING btree (is_recommended) WHERE sku_status = \'Live\' AND is_recommended = true',

      // GIN indexes for array columns
      'CREATE INDEX idx_psm_search_gin ON public.product_search_materialized USING gin (search_vector) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_colour_slugs_gin ON public.product_search_materialized USING gin (colour_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_size_slugs_gin ON public.product_search_materialized USING gin (size_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_fabric_slugs_gin ON public.product_search_materialized USING gin (fabric_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_style_keywords_gin ON public.product_search_materialized USING gin (style_keyword_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_neckline_slugs_gin ON public.product_search_materialized USING gin (neckline_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_sleeve_slugs_gin ON public.product_search_materialized USING gin (sleeve_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_fit_slugs_gin ON public.product_search_materialized USING gin (fit_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_feature_slugs_gin ON public.product_search_materialized USING gin (feature_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_accreditation_slugs_gin ON public.product_search_materialized USING gin (accreditation_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_effects_arr_gin ON public.product_search_materialized USING gin (effects_arr) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_sector_slugs_gin ON public.product_search_materialized USING gin (sector_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_sport_slugs_gin ON public.product_search_materialized USING gin (sport_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_weight_slugs_gin ON public.product_search_materialized USING gin (weight_slugs) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_category_ids_gin ON public.product_search_materialized USING gin (category_ids) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_flag_ids_gin ON public.product_search_materialized USING gin (flag_ids) WHERE sku_status = \'Live\'',

      // Composite indexes
      'CREATE INDEX idx_psm_gender_created ON public.product_search_materialized USING btree (gender_slug, created_at DESC) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_sort_newest ON public.product_search_materialized USING btree (created_at DESC, style_code) WHERE sku_status = \'Live\'',
      'CREATE INDEX idx_psm_sort_price_low ON public.product_search_materialized USING btree (sell_price ASC, style_code) WHERE sku_status = \'Live\' AND sell_price IS NOT NULL',
      'CREATE INDEX idx_psm_sort_price_high ON public.product_search_materialized USING btree (sell_price DESC, style_code) WHERE sku_status = \'Live\' AND sell_price IS NOT NULL',
    ];

    for (let i = 0; i < indexes.length; i++) {
      try {
        await client.query(indexes[i]);
        process.stdout.write(`      ✓ Index ${i + 1}/${indexes.length}\r`);
      } catch (err) {
        console.log(`      ⚠ Index ${i + 1} skipped: ${err.message}`);
      }
    }
    console.log(`      ✓ ${indexes.length} indexes created                    `);

    // Step 5: Verify data
    console.log('[5/5] Verifying data...');

    const verifyQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE array_length(sleeve_slugs, 1) > 0) as with_sleeve,
        COUNT(*) FILTER (WHERE array_length(neckline_slugs, 1) > 0) as with_neckline,
        COUNT(*) FILTER (WHERE array_length(fit_slugs, 1) > 0) as with_fit,
        COUNT(*) FILTER (WHERE array_length(feature_slugs, 1) > 0) as with_feature,
        COUNT(*) FILTER (WHERE array_length(accreditation_slugs, 1) > 0) as with_accreditation,
        COUNT(*) FILTER (WHERE array_length(sector_slugs, 1) > 0) as with_sector,
        COUNT(*) FILTER (WHERE array_length(effects_arr, 1) > 0) as with_effect
      FROM product_search_materialized
      WHERE sku_status = 'Live'
    `;
    const verifyResult = await client.query(verifyQuery);
    const stats = verifyResult.rows[0];

    console.log('');
    console.log('========================================');
    console.log('VERIFICATION RESULTS');
    console.log('========================================');
    console.log(`Total products: ${stats.total}`);
    console.log(`With sleeve:    ${stats.with_sleeve}`);
    console.log(`With neckline:  ${stats.with_neckline}`);
    console.log(`With fit:       ${stats.with_fit}`);
    console.log(`With feature:   ${stats.with_feature}`);
    console.log(`With accred:    ${stats.with_accreditation}`);
    console.log(`With sector:    ${stats.with_sector}`);
    console.log(`With effect:    ${stats.with_effect}`);
    console.log('========================================');

    // Show sample sleeve slugs
    const sleeveQuery = `
      SELECT DISTINCT unnest(sleeve_slugs) as slug
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND array_length(sleeve_slugs, 1) > 0
      LIMIT 10
    `;
    const sleeveResult = await client.query(sleeveQuery);
    if (sleeveResult.rows.length > 0) {
      console.log('');
      console.log('Available sleeve slugs:');
      sleeveResult.rows.forEach(row => console.log(`  - ${row.slug}`));
    }

    console.log('');
    console.log('✓ DONE! Views recreated successfully.');
    console.log('');
    console.log('Restart your server to see the changes.');

  } catch (error) {
    console.error('');
    console.error('ERROR:', error.message);
    console.error('');
    if (error.message.includes('does not exist')) {
      console.error('A table or column is missing. Check the error above.');
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runFixViews().catch(err => {
  console.error('Failed to fix views:', err.message);
  process.exit(1);
});

