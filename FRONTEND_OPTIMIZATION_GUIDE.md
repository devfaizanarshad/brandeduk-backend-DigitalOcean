# Frontend Integration Guide - Filters & Products

## ⚠️ IMPORTANT: Filters Are Now Separate

The `/api/products` endpoint **no longer returns filters**. You must load filters separately from `/api/products/filters`.

## How It Works

### 1. **Products Endpoint** (Fast - 1-3 seconds)
```
GET /api/products?q=tshirt&page=1&limit=28&gender=female
Response: { items, total, priceRange }
```
- ✅ Returns products instantly
- ✅ Cached for 5 minutes (search) or 30 minutes (browse)
- ❌ Does NOT return filters anymore

### 2. **Filters Endpoint** (Separate - 1-10 seconds first time, instant after)
```
GET /api/products/filters?q=tshirt&gender=female
Response: { filters: { gender, ageGroup, sleeve, neckline, fabric, size, feature, tag } }
```
- ✅ Returns filter counts/aggregations
- ✅ Cached for 30 minutes
- ✅ Uses the SAME filter parameters as products endpoint

## How Filters Stay in Sync

**Both endpoints use the SAME filter parameters**, so they're always in sync:

```javascript
// Same parameters for both
const params = {
  q: 'tshirt',
  gender: ['female'],
  priceMin: 10,
  priceMax: 50
};

// Products endpoint
GET /api/products?q=tshirt&gender=female&priceMin=10&priceMax=50

// Filters endpoint (same params)
GET /api/products/filters?q=tshirt&gender=female&priceMin=10&priceMax=50
```

**When both are cached:**
- First search: Products = 1-3s, Filters = 1-10s
- Second search (same params): Products = **instant**, Filters = **instant** ⚡

## Recommended Frontend Implementation

### Option 1: Load Both in Parallel (Recommended)

```javascript
async function loadProductsAndFilters(filters) {
  // Build query string from filters object
  const queryParams = new URLSearchParams();
  if (filters.q) queryParams.append('q', filters.q);
  if (filters.gender) filters.gender.forEach(g => queryParams.append('gender', g));
  if (filters.priceMin) queryParams.append('priceMin', filters.priceMin);
  if (filters.priceMax) queryParams.append('priceMax', filters.priceMax);
  // ... add all other filters
  
  const queryString = queryParams.toString();
  
  // Load both in parallel
  const [productsRes, filtersRes] = await Promise.all([
    fetch(`/api/products?${queryString}&page=1&limit=28`),
    fetch(`/api/products/filters?${queryString}`)
  ]);
  
  const productsData = await productsRes.json();
  const filtersData = await filtersRes.json();
  
  // Show products immediately
  renderProducts(productsData.items);
  
  // Update filter counts
  updateFilterCounts(filtersData.filters);
  
  return {
    items: productsData.items,
    total: productsData.total,
    priceRange: productsData.priceRange,
    filters: filtersData.filters
  };
}
```

### Option 2: Load Products First, Filters Second (Better UX)

```javascript
async function loadProductsAndFilters(filters) {
  const queryString = buildQueryString(filters);
  
  // Load products first (show immediately)
  const productsRes = await fetch(`/api/products?${queryString}&page=1&limit=28`);
  const productsData = await productsRes.json();
  
  // Show products immediately
  renderProducts(productsData.items);
  
  // Load filters in background (non-blocking)
  fetch(`/api/products/filters?${queryString}`)
    .then(res => res.json())
    .then(data => {
      // Update filter counts when ready
      updateFilterCounts(data.filters);
    })
    .catch(err => {
      console.error('Failed to load filters:', err);
      // Filters will work without counts
    });
  
  return productsData;
}
```

### Option 3: Cache Filters on Frontend

```javascript
// Simple in-memory cache
const filterCache = new Map();

async function getFilters(filters) {
  const cacheKey = JSON.stringify(filters);
  
  // Check cache first
  if (filterCache.has(cacheKey)) {
    return filterCache.get(cacheKey);
  }
  
  // Fetch from API
  const queryString = buildQueryString(filters);
  const res = await fetch(`/api/products/filters?${queryString}`);
  const data = await res.json();
  
  // Cache for 5 minutes
  filterCache.set(cacheKey, data.filters);
  setTimeout(() => filterCache.delete(cacheKey), 5 * 60 * 1000);
  
  return data.filters;
}
```

## Filter Update Behavior

### When Filters Update:

1. **User changes search query** → Both products AND filters update
2. **User applies a filter** → Both products AND filters update with new params
3. **User removes a filter** → Both products AND filters update with new params

### Cache Behavior:

- **First request** (not cached):
  - Products: 1-3 seconds
  - Filters: 1-10 seconds (depending on complexity)
  
- **Second request** (same params, cached):
  - Products: **Instant** ⚡
  - Filters: **Instant** ⚡

