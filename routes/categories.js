const express = require('express');
const router = express.Router();
const { getAllCategories, getCategoryBySlug, getCategoriesFlat, getCategoryStats } = require('../services/categoryService');

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
    
    // Special route for stats
    if (slug === 'stats') {
      return res.redirect('/api/categories/stats');
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

