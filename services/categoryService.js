const { queryWithTimeout } = require('../config/database');

async function getAllCategories() {
  try {
    const query = `
      SELECT 
        id,
        name,
        slug,
        parent_id,
        display_order,
        description,
        category_type
      FROM categories
      ORDER BY 
        COALESCE(parent_id, id) ASC,
        display_order ASC,
        name ASC
    `;

    const result = await queryWithTimeout(query, [], 10000);

    if (result.rows.length === 0) {
      return [];
    }

    const categoriesMap = new Map();
    const rootCategories = [];

    result.rows.forEach(row => {
      const category = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        parentId: row.parent_id,
        displayOrder: row.display_order || 0,
        description: row.description,
        categoryType: row.category_type,
        subcategories: []
      };
      categoriesMap.set(row.id, category);
    });

    result.rows.forEach(row => {
      const category = categoriesMap.get(row.id);
      if (row.parent_id === null) {
        rootCategories.push(category);
      } else {
        const parent = categoriesMap.get(row.parent_id);
        if (parent) {
          parent.subcategories.push(category);
        }
      }
    });

    rootCategories.sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }
      return a.name.localeCompare(b.name);
    });

    rootCategories.forEach(category => {
      category.subcategories.sort((a, b) => {
        if (a.displayOrder !== b.displayOrder) {
          return a.displayOrder - b.displayOrder;
        }
        return a.name.localeCompare(b.name);
      });
    });

    return rootCategories;
  } catch (error) {
    console.error('[ERROR] getAllCategories failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function getCategoryBySlug(slug) {
  try {
    const query = `
      SELECT 
        id,
        name,
        slug,
        parent_id,
        display_order,
        description,
        category_type
      FROM categories
      WHERE slug = $1
      LIMIT 1
    `;

    const result = await queryWithTimeout(query, [slug], 10000);

    if (result.rows.length === 0) {
      return null;
    }

    const categoryData = result.rows[0];

    // Get subcategories if this is a parent category
    const subcategoriesQuery = `
      SELECT 
        id,
        name,
        slug,
        parent_id,
        display_order,
        description,
        category_type
      FROM categories
      WHERE parent_id = $1
      ORDER BY display_order ASC, name ASC
    `;

    const subcategoriesResult = await queryWithTimeout(subcategoriesQuery, [categoryData.id], 10000);

    const category = {
      id: categoryData.id,
      name: categoryData.name,
      slug: categoryData.slug,
      parentId: categoryData.parent_id,
      displayOrder: categoryData.display_order || 0,
      description: categoryData.description,
      categoryType: categoryData.category_type,
      subcategories: subcategoriesResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        parentId: row.parent_id,
        displayOrder: row.display_order || 0,
        description: row.description,
        categoryType: row.category_type
      }))
    };

    return category;
  } catch (error) {
    console.error('[ERROR] getCategoryBySlug failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function getCategoriesFlat() {
  try {
    const query = `
      SELECT 
        id,
        name,
        slug,
        parent_id,
        display_order,
        description,
        category_type
      FROM categories
      ORDER BY 
        COALESCE(parent_id, id) ASC,
        display_order ASC,
        name ASC
    `;

    const result = await queryWithTimeout(query, [], 10000);

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentId: row.parent_id,
      displayOrder: row.display_order || 0,
      description: row.description,
      categoryType: row.category_type
    }));
  } catch (error) {
    console.error('[ERROR] getCategoriesFlat failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function getCategoryIdsWithChildren(categoryIds) {
  try {
    if (!categoryIds || categoryIds.length === 0) {
      return [];
    }

    // Use recursive CTE to get all category IDs including children
    const query = `
      WITH RECURSIVE category_tree AS (
        -- Base case: start with the given category IDs
        SELECT id, parent_id
        FROM categories
        WHERE id = ANY($1::int[])
        
        UNION ALL
        
        -- Recursive case: get all children
        SELECT c.id, c.parent_id
        FROM categories c
        INNER JOIN category_tree ct ON c.parent_id = ct.id
      )
      SELECT DISTINCT id FROM category_tree
    `;

    const result = await queryWithTimeout(query, [categoryIds], 10000);
    return result.rows.map(row => row.id);
  } catch (error) {
    console.error('[ERROR] getCategoryIdsWithChildren failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function getCategoryIdsFromSlugs(slugs) {
  try {
    if (!slugs || slugs.length === 0) {
      return [];
    }

    const query = `
      SELECT id
      FROM categories
      WHERE LOWER(slug) = ANY($1::text[])
    `;

    const result = await queryWithTimeout(query, [slugs.map(s => s.toLowerCase())], 10000);
    return result.rows.map(row => row.id);
  } catch (error) {
    console.error('[ERROR] getCategoryIdsFromSlugs failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function getCategoryStats() {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_categories,
        COUNT(CASE WHEN parent_id IS NULL THEN 1 END) as root_categories,
        COUNT(CASE WHEN parent_id IS NOT NULL THEN 1 END) as subcategories,
        COUNT(DISTINCT parent_id) as categories_with_children
      FROM categories
    `;

    const sampleQuery = `
      SELECT 
        id,
        name,
        slug,
        parent_id,
        display_order
      FROM categories
      WHERE parent_id IS NOT NULL
      ORDER BY parent_id, display_order
      LIMIT 10
    `;

    const rootQuery = `
      SELECT 
        id,
        name,
        slug,
        (SELECT COUNT(*) FROM categories c WHERE c.parent_id = cat.id) as child_count
      FROM categories cat
      WHERE parent_id IS NULL
      ORDER BY display_order, name
      LIMIT 20
    `;

    const [statsResult, sampleResult, rootResult] = await Promise.all([
      queryWithTimeout(statsQuery, [], 10000),
      queryWithTimeout(sampleQuery, [], 10000),
      queryWithTimeout(rootQuery, [], 10000)
    ]);

    return {
      statistics: statsResult.rows[0],
      sampleSubcategories: sampleResult.rows,
      rootCategoriesWithChildCounts: rootResult.rows
    };
  } catch (error) {
    console.error('[ERROR] getCategoryStats failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Get categories for dropdown menu
 * Returns product types (main categories) with their associated style keywords (subcategories)
 * This is used for the frontend category dropdown menu
 */
async function getDropdownCategories() {
  try {
    // First, get top 10 product types by display_order
    const productTypesQuery = `
      SELECT DISTINCT
        pt.id,
        pt.name,
        pt.slug,
        pt.display_order,
        COUNT(DISTINCT s.style_code) as product_count
      FROM product_types pt
      INNER JOIN styles s ON pt.id = s.product_type_id
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      GROUP BY pt.id, pt.name, pt.slug, pt.display_order
      HAVING COUNT(DISTINCT s.style_code) > 0
      ORDER BY pt.display_order ASC, pt.name ASC
      LIMIT 10
    `;

    const productTypesResult = await queryWithTimeout(productTypesQuery, [], 10000);

    // Get the product type IDs for filtering keywords
    const productTypeIds = productTypesResult.rows.map(row => row.id);

    if (productTypeIds.length === 0) {
      return [];
    }

    // Then, get keywords for each product type, sorted by product count (most relevant first)
    const keywordsQuery = `
      SELECT DISTINCT
        pt.id as product_type_id,
        sk.id as keyword_id,
        sk.name as keyword_name,
        sk.slug as keyword_slug,
        COUNT(DISTINCT s.style_code) as product_count
      FROM product_types pt
      INNER JOIN styles s ON pt.id = s.product_type_id
      INNER JOIN products p ON s.style_code = p.style_code AND p.sku_status = 'Live'
      INNER JOIN style_keywords_mapping skm ON s.style_code = skm.style_code
      INNER JOIN style_keywords sk ON skm.keyword_id = sk.id
      WHERE pt.id = ANY($1::int[])
      GROUP BY pt.id, sk.id, sk.name, sk.slug
      HAVING COUNT(DISTINCT s.style_code) >= 2
      ORDER BY pt.id, COUNT(DISTINCT s.style_code) DESC, sk.name ASC
    `;

    const keywordsResult = await queryWithTimeout(keywordsQuery, [productTypeIds], 10000);

    // Helper function to normalize slug (remove trailing numbers like "-1", "-2")
    const normalizeSlug = (slug) => {
      if (!slug) return '';
      return slug.toLowerCase().replace(/-\d+$/, '').trim();
    };

    // Helper function to normalize name (for comparison)
    const normalizeName = (name) => {
      if (!name) return '';
      return name.toLowerCase().trim();
    };

    // Build categories map
    const categoriesMap = new Map();

    // First, add top 10 product types
    productTypesResult.rows.forEach(row => {
      categoriesMap.set(row.id, {
        id: row.id,
        name: row.name,
        slug: row.slug,
        displayOrder: row.display_order || 0,
        productCount: parseInt(row.product_count || 0),
        subcategories: []
      });
    });

    // Process keywords: deduplicate and limit to 5 per product type
    const subcategoryCounts = new Map();
    const seenKeywords = new Map(); // Track normalized slugs per product type
    
    keywordsResult.rows.forEach(row => {
      const category = categoriesMap.get(row.product_type_id);
      if (!category) return;

      const currentCount = subcategoryCounts.get(row.product_type_id) || 0;
      if (currentCount >= 5) return; // Already have 5 subcategories

      // Normalize the slug and name for deduplication
      const normalizedSlug = normalizeSlug(row.keyword_slug || row.keyword_name.toLowerCase().replace(/\s+/g, '-'));
      const normalizedName = normalizeName(row.keyword_name);
      
      // Create a key for this product type + normalized slug
      const dedupeKey = `${row.product_type_id}_${normalizedSlug}`;
      
      // Check if we've already added this keyword (by normalized slug)
      if (seenKeywords.has(dedupeKey)) {
        // If we have a duplicate, keep the one with higher product count
        const existing = seenKeywords.get(dedupeKey);
        if (parseInt(row.product_count) > existing.productCount) {
          // Replace with better one
          const index = category.subcategories.findIndex(sub => sub.id === existing.id);
          if (index !== -1) {
            const keywordSlug = row.keyword_slug || row.keyword_name.toLowerCase().replace(/\s+/g, '-');
            category.subcategories[index] = {
              id: row.keyword_id,
              name: row.keyword_name,
              slug: keywordSlug,
              productCount: parseInt(row.product_count || 0)
            };
            seenKeywords.set(dedupeKey, {
              id: row.keyword_id,
              productCount: parseInt(row.product_count || 0)
            });
          }
        }
      } else {
        // New keyword, add it
        const keywordSlug = row.keyword_slug || row.keyword_name.toLowerCase().replace(/\s+/g, '-');
        category.subcategories.push({
          id: row.keyword_id,
          name: row.keyword_name,
          slug: keywordSlug,
          productCount: parseInt(row.product_count || 0)
        });
        subcategoryCounts.set(row.product_type_id, currentCount + 1);
        seenKeywords.set(dedupeKey, {
          id: row.keyword_id,
          productCount: parseInt(row.product_count || 0)
        });
      }
    });

    // Convert map to array
    const categories = Array.from(categoriesMap.values());
    
    // Sort subcategories by product count descending (most relevant first), then by name
    categories.forEach(cat => {
      cat.subcategories.sort((a, b) => {
        if (b.productCount !== a.productCount) {
          return b.productCount - a.productCount; // Higher count first
        }
        return a.name.localeCompare(b.name); // Then alphabetically
      });
    });

    return categories;
  } catch (error) {
    console.error('[ERROR] getDropdownCategories failed:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  getAllCategories,
  getCategoryBySlug,
  getCategoriesFlat,
  getCategoryIdsWithChildren,
  getCategoryIdsFromSlugs,
  getCategoryStats,
  getDropdownCategories
};