- **Different params** (not cached):
  - Products: 1-3 seconds
  - Filters: 1-10 seconds

## Example: Complete Implementation

```javascript
class ProductLoader {
  constructor() {
    this.currentFilters = {};
    this.currentPage = 1;
  }
  
  async load(filters = {}, page = 1) {
    this.currentFilters = filters;
    this.currentPage = page;
    
    const queryString = this.buildQueryString(filters, page);
    
    // Load products first
    const productsPromise = fetch(`/api/products?${queryString}`);
    
    // Load filters in parallel
    const filtersPromise = fetch(`/api/products/filters?${queryString}`);
    
    // Show products immediately
    const productsRes = await productsPromise;
    const productsData = await productsRes.json();
    this.renderProducts(productsData.items);
    this.updatePagination(productsData.total, page);
    this.updatePriceRange(productsData.priceRange);
    
    // Update filters when ready
    try {
      const filtersRes = await filtersPromise;
      const filtersData = await filtersRes.json();
      this.updateFilterCounts(filtersData.filters);
    } catch (err) {
      console.error('Failed to load filters:', err);
    }
  }
  
  buildQueryString(filters, page) {
    const params = new URLSearchParams();
    
    // Search
    if (filters.q) params.append('q', filters.q);
    
    // Filters
    if (filters.gender) filters.gender.forEach(g => params.append('gender', g));
    if (filters.ageGroup) filters.ageGroup.forEach(a => params.append('ageGroup', a));
    if (filters.sleeve) filters.sleeve.forEach(s => params.append('sleeve', s));
    if (filters.neckline) filters.neckline.forEach(n => params.append('neckline', n));
    if (filters.fabric) filters.fabric.forEach(f => params.append('fabric', f));
    if (filters.size) filters.size.forEach(s => params.append('size', s));
    if (filters.tag) filters.tag.forEach(t => params.append('tag', t));
    if (filters.productType) filters.productType.forEach(p => params.append('productType', p));
    
    // Price
    if (filters.priceMin) params.append('priceMin', filters.priceMin);
    if (filters.priceMax) params.append('priceMax', filters.priceMax);
    
    // Pagination
    params.append('page', page);
    params.append('limit', 28);
    
    return params.toString();
  }
  
  renderProducts(items) {
    // Your product rendering logic
  }
  
  updateFilterCounts(filters) {
    // Update filter UI with counts
    // Example: Update "Female (192)" text
    Object.keys(filters).forEach(filterType => {
      const counts = filters[filterType];
      Object.keys(counts).forEach(value => {
        const count = counts[value];
        this.updateFilterLabel(filterType, value, count);
      });
    });
  }
  
  updateFilterLabel(filterType, value, count) {
    // Find the filter checkbox/label and update count
    const element = document.querySelector(
      `input[name="${filterType}"][value="${value}"]`
    );
    if (element) {
      const label = element.nextElementSibling;
      if (label) {
        const labelText = label.textContent.split('(')[0].trim();
        label.textContent = `${labelText} (${count})`;
      }
    }
  }
  
  updatePagination(total, page) {
    // Update pagination UI
  }
  
  updatePriceRange(priceRange) {
    // Update price range display
  }
}

// Usage
const loader = new ProductLoader();

// Initial load
loader.load({ q: 'tshirt' }, 1);

// When user applies filter
document.getElementById('applyFilters').addEventListener('click', () => {
  const filters = getFiltersFromUI();
  loader.load(filters, 1);
});

// When user searches
document.getElementById('searchInput').addEventListener('input', (e) => {
  const query = e.target.value;
  loader.load({ q: query }, 1);
});
```

## Key Points for Your Frontend Developer

1. ✅ **Products endpoint is fast** - Returns in 1-3 seconds
2. ✅ **Filters endpoint is separate** - Must call `/api/products/filters` separately
3. ✅ **Use same parameters** - Both endpoints use identical query parameters
4. ✅ **Both are cached** - Second request with same params = instant
5. ✅ **Filters update automatically** - When params change, filters update
6. ✅ **Load in parallel** - Use `Promise.all()` for best performance

## Performance Expectations

| Scenario | Products | Filters | Total |
|----------|----------|---------|-------|
| First search (not cached) | 1-3s | 1-10s | 1-10s |
| Second search (cached) | Instant | Instant | Instant |
| Different search (not cached) | 1-3s | 1-10s | 1-10s |
| Different search (cached) | Instant | Instant | Instant |

## Troubleshooting

**Q: Filters are empty/not updating?**
- Make sure you're calling `/api/products/filters` with the same parameters
- Check that filter parameters match exactly (case-sensitive slugs)

**Q: Filters are slow?**
- First request is always slower (1-10s)
- Second request with same params should be instant (cached)
- If still slow, check network tab for actual response times

**Q: How do I know when filters are cached?**
- First request: Check response time (1-10s)
- Second request: Should be instant (<100ms)
- Backend logs show `[CACHE] Hit` when cached
