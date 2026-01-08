# Category Dropdown API Documentation

## Overview
This API provides endpoints to fetch categories for the dropdown menu and products based on category/subcategory selection.

## Endpoints

### 1. Get Categories for Dropdown Menu

**Endpoint:** `GET /api/categories/dropdown`

**Description:** Returns all product types (main categories) with their associated style keywords (subcategories). This endpoint is specifically designed for the frontend category dropdown menu.

**Response Structure:**
```json
[
  {
    "id": 92,
    "name": "Sweatshirts",
    "slug": "sweatshirts",
    "displayOrder": 1,
    "productCount": 1500,
    "subcategories": [
      {
        "id": 18,
        "name": "crew neck",
        "slug": "crew-neck",
        "productCount": 250
      },
      {
        "id": 19,
        "name": "oversized",
        "slug": "oversized",
        "productCount": 180
      }
    ]
  },
  {
    "id": 51,
    "name": "Jackets",
    "slug": "jackets",
    "displayOrder": 1,
    "productCount": 2000,
    "subcategories": [
      {
        "id": 22,
        "name": "zipped",
        "slug": "zipped",
        "productCount": 300
      }
    ]
  }
]
```

**Example Request:**
```javascript
fetch('https://brandeduk-backend.onrender.com/api/categories/dropdown')
  .then(response => response.json())
  .then(data => {
    console.log('Categories:', data);
    // Use data to build your dropdown menu
  });
```

---

### 2. Get Products by Category/Subcategory

**Endpoint:** `GET /api/products`

**Description:** Fetch products filtered by product type (main category) and/or style keyword (subcategory).

**Query Parameters:**
- `productType` (string or array): Filter by product type name(s) (e.g., "Sweatshirts", "Jackets")
- `style` (string or array): Filter by style keyword slug(s) (e.g., "crew-neck", "zipped")
- `page` (number, default: 1): Page number for pagination
- `limit` (number, default: 24, max: 200): Items per page
- `sort` (string, default: "newest"): Sort field (price, name, newest)
- `order` (string, default: "desc"): Sort order (asc, desc)

**Response Structure:**
```json
{
  "items": [
    {
      "code": "TS004",
      "name": "Classic T-Shirt",
      "brand": "Brand Name",
      "price": 22.25,
      "priceBreaks": [
        { "quantity": 1, "price": 22.25 },
        { "quantity": 6, "price": 20.55 },
        { "quantity": 12, "price": 19.00 }
      ],
      "colors": [
        {
          "name": "Black",
          "slug": "black",
          "image": "https://..."
        }
      ],
      "sizes": ["S", "M", "L", "XL"],
      "image": "https://...",
      "tag": "New"
    }
  ],
  "page": 1,
  "limit": 24,
  "total": 150,
  "priceRange": {
    "min": 9.99,
    "max": 189.00
  }
}
```

**Example Requests:**

#### Get products by main category only:
```javascript
// Get all Sweatshirts
fetch('https://brandeduk-backend.onrender.com/api/products?productType=Sweatshirts&page=1&limit=24')
  .then(response => response.json())
  .then(data => {
    console.log('Products:', data.items);
    console.log('Total:', data.total);
  });
```

#### Get products by subcategory only:
```javascript
// Get all products with "crew-neck" style
fetch('https://brandeduk-backend.onrender.com/api/products?style=crew-neck&page=1&limit=24')
  .then(response => response.json())
  .then(data => {
    console.log('Products:', data.items);
  });
```

#### Get products by both category and subcategory:
```javascript
// Get Sweatshirts with crew-neck style
fetch('https://brandeduk-backend.onrender.com/api/products?productType=Sweatshirts&style=crew-neck&page=1&limit=24')
  .then(response => response.json())
  .then(data => {
    console.log('Products:', data.items);
  });
```

#### Get products by multiple subcategories:
```javascript
// Get products with either "crew-neck" or "oversized" style
fetch('https://brandeduk-backend.onrender.com/api/products?style=crew-neck&style=oversized&page=1&limit=24')
  .then(response => response.json())
  .then(data => {
    console.log('Products:', data.items);
  });
```

