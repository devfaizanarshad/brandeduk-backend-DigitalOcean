const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../config/database');

/**
 * GET /api/filters/product-types
 * Get all product types with counts
 */
router.get('/product-types', async (req, res) => {
  try {
    const query = `
      SELECT 
        pt.id,
        pt.name,
        pt.display_order,
        COUNT(DISTINCT s.style_code) as product_count
      FROM product_types pt
      INNER JOIN styles s ON pt.id = s.product_type_id
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY pt.id, pt.name, pt.display_order
      HAVING COUNT(DISTINCT s.style_code) > 0
      ORDER BY pt.display_order ASC, pt.name ASC
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const productTypes = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.name.toLowerCase().replace(/\s+/g, '-'),
      count: parseInt(row.product_count || 0),
      displayOrder: row.display_order
    }));

    res.json({ productTypes, total: productTypes.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch product types:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/genders
 * Get all genders with product counts
 */
router.get('/genders', async (req, res) => {
  try {
    const query = `
      SELECT 
        gender_slug as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND gender_slug IS NOT NULL
      GROUP BY gender_slug
      ORDER BY product_count DESC
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const genders = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.charAt(0).toUpperCase() + row.slug.slice(1),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ genders, total: genders.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch genders:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/age-groups
 * Get all age groups with product counts
 */
router.get('/age-groups', async (req, res) => {
  try {
    const query = `
      SELECT 
        age_group_slug as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND age_group_slug IS NOT NULL
      GROUP BY age_group_slug
      ORDER BY product_count DESC
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const ageGroups = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.charAt(0).toUpperCase() + row.slug.slice(1),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ ageGroups, total: ageGroups.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch age groups:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/sleeves
 * Get all sleeve types with product counts
 */
router.get('/sleeves', async (req, res) => {
  try {
    const query = `
      SELECT 
        sleeve_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(sleeve_slugs) as sleeve_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND sleeve_slugs IS NOT NULL AND array_length(sleeve_slugs, 1) > 0
      ) subq
      GROUP BY sleeve_value
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const sleeves = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ sleeves, total: sleeves.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch sleeves:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/necklines
 * Get all neckline types with product counts
 */
router.get('/necklines', async (req, res) => {
  try {
    const query = `
      SELECT 
        neckline_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(neckline_slugs) as neckline_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND neckline_slugs IS NOT NULL AND array_length(neckline_slugs, 1) > 0
      ) subq
      GROUP BY neckline_value
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const necklines = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ necklines, total: necklines.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch necklines:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/fabrics
 * Get all fabric types with product counts
 */
router.get('/fabrics', async (req, res) => {
  try {
    const query = `
      SELECT 
        fabric_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(fabric_slugs) as fabric_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND fabric_slugs IS NOT NULL AND array_length(fabric_slugs, 1) > 0
      ) subq
      GROUP BY fabric_value
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const fabrics = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ fabrics, total: fabrics.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch fabrics:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/sizes
 * Get all sizes with product counts
 */
router.get('/sizes', async (req, res) => {
  try {
    const query = `
      SELECT 
        size_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(size_slugs) as size_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND size_slugs IS NOT NULL AND array_length(size_slugs, 1) > 0
      ) subq
      GROUP BY size_value
      ORDER BY product_count DESC
      LIMIT 100
    `;

    const result = await queryWithTimeout(query, [], 15000);
    
    const sizes = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.toUpperCase(),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ sizes, total: sizes.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch sizes:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/colors
 * Get all colors with product counts
 */
router.get('/colors', async (req, res) => {
  try {
    const query = `
      SELECT 
        colour_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(colour_slugs) as colour_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND colour_slugs IS NOT NULL AND array_length(colour_slugs, 1) > 0
      ) subq
      GROUP BY colour_value
      ORDER BY product_count DESC
      LIMIT 100
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const colors = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ colors, total: colors.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch colors:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/primary-colors
 * Get all primary colors with product counts
 */
router.get('/primary-colors', async (req, res) => {
  try {
    const query = `
      SELECT 
        LOWER(primary_colour) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND primary_colour IS NOT NULL
      GROUP BY LOWER(primary_colour)
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const primaryColors = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ primaryColors, total: primaryColors.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch primary colors:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/styles
 * Get all style keywords with product counts
 */
router.get('/styles', async (req, res) => {
  try {
    const query = `
      SELECT 
        style_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(style_keyword_slugs) as style_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND style_keyword_slugs IS NOT NULL AND array_length(style_keyword_slugs, 1) > 0
      ) subq
      GROUP BY style_value
      ORDER BY product_count DESC
      LIMIT 100
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const styles = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ styles, total: styles.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch styles:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/tags
 * Get all tags with product counts
 */
router.get('/tags', async (req, res) => {
  try {
    const query = `
      SELECT 
        LOWER(tag_slug) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND tag_slug IS NOT NULL
      GROUP BY LOWER(tag_slug)
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const tags = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.charAt(0).toUpperCase() + row.slug.slice(1),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ tags, total: tags.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch tags:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/weights
 * Get all weight ranges with product counts
 */
router.get('/weights', async (req, res) => {
  try {
    const query = `
      SELECT 
        weight_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(weight_slugs) as weight_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND weight_slugs IS NOT NULL AND array_length(weight_slugs, 1) > 0
      ) subq
      GROUP BY weight_value
      ORDER BY product_count DESC
      LIMIT 20
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const weights = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.replace('gsm', ' GSM'),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ weights, total: weights.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch weights:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/fits
 * Get all fit types with product counts
 */
router.get('/fits', async (req, res) => {
  try {
    const query = `
      SELECT 
        LOWER(fit_slug) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND fit_slug IS NOT NULL
      GROUP BY LOWER(fit_slug)
      ORDER BY product_count DESC
      LIMIT 20
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const fits = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.charAt(0).toUpperCase() + row.slug.slice(1),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ fits, total: fits.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch fits:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/sectors
 * Get all sectors with product counts
 */
router.get('/sectors', async (req, res) => {
  try {
    const query = `
      SELECT 
        sector_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(sector_slugs) as sector_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND sector_slugs IS NOT NULL AND array_length(sector_slugs, 1) > 0
      ) subq
      GROUP BY sector_value
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const sectors = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ sectors, total: sectors.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch sectors:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/sports
 * Get all sports with product counts
 */
router.get('/sports', async (req, res) => {
  try {
    const query = `
      SELECT 
        sport_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(sport_slugs) as sport_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND sport_slugs IS NOT NULL AND array_length(sport_slugs, 1) > 0
      ) subq
      GROUP BY sport_value
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const sports = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ sports, total: sports.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch sports:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/effects
 * Get all effects with product counts
 */
router.get('/effects', async (req, res) => {
  try {
    const query = `
      SELECT 
        effect_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(effects_arr) as effect_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND effects_arr IS NOT NULL AND array_length(effects_arr, 1) > 0
      ) subq
      GROUP BY effect_value
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const effects = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ effects, total: effects.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch effects:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/accreditations
 * Get all accreditations with product counts
 */
router.get('/accreditations', async (req, res) => {
  try {
    const query = `
      SELECT 
        accreditation_value as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM (
        SELECT DISTINCT
          style_code,
          unnest(accreditation_slugs) as accreditation_value
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND accreditation_slugs IS NOT NULL AND array_length(accreditation_slugs, 1) > 0
      ) subq
      GROUP BY accreditation_value
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const accreditations = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ accreditations, total: accreditations.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch accreditations:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/colour-shades
 * Get all colour shades with product counts
 */
router.get('/colour-shades', async (req, res) => {
  try {
    const query = `
      SELECT 
        LOWER(colour_shade) as slug,
        COUNT(DISTINCT style_code) as product_count
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND colour_shade IS NOT NULL
      GROUP BY LOWER(colour_shade)
      ORDER BY product_count DESC
      LIMIT 50
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const colourShades = result.rows.map(row => ({
      slug: row.slug,
      name: row.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ colourShades, total: colourShades.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch colour shades:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/brands
 * Get all brands with product counts
 */
router.get('/brands', async (req, res) => {
  try {
    const query = `
      SELECT 
        b.id,
        b.name,
        COUNT(DISTINCT s.style_code) as product_count
      FROM brands b
      INNER JOIN styles s ON b.id = s.brand_id
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY b.id, b.name
      HAVING COUNT(DISTINCT s.style_code) > 0
      ORDER BY b.name ASC
    `;

    const result = await queryWithTimeout(query, [], 10000);
    
    const brands = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.name.toLowerCase().replace(/\s+/g, '-'),
      count: parseInt(row.product_count || 0)
    }));

    res.json({ brands, total: brands.length });
  } catch (error) {
    console.error('[ERROR] Failed to fetch brands:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/price-range
 * Get min and max prices across all products
 */
router.get('/price-range', async (req, res) => {
  try {
    const query = `
      SELECT 
        MIN(single_price) as min_price,
        MAX(single_price) as max_price
      FROM product_search_materialized
      WHERE sku_status = 'Live' AND single_price IS NOT NULL AND single_price > 0
    `;

    const result = await queryWithTimeout(query, [], 10000);
    const row = result.rows[0];
    
    res.json({
      min: parseFloat(row.min_price || 0),
      max: parseFloat(row.max_price || 0)
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch price range:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /api/filters/all
 * Get all filter options in one request (for initial page load)
 */
router.get('/all', async (req, res) => {
  try {
    // Run all queries in parallel for better performance
    const [
      productTypesResult,
      gendersResult,
      ageGroupsResult,
      sleevesResult,
      necklinesResult,
      fabricsResult,
      sizesResult,
      colorsResult,
      tagsResult,
      brandsResult,
      priceRangeResult
    ] = await Promise.all([
      queryWithTimeout(`
        SELECT pt.id, pt.name, pt.display_order, COUNT(DISTINCT s.style_code) as count
        FROM product_types pt
        INNER JOIN styles s ON pt.id = s.product_type_id
        INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
        GROUP BY pt.id, pt.name, pt.display_order
        HAVING COUNT(DISTINCT s.style_code) > 0
        ORDER BY pt.display_order ASC
      `, [], 10000),
      queryWithTimeout(`
        SELECT gender_slug as slug, COUNT(DISTINCT style_code) as count
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND gender_slug IS NOT NULL
        GROUP BY gender_slug
        ORDER BY count DESC
      `, [], 10000),
      queryWithTimeout(`
        SELECT age_group_slug as slug, COUNT(DISTINCT style_code) as count
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND age_group_slug IS NOT NULL
        GROUP BY age_group_slug
        ORDER BY count DESC
      `, [], 10000),
      queryWithTimeout(`
        SELECT sleeve_value as slug, COUNT(DISTINCT style_code) as count
        FROM (
          SELECT DISTINCT style_code, unnest(sleeve_slugs) as sleeve_value
          FROM product_search_materialized
          WHERE sku_status = 'Live' AND sleeve_slugs IS NOT NULL
        ) subq
        GROUP BY sleeve_value
        ORDER BY count DESC
        LIMIT 30
      `, [], 10000),
      queryWithTimeout(`
        SELECT neckline_value as slug, COUNT(DISTINCT style_code) as count
        FROM (
          SELECT DISTINCT style_code, unnest(neckline_slugs) as neckline_value
          FROM product_search_materialized
          WHERE sku_status = 'Live' AND neckline_slugs IS NOT NULL
        ) subq
        GROUP BY neckline_value
        ORDER BY count DESC
        LIMIT 30
      `, [], 10000),
      queryWithTimeout(`
        SELECT fabric_value as slug, COUNT(DISTINCT style_code) as count
        FROM (
          SELECT DISTINCT style_code, unnest(fabric_slugs) as fabric_value
          FROM product_search_materialized
          WHERE sku_status = 'Live' AND fabric_slugs IS NOT NULL
        ) subq
        GROUP BY fabric_value
        ORDER BY count DESC
        LIMIT 30
      `, [], 10000),
      queryWithTimeout(`
        SELECT size_value as slug, COUNT(DISTINCT style_code) as count
        FROM (
          SELECT DISTINCT style_code, unnest(size_slugs) as size_value
          FROM product_search_materialized
          WHERE sku_status = 'Live' AND size_slugs IS NOT NULL
        ) subq
        GROUP BY size_value
        ORDER BY count DESC
        LIMIT 50
      `, [], 15000),
      queryWithTimeout(`
        SELECT colour_value as slug, COUNT(DISTINCT style_code) as count
        FROM (
          SELECT DISTINCT style_code, unnest(colour_slugs) as colour_value
          FROM product_search_materialized
          WHERE sku_status = 'Live' AND colour_slugs IS NOT NULL
        ) subq
        GROUP BY colour_value
        ORDER BY count DESC
        LIMIT 50
      `, [], 10000),
      queryWithTimeout(`
        SELECT LOWER(tag_slug) as slug, COUNT(DISTINCT style_code) as count
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND tag_slug IS NOT NULL
        GROUP BY LOWER(tag_slug)
        ORDER BY count DESC
        LIMIT 20
      `, [], 10000),
      queryWithTimeout(`
        SELECT b.id, b.name, COUNT(DISTINCT s.style_code) as count
        FROM brands b
        INNER JOIN styles s ON b.id = s.brand_id
        INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
        GROUP BY b.id, b.name
        ORDER BY b.name ASC
      `, [], 10000),
      queryWithTimeout(`
        SELECT MIN(single_price) as min, MAX(single_price) as max
        FROM product_search_materialized
        WHERE sku_status = 'Live' AND single_price > 0
      `, [], 10000)
    ]);

    const priceRange = priceRangeResult.rows[0];

    res.json({
      productTypes: productTypesResult.rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.name.toLowerCase().replace(/\s+/g, '-'),
        count: parseInt(r.count)
      })),
      genders: gendersResult.rows.map(r => ({
        slug: r.slug,
        name: r.slug.charAt(0).toUpperCase() + r.slug.slice(1),
        count: parseInt(r.count)
      })),
      ageGroups: ageGroupsResult.rows.map(r => ({
        slug: r.slug,
        name: r.slug.charAt(0).toUpperCase() + r.slug.slice(1),
        count: parseInt(r.count)
      })),
      sleeves: sleevesResult.rows.map(r => ({
        slug: r.slug,
        name: r.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        count: parseInt(r.count)
      })),
      necklines: necklinesResult.rows.map(r => ({
        slug: r.slug,
        name: r.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        count: parseInt(r.count)
      })),
      fabrics: fabricsResult.rows.map(r => ({
        slug: r.slug,
        name: r.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        count: parseInt(r.count)
      })),
      sizes: sizesResult.rows.map(r => ({
        slug: r.slug,
        name: r.slug.toUpperCase(),
        count: parseInt(r.count)
      })),
      colors: colorsResult.rows.map(r => ({
        slug: r.slug,
        name: r.slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        count: parseInt(r.count)
      })),
      tags: tagsResult.rows.map(r => ({
        slug: r.slug,
        name: r.slug.charAt(0).toUpperCase() + r.slug.slice(1),
        count: parseInt(r.count)
      })),
      brands: brandsResult.rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.name.toLowerCase().replace(/\s+/g, '-'),
        count: parseInt(r.count)
      })),
      priceRange: {
        min: parseFloat(priceRange.min || 0),
        max: parseFloat(priceRange.max || 0)
      }
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch all filters:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
