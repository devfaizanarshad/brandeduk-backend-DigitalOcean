const express = require('express');
const router = express.Router();
const { getAllCategories, getCategoryBySlug, getCategoriesFlat, getCategoryStats, getDropdownCategories } = require('../services/categoryService');
const cache = require('../services/cacheService');

/**
 * Route-level caching middleware for all category GET requests.
 * Categories rarely change, so caching them for 7 days + admin flush is excellent.
 */
router.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const rawKey = `categories:route:${req.originalUrl}`;
  let hash = 0;
  for (let i = 0; i < rawKey.length; i++) {
    const char = rawKey.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const cacheKey = `categories:route:${Math.abs(hash)}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
  } catch (err) {
    console.warn(`[CACHE] Categories middleware get error:`, err.message);
  }

  const originalJson = res.json.bind(res);
  res.json = (data) => {
    if (res.statusCode < 400) {
      cache.set(cacheKey, data, cache.TTL.CATEGORIES).catch(err => {
        console.warn(`[CACHE] Categories middleware set error:`, err.message);
      });
    }
    return originalJson(data);
  };

  next();
});

/**
 * GET /api/categories
 * Get all categories with hierarchical structure (parent categories with subcategories)
 * 
 * Query Parameters:
 * - format: 'hierarchical' (default) or 'flat' - determines response format
 * 
 * Response (hierarchical):
 * [
 *   {
 *     id: 1,
 *     name: "T-Shirts",
 *     slug: "t-shirts",
 *     parentId: null,
 *     displayOrder: 0,
 *     subcategories: [
 *       {
 *         id: 2,
 *         name: "Crew Neck",
 *         slug: "crew-neck",
 *         parentId: 1,
 *         displayOrder: 0,
 *         subcategories: []
 *       },
 *       ...
 *     ]
 *   },
 *   ...
 * ]
 */
router.get('/', async (req, res) => {
  try {
    const { format = 'hierarchical' } = req.query;

    let categories;
    if (format === 'flat') {
      categories = await getCategoriesFlat();
    } else {
      categories = await getAllCategories();
    }

    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      error: 'Failed to fetch categories',
      message: error.message
    });
  }
});

/**
 * GET /api/categories/stats
 * Get diagnostic information about category structure
 * Useful for debugging why subcategories might be empty
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getCategoryStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching category stats:', error);
    res.status(500).json({
      error: 'Failed to fetch category stats',
      message: error.message
    });
  }
});

/**
 * GET /api/categories/dropdown
 * Get categories for dropdown menu
 * Returns product types (main categories) with their associated style keywords (subcategories)
 * This endpoint is specifically designed for the frontend category dropdown menu
 * 
 * Response:
 * [
 *   {
 *     id: 92,
 *     name: "Sweatshirts",
 *     slug: "sweatshirts",
 *     displayOrder: 1,
 *     subcategories: [
 *       {
 *         id: 18,
 *         name: "crew neck",
 *         slug: "crew-neck",
 *         productCount: 150
 *       },
 *       ...
 *     ]
 *   },
 *   ...
 * ]
 */
router.get('/dropdown', async (req, res) => {
  try {
    const categories = await getDropdownCategories();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching dropdown categories:', error);
    res.status(500).json({
      error: 'Failed to fetch dropdown categories',
      message: error.message
    });
  }
});

/**
 * GET /api/categories/:slug
 * Get a single category by slug with its subcategories
 * 
 * Response:
 * {
 *   id: 1,
 *   name: "T-Shirts",
 *   slug: "t-shirts",
 *   parentId: null,
 *   displayOrder: 0,
 *   subcategories: [...]
 * }
 */
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    // Special routes
    if (slug === 'stats') {
      return res.redirect('/api/categories/stats');
    }

    if (slug === 'dropdown') {
      // This should be handled by the route above, but handle it here as fallback
      const categories = await getDropdownCategories();
      return res.json(categories);
    }

    const category = await getCategoryBySlug(slug);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(category);
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({
      error: 'Failed to fetch category',
      message: error.message
    });
  }
});

module.exports = router;

