# Admin API Documentation

**Complete guide for frontend admin panel implementation**

---

## Table of Contents

1. [Overview](#overview)
2. [Base URL & Authentication](#base-url--authentication)
3. [Generic CRUD Endpoints](#generic-crud-endpoints)
4. [Product Pricing Endpoints](#product-pricing-endpoints)
5. [Pricing Rules Management](#pricing-rules-management)
6. [Display Order Management](#display-order-management)
7. [Common Workflows](#common-workflows)
8. [Error Handling](#error-handling)
9. [Important Notes](#important-notes)
10. [Swagger Documentation](#swagger-documentation)

---

## Overview

This API provides **full CRUD access** to all database tables for admin panel use. All endpoints are **public** (no authentication required - use carefully in production).

### Key Features

- ✅ **Generic CRUD** for any table in the database
- ✅ **Product pricing management** with real-time preview
- ✅ **Pricing rules** management
- ✅ **Display order** management
- ✅ **Automatic sell_price calculation** from carton_price + pricing rules
- ✅ **Materialized view refresh** for instant search updates

---

## Base URL & Authentication

**Base URL:**
```
Production: https://api.brandeduk.com
Development: http://localhost:3004
```

**Authentication:**
- ❌ **No authentication required** - all admin endpoints are public
- ⚠️ **Important:** Consider adding authentication middleware in production

**Headers:**
```javascript
{
  "Content-Type": "application/json",
  "Accept": "application/json"
}
```

---

## Generic CRUD Endpoints

These endpoints work for **any table** in your database. They assume tables have an `id` primary key column.

### 1. List All Tables

Get a list of all available tables in the database.

**Endpoint:** `GET /api/admin/tables`

**Response:**
```json
{
  "tables": [
    "products",
    "pricing_rules",
    "brands",
    "categories",
    "styles",
    "sizes",
    "colors",
    ...
  ]
}
```

**Example:**
```javascript
const response = await fetch('http://localhost:3004/api/admin/tables');
const data = await response.json();
console.log(data.tables); // Array of table names
```

---

### 2. List Rows from a Table

Get paginated list of rows from any table.

**Endpoint:** `GET /api/admin/{table}`

**Query Parameters:**
- `limit` (optional, default: 100, max: 500) - Number of rows to return
- `offset` (optional, default: 0) - Number of rows to skip

**Example:**
```javascript
// Get first 50 products
const response = await fetch('http://localhost:3004/api/admin/products?limit=50&offset=0');
const data = await response.json();
console.log(data.items); // Array of product objects
console.log(data.limit); // 50
console.log(data.offset); // 0
```

**Response:**
```json
{
  "items": [
    {
      "id": 1,
      "style_code": "GD002",
      "carton_price": 4.65,
      "sell_price": 10.55,
      "sku_status": "Live",
      ...
    },
    ...
  ],
  "limit": 50,
  "offset": 0
}
```

**Common Tables:**
- `/api/admin/products` - All products
- `/api/admin/pricing_rules` - Pricing rules
- `/api/admin/brands` - Brands
- `/api/admin/categories` - Categories
- `/api/admin/styles` - Product styles
- `/api/admin/sizes` - Size options
- `/api/admin/colors` - Color options
- `/api/admin/genders` - Gender options
- `/api/admin/product_types` - Product types

---

### 3. Get Single Row by ID

Get a single row from any table by its `id`.

**Endpoint:** `GET /api/admin/{table}/{id}`

**Example:**
```javascript
// Get product with id 123
const response = await fetch('http://localhost:3004/api/admin/products/123');
const product = await response.json();
console.log(product); // Single product object
```

**Response:**
```json
{
  "id": 123,
  "style_code": "GD002",
  "carton_price": 4.65,
  "sell_price": 10.55,
  "sku_status": "Live",
  "created_at": "2024-01-15T10:30:00.000Z",
  ...
}
```

**Error (404):**
```json
{
  "error": "Not found",
  "message": "Row not found"
}
```

---

### 4. Create New Row

Insert a new row into any table.

**Endpoint:** `POST /api/admin/{table}`

**Request Body:**
- Keys in the body become column names
- Values are inserted directly (make sure they match column types)

**Example:**
```javascript
// Create a new brand
const response = await fetch('http://localhost:3004/api/admin/brands', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: "Nike",
    slug: "nike"
  })
});

const data = await response.json();
console.log(data.data); // Created brand object with id
```

**Response (201):**
```json
{
  "message": "Row created",
  "data": {
    "id": 456,
    "name": "Nike",
    "slug": "nike",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**Example - Create Pricing Rule:**
```javascript
const response = await fetch('http://localhost:3004/api/admin/pricing_rules', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version: "1.0",
    from_price: 10.00,
    to_price: 14.99,
    markup_percent: 127.00,
    active: true
  })
});
```

---

### 5. Update Row by ID

Update existing row in any table.

**Endpoint:** `PUT /api/admin/{table}/{id}`

**Request Body:**
- Only include fields you want to update
- Keys become column names

**Example:**
```javascript
// Update product carton_price
const response = await fetch('http://localhost:3004/api/admin/products/123', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    carton_price: 5.50,
    sku_status: "Live"
  })
});

const data = await response.json();
console.log(data.data); // Updated product object
```

**Response (200):**
```json
{
  "message": "Row updated",
  "data": {
    "id": 123,
    "style_code": "GD002",
    "carton_price": 5.50,
    "sku_status": "Live",
    ...
  }
}
```

**Error (404):**
```json
{
  "error": "Not found",
  "message": "Row not found"
}
```

---

### 6. Delete Row by ID

Delete a row from any table.

**Endpoint:** `DELETE /api/admin/{table}/{id}`

**Example:**
```javascript
// Delete product with id 123
const response = await fetch('http://localhost:3004/api/admin/products/123', {
  method: 'DELETE'
});

const data = await response.json();
console.log(data.data); // Deleted product object
```

**Response (200):**
```json
{
  "message": "Row deleted",
  "data": {
    "id": 123,
    "style_code": "GD002",
    ...
  }
}
```

**Error (404):**
```json
{
  "error": "Not found",
  "message": "Row not found"
}
```

---

## Product Pricing Endpoints

These endpoints handle product pricing with automatic `sell_price` calculation from `carton_price` + pricing rules.

### 1. Preview Sell Price (Real-time)

Preview what `sell_price` would be for a given `carton_price` **without modifying the database**.

**Endpoint:** `GET /api/admin/products/{code}/price-preview`

**Query Parameters:**
- `carton_price` (required) - Proposed carton price to preview

**Example:**
```javascript
// Preview sell_price for carton_price = 4.65
const response = await fetch(
  'http://localhost:3004/api/admin/products/GD002/price-preview?carton_price=4.65'
);
const preview = await response.json();
console.log(preview.sell_price); // Calculated sell_price
```

**Response:**
```json
{
  "style_code": "GD002",
  "carton_price": 4.65,
  "sell_price": 10.55,
  "markup_percent": 127.00,
  "pricing_rule": {
    "version": "1.0",
    "from_price": 10.00,
    "to_price": 14.99,
    "markup_percent": 127.00
  }
}
```

**Use Case:**
- Show live preview in admin UI when user types a new carton_price
- Debounce API calls (e.g., wait 500ms after user stops typing)

**Example Implementation:**
```javascript
// React example with debouncing
const [cartonPrice, setCartonPrice] = useState(4.65);
const [preview, setPreview] = useState(null);

useEffect(() => {
  const timer = setTimeout(async () => {
    const response = await fetch(
      `/api/admin/products/GD002/price-preview?carton_price=${cartonPrice}`
    );
    const data = await response.json();
    setPreview(data);
  }, 500); // Wait 500ms after user stops typing

  return () => clearTimeout(timer);
}, [cartonPrice]);
```

---

### 2. Update Carton Price (Apply Changes)

Update `carton_price` for all live SKUs of a style code and automatically recalculate `sell_price` from active pricing rules.

**Endpoint:** `PUT /api/admin/products/{code}/carton-price`

**Request Body:**
```json
{
  "carton_price": 4.65
}
```

**Example:**
```javascript
// Update carton_price for style GD002
const response = await fetch(
  'http://localhost:3004/api/admin/products/GD002/carton-price',
  {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      carton_price: 4.65
    })
  }
);

const data = await response.json();
console.log(data.updatedCount); // Number of SKUs updated
console.log(data.items); // Array of updated products
```

**Response:**
```json
{
  "message": "carton_price and sell_price updated successfully",
  "updatedCount": 45,
  "materializedViewRefreshed": true,
  "refreshError": null,
  "items": [
    {
      "id": 123,
      "style_code": "GD002",
      "carton_price": 4.65,
      "sell_price": 10.55,
      "pricing_version": "1.0",
      "last_priced_at": "2024-01-15T10:30:00.000Z"
    },
    ...
  ]
}
```

**What Happens:**
1. ✅ Updates `carton_price` for all Live SKUs with this `style_code`
2. ✅ Recalculates `sell_price` using active pricing rules
3. ✅ Sets `pricing_version` to active rule version
4. ✅ Updates `last_priced_at` timestamp
5. ✅ Refreshes `product_search_materialized` view (for search/filters)
6. ✅ Clears API caches (for instant visibility)

**Important:**
- Only updates products with `sku_status = 'Live'`
- Updates **all SKUs** (colors/sizes) for the style code
- Materialized view refresh may take a few seconds (happens in background)

---

## Pricing Rules Management

Manage pricing rules that determine how `sell_price` is calculated from `carton_price`.

### 1. List Pricing Rules

**Endpoint:** `GET /api/pricing/rules`

**Query Parameters:**
- `active` (optional) - Set to `"true"` to only get active rules

**Example:**
```javascript
// Get all pricing rules
const response = await fetch('http://localhost:3004/api/pricing/rules');
const data = await response.json();

// Get only active rules
const activeResponse = await fetch('http://localhost:3004/api/pricing/rules?active=true');
const activeData = await activeResponse.json();
```

**Response:**
```json
{
  "items": [
    {
      "version": "1.0",
      "from_price": 0.01,
      "to_price": 1.99,
      "markup_percent": 195.00,
      "active": true
    },
    {
      "version": "1.0",
      "from_price": 2.00,
      "to_price": 2.99,
      "markup_percent": 75.00,
      "active": true
    },
    ...
  ]
}
```

---

### 2. Create Pricing Rule

**Endpoint:** `POST /api/pricing/rules`

**Request Body:**
```json
{
  "version": "1.0",
  "from_price": 10.00,
  "to_price": 14.99,
  "markup_percent": 127.00,
  "active": true
}
```

**Example:**
```javascript
const response = await fetch('http://localhost:3004/api/pricing/rules', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version: "1.0",
    from_price: 10.00,
    to_price: 14.99,
    markup_percent: 127.00,
    active: true
  })
});