---

## Frontend Implementation Guide

### Step 1: Fetch Categories on Page Load

```javascript
async function loadCategories() {
  try {
    const response = await fetch('https://brandeduk-backend.onrender.com/api/categories/dropdown');
    const categories = await response.json();
    
    // Build your dropdown menu HTML
    buildDropdownMenu(categories);
  } catch (error) {
    console.error('Error loading categories:', error);
  }
}

function buildDropdownMenu(categories) {
  const menuContainer = document.querySelector('.category-menu');
  
  categories.forEach(category => {
    const categoryItem = document.createElement('li');
    categoryItem.className = 'has-children';
    
    categoryItem.innerHTML = `
      <a href="#" data-category-slug="${category.slug}" data-category-name="${category.name}">
        <span class="category-text">${category.name}</span>
        <span class="category-caret" aria-hidden="true"></span>
      </a>
      <ul class="megamenu">
        <li>
          <ul>
            ${category.subcategories.map(sub => `
              <li>
                <a href="#" 
                   data-category-slug="${category.slug}" 
                   data-subcategory-slug="${sub.slug}"
                   data-subcategory-name="${sub.name}">
                  ${sub.name}
                </a>
              </li>
            `).join('')}
          </ul>
        </li>
      </ul>
    `;
    
    menuContainer.appendChild(categoryItem);
  });
}
```

### Step 2: Handle Category/Subcategory Click

```javascript
// Handle main category click
document.addEventListener('click', async (e) => {
  const categoryLink = e.target.closest('[data-category-slug]');
  if (!categoryLink) return;
  
  const categorySlug = categoryLink.getAttribute('data-category-slug');
  const categoryName = categoryLink.getAttribute('data-category-name');
  const subcategorySlug = categoryLink.getAttribute('data-subcategory-slug');
  const subcategoryName = categoryLink.getAttribute('data-subcategory-name');
  
  // Build query parameters
  const params = new URLSearchParams();
  params.append('page', '1');
  params.append('limit', '24');
  
  if (categoryName) {
    params.append('productType', categoryName);
  }
  
  if (subcategorySlug) {
    params.append('style', subcategorySlug);
  }
  
  // Fetch products
  await loadProducts(params.toString());
});

async function loadProducts(queryParams) {
  try {
    const response = await fetch(
      `https://brandeduk-backend.onrender.com/api/products?${queryParams}`
    );
    const data = await response.json();
    
    // Display products
    displayProducts(data.items);
    updatePagination(data.page, data.total, data.limit);
  } catch (error) {
    console.error('Error loading products:', error);
  }
}
```

### Step 3: Update URL and Browser History (Optional)

```javascript
function updateURL(categorySlug, subcategorySlug) {
  const url = new URL(window.location);
  
  if (categorySlug) {
    url.searchParams.set('category', categorySlug);
  } else {
    url.searchParams.delete('category');
  }
  
  if (subcategorySlug) {
    url.searchParams.set('subcategory', subcategorySlug);
  } else {
    url.searchParams.delete('subcategory');
  }
  
  window.history.pushState({}, '', url);
}
```

### Step 4: Handle Pagination

```javascript
function updatePagination(currentPage, total, limit) {
  const totalPages = Math.ceil(total / limit);
  
  // Update pagination UI
  document.querySelector('.pagination').innerHTML = `
    ${Array.from({ length: totalPages }, (_, i) => i + 1).map(page => `
      <button 
        class="page-btn ${page === currentPage ? 'active' : ''}"
        data-page="${page}">
        ${page}
      </button>
    `).join('')}
  `;
  
  // Add click handlers
  document.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const page = btn.getAttribute('data-page');
      const params = new URLSearchParams(window.location.search);
      params.set('page', page);
      await loadProducts(params.toString());
    });
  });
}
```

---

## Important Notes

1. **Product Type Names**: Use the exact `name` from the category response (e.g., "Sweatshirts", "Jackets", "Shirts")

2. **Style Keyword Slugs**: Use the `slug` from subcategories (e.g., "crew-neck", "zipped", "oversized")

3. **Slug Normalization**: The API automatically normalizes style slugs (removes trailing "-1", "-2", etc.), so "crew-neck-1" becomes "crew-neck"

4. **Multiple Filters**: You can combine multiple filters:
   - Multiple product types: `?productType=Sweatshirts&productType=Jackets`
   - Multiple styles: `?style=crew-neck&style=oversized`
   - Both: `?productType=Sweatshirts&style=crew-neck`

5. **Empty Subcategories**: Some product types may have empty `subcategories` arrays. In this case, clicking the main category will show all products of that type.

6. **Product Counts**: The `productCount` field in the response shows how many products are available for each category/subcategory.

---

## Example: Complete Integration

```javascript
class CategoryDropdown {
  constructor() {
    this.categories = [];
    this.currentFilters = {
      productType: null,
      style: null
    };
    this.init();
  }
  
  async init() {
    await this.loadCategories();
    this.setupEventListeners();
  }
  
  async loadCategories() {
    try {
      const response = await fetch('/api/categories/dropdown');
      this.categories = await response.json();
      this.render();
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  }
  
  render() {
    const menu = document.querySelector('.category-menu');
    menu.innerHTML = this.categories.map(cat => `
      <li class="has-children">
        <a href="#" 
           data-action="category" 
           data-slug="${cat.slug}" 
           data-name="${cat.name}">
          <span class="category-text">${cat.name}</span>
          <span class="category-caret"></span>
        </a>
        ${cat.subcategories.length > 0 ? `
          <ul class="megamenu">
            <li>
              <ul>
                ${cat.subcategories.map(sub => `
                  <li>
                    <a href="#" 
                       data-action="subcategory" 
                       data-category-slug="${cat.slug}"
                       data-category-name="${cat.name}"
                       data-slug="${sub.slug}" 
                       data-name="${sub.name}">
                      ${sub.name}
                    </a>
                  </li>
                `).join('')}
              </ul>
            </li>
          </ul>
        ` : ''}
      </li>
    `).join('');
  }
  
  setupEventListeners() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-action]');
      if (!link) return;
      
      e.preventDefault();
      
      const action = link.getAttribute('data-action');
      
      if (action === 'category') {
        this.handleCategoryClick(link);
      } else if (action === 'subcategory') {
        this.handleSubcategoryClick(link);
      }
    });
  }
  
  handleCategoryClick(link) {
    const name = link.getAttribute('data-name');
    this.currentFilters.productType = name;
    this.currentFilters.style = null;
    this.loadProducts();
  }
  
  handleSubcategoryClick(link) {
    const categoryName = link.getAttribute('data-category-name');
    const styleSlug = link.getAttribute('data-slug');
    this.currentFilters.productType = categoryName;
    this.currentFilters.style = styleSlug;
    this.loadProducts();
  }
  
  async loadProducts() {
    const params = new URLSearchParams();
    params.append('page', '1');
    params.append('limit', '24');
    
    if (this.currentFilters.productType) {
      params.append('productType', this.currentFilters.productType);
    }
    
    if (this.currentFilters.style) {
      params.append('style', this.currentFilters.style);
    }
    
    try {
      const response = await fetch(`/api/products?${params.toString()}`);
      const data = await response.json();
      this.displayProducts(data);
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  }
  
  displayProducts(data) {
    // Update your product grid
    const productGrid = document.querySelector('.product-grid');
    productGrid.innerHTML = data.items.map(product => `
      <div class="product-card">
        <img src="${product.image}" alt="${product.name}">
        <h3>${product.name}</h3>
        <p class="price">£${product.price}</p>
        <a href="/product/${product.code}">View Details</a>
      </div>
    `).join('');
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  new CategoryDropdown();
});
```

---

## API Base URL

- **Production**: `https://brandeduk-backend.onrender.com`
- **Local Development**: `http://localhost:3000`

---

## Support

If you encounter any issues or need clarification, please contact the backend team.