const data = await response.json();
```

**Response (201):**
```json
{
  "message": "Pricing rule created successfully",
  "data": {
    "version": "1.0",
    "from_price": 10.00,
    "to_price": 14.99,
    "markup_percent": 127.00,
    "active": true
  }
}
```

**Validation:**
- `from_price`, `to_price`, `markup_percent` are required
- `to_price` must be >= `from_price`
- All values must be valid numbers
- `active` defaults to `false` if not provided

---

### 3. Update Pricing Rule

**Endpoint:** `PUT /api/pricing/rules/{id}`

**Note:** The `{id}` parameter is a composite key in format: `version:from_price:to_price`

**Example:**
```javascript
// Update rule with composite key "1.0:10.00:14.99"
const response = await fetch('http://localhost:3004/api/pricing/rules/1.0:10.00:14.99', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    markup_percent: 120.00,
    active: true
  })
});
```

**Alternative (using body):**
```javascript
const response = await fetch('http://localhost:3004/api/pricing/rules/1.0:10.00:14.99', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    originalVersion: "1.0",
    originalFromPrice: 10.00,
    originalToPrice: 14.99,
    markup_percent: 120.00,
    active: true
  })
});
```

**Response:**
```json
{
  "message": "Pricing rule updated successfully",
  "data": {
    "version": "1.0",
    "from_price": 10.00,
    "to_price": 14.99,
    "markup_percent": 120.00,
    "active": true
  }
}
```

---

### 4. Bulk Reprice All Products

Recalculate `sell_price` for **all products** using current active pricing rules.

**Endpoint:** `POST /api/pricing/reprice`

**Example:**
```javascript
const response = await fetch('http://localhost:3004/api/pricing/reprice', {
  method: 'POST'
});

const data = await response.json();
console.log(data.updatedProducts); // Number of products updated
```

**Response:**
```json
{
  "message": "Repricing job completed",
  "updatedProducts": 99700,
  "materializedViewRefreshed": true,
  "refreshError": null
}
```

**What Happens:**
1. ✅ Finds active pricing rules
2. ✅ For each product, calculates `sell_price` from `carton_price` (or `single_price`) + markup
3. ✅ Updates `pricing_version` and `last_priced_at`
4. ✅ Refreshes materialized view
5. ✅ Clears caches

**Performance:**
- May take 1-5 minutes for large databases
- Materialized view refresh adds additional time
- Consider showing a loading indicator in admin UI

---

## Display Order Management

Manage custom display order for products by brand and product type.

### List Display Orders

**Endpoint:** `GET /api/display-order`

**Query Parameters:**
- `brand_id` (optional) - Filter by brand ID
- `product_type_id` (optional) - Filter by product type ID
- `style_code` (optional) - Filter by style code (partial match)
- `page` (optional, default: 1)
- `limit` (optional, default: 50)

**Example:**
```javascript
const response = await fetch('http://localhost:3004/api/display-order?brand_id=28&limit=100');
const data = await response.json();
```

---

### Create/Update Display Order

**Endpoint:** `POST /api/display-order`

**Request Body:**
```json
{
  "style_code": "YP047",
  "brand_id": 28,
  "product_type_id": 21,
  "display_order": 1
}
```

---

### Bulk Update Display Orders

**Endpoint:** `POST /api/display-order/bulk`

**Request Body:**
```json
{
  "brand_id": 28,
  "product_type_id": 21,
  "orders": [
    { "style_code": "YP047", "display_order": 1 },
    { "style_code": "YP049", "display_order": 2 }
  ]
}
```

---

## Common Workflows

### Workflow 1: Update Product Carton Price

**Step-by-step:**

1. **Show preview** as user types:
   ```javascript
   // User types carton_price = 4.65
   const preview = await fetch(
     `/api/admin/products/GD002/price-preview?carton_price=4.65`
   ).then(r => r.json());
   
   // Display: "Sell price will be: £10.55"
   ```

2. **Apply changes** when user clicks "Save":
   ```javascript
   const result = await fetch(`/api/admin/products/GD002/carton-price`, {
     method: 'PUT',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ carton_price: 4.65 })
   }).then(r => r.json());
   
   // Show success: "Updated 45 SKUs. Sell price: £10.55"
   ```

---

### Workflow 2: Change Pricing Rules and Reprice

**Step-by-step:**

1. **List current rules:**
   ```javascript
   const rules = await fetch('/api/pricing/rules?active=true')
     .then(r => r.json());
   ```

2. **Update a rule:**
   ```javascript
   await fetch('/api/pricing/rules/1.0:10.00:14.99', {
     method: 'PUT',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       markup_percent: 120.00  // Changed from 127.00
     })
   });
   ```

3. **Reprice all products:**
   ```javascript
   const result = await fetch('/api/pricing/reprice', {
     method: 'POST'
   }).then(r => r.json());
   
   // Show: "Repriced 99,700 products. This may take a few minutes..."
   ```

---

### Workflow 3: Create New Product

**Step-by-step:**

1. **Create style** (if needed):
   ```javascript
   const style = await fetch('/api/admin/styles', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       style_code: "NEW001",
       style_name: "New Product",
       brand_id: 28,
       product_type_id: 21
     })
   }).then(r => r.json());
   ```

2. **Create product SKUs:**
   ```javascript
   // Create product for each color/size combination
   await fetch('/api/admin/products', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       style_code: "NEW001",
       carton_price: 5.00,
       single_price: 5.00,
       sku_status: "Live",
       size_id: 1,
       colour_id: 1
     })
   });
   ```

3. **Set carton price** (auto-calculates sell_price):
   ```javascript
   await fetch('/api/admin/products/NEW001/carton-price', {
     method: 'PUT',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ carton_price: 5.00 })
   });
   ```

---

## Error Handling

All endpoints return consistent error responses:

### 400 Bad Request
```json
{
  "error": "Bad request",
  "message": "carton_price is required"
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "message": "No matching live products found for this style_code"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "Database connection failed"
}
```

### Example Error Handling:
```javascript
try {
  const response = await fetch('/api/admin/products/GD002/carton-price', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carton_price: 4.65 })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Request failed');
  }

  const data = await response.json();
  console.log('Success:', data.message);
} catch (error) {
  console.error('Error:', error.message);
  // Show error to user
}
```

---

## Important Notes

### 1. Pricing Logic

**Key Principle:** `sell_price` is **always** calculated from `carton_price` + active pricing rules.

**Formula:**
```
sell_price = carton_price × (1 + markup_percent / 100)
```

**Important:**
- ❌ **Never** update `sell_price` directly (endpoint is disabled)
- ✅ **Always** update `carton_price` via `/api/admin/products/{code}/carton-price`
- ✅ When you change pricing rules, run `/api/pricing/reprice` to update all products
- ✅ Changes are **immediately visible** after materialized view refresh

---

### 2. Table Names

- Use **lowercase** table names: `products`, `pricing_rules`, `brands`
- Table names must match exactly (case-sensitive)
- Use `GET /api/admin/tables` to see all available tables

---

### 3. ID Columns

- Generic CRUD endpoints assume tables have an `id` primary key column
- Tables with **composite keys** (like `pricing_rules`) use special endpoints:
  - Use `/api/pricing/rules` endpoints instead of `/api/admin/pricing_rules/{id}`

---

### 4. Materialized View Refresh

- Happens automatically after carton price updates and repricing
- May take **5-30 seconds** for large databases
- Search/filter endpoints use the materialized view, so changes may not appear immediately
- Check `materializedViewRefreshed` in response to confirm refresh status

---

### 5. Pagination

- Default limit: **100 rows**
- Maximum limit: **500 rows**
- Use `offset` for pagination:
  ```javascript
  // Page 1: offset=0, limit=100
  // Page 2: offset=100, limit=100
  // Page 3: offset=200, limit=100
  ```

---

### 6. Product Status

- Only products with `sku_status = 'Live'` are:
  - Updated by carton price endpoint
  - Included in search results
  - Visible to customers

---

## Swagger Documentation

**Interactive API documentation** is available at:

```
http://localhost:3004/api-docs
```

**Features:**
- ✅ Try all endpoints directly in browser
- ✅ See request/response examples
- ✅ View all available endpoints
- ✅ Copy curl commands

**How to Use:**
1. Open `http://localhost:3004/api-docs` in browser
2. Find endpoint you want to use
3. Click "Try it out"
4. Fill in parameters
5. Click "Execute"
6. See response

**Swagger File:**
- Location: `swagger.yaml` in project root
- Share this file with frontend developer for API reference

---

## Quick Reference

### Most Used Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/tables` | GET | List all tables |
| `/api/admin/{table}` | GET | List rows |
| `/api/admin/{table}/{id}` | GET | Get single row |
| `/api/admin/{table}` | POST | Create row |
| `/api/admin/{table}/{id}` | PUT | Update row |
| `/api/admin/{table}/{id}` | DELETE | Delete row |
| `/api/admin/products/{code}/price-preview` | GET | Preview sell_price |
| `/api/admin/products/{code}/carton-price` | PUT | Update carton_price |
| `/api/pricing/rules` | GET | List pricing rules |
| `/api/pricing/rules` | POST | Create pricing rule |
| `/api/pricing/rules/{id}` | PUT | Update pricing rule |
| `/api/pricing/reprice` | POST | Reprice all products |

---

## Support

For questions or issues:
1. Check Swagger docs: `http://localhost:3004/api-docs`
2. Review error messages (they're descriptive)
3. Check server logs for detailed error information

---

**Last Updated:** January 2025
**API Version:** 1.0.0
