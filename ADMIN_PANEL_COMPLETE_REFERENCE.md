# Admin Panel – Complete API Reference

**Single reference for building the admin panel. All endpoints, request/response shapes, and rules.**

---

## Base URL & Headers

| Environment | Base URL |
|-------------|----------|
| Development | `http://localhost:3004` |
| Production  | `https://api.brandeduk.com` |

**Headers:**
```http
Content-Type: application/json
Accept: application/json
```

**Authentication:** None (all admin endpoints are public). Add auth in production.

---

## Quick Endpoint Index

| Section | Prefix | Purpose |
|---------|--------|---------|
| [Generic CRUD](#1-generic-crud) | `/api/admin` | Any table: list, get, create, update, delete |
| [Products (Admin)](#2-products-admin) | `/api/admin/products` | Search, by-style, stats, bulk, pricing |
| [Dashboard & Tables](#3-dashboard--tables) | `/api/admin` | Tables list, table count/columns, generic search |
| [Pricing Rules](#4-pricing-rules) | `/api/pricing` | Rules CRUD, reprice all |
| [Display Order](#5-display-order) | `/api/display-order` | Order by brand/type, bulk, brands/types |

---

# 1. Generic CRUD

Works for **any** table that has an `id` primary key. Use lowercase table names.

### 1.1 List all tables

```http
GET /api/admin/tables
```

**Response 200**
```json
{
  "tables": ["products", "pricing_rules", "brands", "categories", "styles", "sizes", "colors", ...]
}
```

---

### 1.2 List rows (paginated)

```http
GET /api/admin/{table}?limit=100&offset=0
```

| Query   | Type   | Default | Description        |
|---------|--------|---------|--------------------|
| `limit` | number | 100     | Rows per page (max 500) |
| `offset`| number | 0       | Rows to skip       |

**Response 200**
```json
{
  "items": [ { "id": 1, "name": "...", ... } ],
  "limit": 100,
  "offset": 0
}
```

**Common tables:** `products`, `pricing_rules`, `brands`, `categories`, `styles`, `sizes`, `colors`, `genders`, `product_types`

---

### 1.3 Get single row by ID

```http
GET /api/admin/{table}/{id}
```

**Response 200** – Single row object.

**Response 404**
```json
{ "error": "Not found", "message": "Row not found" }
```

---

### 1.4 Create row

```http
POST /api/admin/{table}
Content-Type: application/json

{ "column1": "value1", "column2": 123 }
```

Body keys = column names. At least one field required.

**Response 201**
```json
{
  "message": "Row created",
  "data": { "id": 456, "column1": "value1", "column2": 123, ... }
}
```

**Response 400** – Invalid table/column name or empty body.

---

### 1.5 Update row

```http
PUT /api/admin/{table}/{id}
Content-Type: application/json

{ "column1": "new_value" }
```

Only include fields to update.

**Response 200**
```json
{
  "message": "Row updated",
  "data": { "id": 123, "column1": "new_value", ... }
}
```

**Response 404** – Row not found.

---

### 1.6 Delete row

```http
DELETE /api/admin/{table}/{id}
```

**Response 200**
```json
{
  "message": "Row deleted",
  "data": { "id": 123, ... }
}
```

**Response 404** – Row not found.

---

### 1.7 Table row count

```http
GET /api/admin/{table}/count
```

**Response 200**
```json
{ "table": "products", "total": 99700 }
```

---

### 1.8 Table columns (schema)

```http
GET /api/admin/{table}/columns
```

**Response 200**
```json
{
  "table": "products",
  "columns": [
    {
      "column_name": "id",
      "data_type": "integer",
      "is_nullable": "NO",
      "column_default": "nextval(...)",
      "character_maximum_length": null
    },
    ...
  ]
}
```

---

### 1.9 Generic table search

```http
POST /api/admin/{table}/search
Content-Type: application/json

{
  "field": "column_name",
  "value": "search_term",
  "limit": 100,
  "offset": 0
}
```

Searches `WHERE column::text ILIKE '%value%'`.

**Response 200**
```json
{
  "items": [ ... ],
  "total": 42,
  "limit": 100,
  "offset": 0
}
```

---

# 2. Products (Admin)

### 2.1 Advanced product search

```http
GET /api/admin/products/search?q=...&style_code=...&brand_id=...&product_type_id=...&sku_status=...&price_min=...&price_max=...&limit=50&offset=0
```

| Query             | Type   | Description                          |
|-------------------|--------|--------------------------------------|
| `q`               | string | Search style_name, style_code, sku_code (ILIKE) |
| `style_code`      | string | Exact style code                     |
| `brand_id`        | number | Filter by brand                      |
| `product_type_id` | number | Filter by product type               |
| `sku_status`      | string | e.g. Live, Discontinued, Archived    |
| `price_min`       | number | Min sell_price                       |
| `price_max`       | number | Max sell_price                       |
| `limit`           | number | Default 50, max 500                   |
| `offset`          | number | Default 0                             |

**Response 200**
```json
{
  "items": [
    {
      "id": 123,
      "style_code": "GD002",
      "sku_code": "GD002-BLK-M",
      "style_name": "Product Name",
      "brand_name": "Brand",
      "product_type_name": "Type",
      "carton_price": 4.65,
      "single_price": 4.65,
      "sell_price": 10.55,
      "sku_status": "Live",
      "primary_image_url": "...",
      "colour_name": "Black",
      "size_name": "M",
      "created_at": "...",
      "updated_at": "...",
      "pricing_version": "1.0",
      "last_priced_at": "..."
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

---

### 2.2 Get all SKUs by style code

```http
GET /api/admin/products/by-style/{code}
```

**Response 200**
```json
{
  "style_code": "GD002",
  "items": [
    {
      "id": 123,
      "style_code": "GD002",
      "sku_code": "...",
      "style_name": "...",
      "brand_name": "...",
      "product_type_name": "...",
      "size_name": "...",
      "colour_name": "...",
      "tag_name": "...",
      ...
    }
  ],
  "count": 45
}
```

---

### 2.3 Product statistics

```http
GET /api/admin/products/statistics
```

**Response 200**
```json
{
  "byStatus": [
    { "sku_status": "Live", "count": "85000" },
    { "sku_status": "Discontinued", "count": "10000" }
  ],
  "byPriceRange": [
    { "price_range": "0-10", "count": "12000" },
    { "price_range": "10-20", "count": "50000" },
    ...
  ]
}
```

---

### 2.4 Price preview (no DB change)

```http
GET /api/admin/products/{code}/price-preview?carton_price=4.65
```

**Query:** `carton_price` (required) – number.

**Response 200**
```json
{
  "style_code": "GD002",
  "carton_price": 4.65,
  "sell_price": 10.55,
  "markup_percent": 127,
  "pricing_rule": {
    "version": "1.0",
    "from_price": 10,
    "to_price": 14.99,
    "markup_percent": 127
  }
}
```

Use for live preview while editing carton price. Debounce (e.g. 500ms) in the UI.

---

### 2.5 Update carton price (single style)

Updates `carton_price` for all **Live** SKUs with this style_code and recalculates `sell_price` from active pricing rules.

```http
PUT /api/admin/products/{code}/carton-price
Content-Type: application/json

{ "carton_price": 4.65 }
```

**Response 200**
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
    }
  ]
}
```

**Response 400** – `carton_price` missing or invalid.  
**Response 404** – No live products for this style_code.

---

### 2.6 Bulk update carton price

```http
PUT /api/admin/products/bulk-carton-price
Content-Type: application/json

{
  "updates": [
    { "style_code": "GD002", "carton_price": 4.65 },
    { "style_code": "YP047", "carton_price": 5.20 }
  ]
}
```

**Response 200**
```json
{
  "message": "Updated 2 style codes",
  "updatedCount": 2,
  "items": [
    { "style_code": "GD002", "carton_price": 4.65, "updated_count": 45 },
    { "style_code": "YP047", "carton_price": 5.2, "updated_count": 12 }
  ]
}
```

**Response 400** – `updates` missing or empty.

---

### 2.7 Bulk update status

```http
PUT /api/admin/products/bulk-status
Content-Type: application/json

{
  "product_ids": [1, 2, 3],
  "sku_status": "Live"
}
```

`sku_status` must be one of: `Live`, `Discontinued`, `Archived`.

**Response 200**
```json
{
  "message": "Updated 3 products",
  "updatedCount": 3,
  "items": [
    { "id": 1, "style_code": "GD002", "sku_code": "...", "sku_status": "Live" },
    ...
  ]
}
```

**Response 400** – `product_ids` empty or invalid, or invalid `sku_status`.

---

### 2.8 Bulk delete products

```http
DELETE /api/admin/products/bulk
Content-Type: application/json

{ "product_ids": [1, 2, 3] }
```

**Response 200**
```json
{
  "message": "Deleted 3 products",
  "deletedCount": 3,
  "items": [
    { "id": 1, "style_code": "GD002", "sku_code": "..." },
    ...
  ]
}
```

**Response 400** – `product_ids` missing or empty.

---

# 3. Dashboard & Tables

### 3.1 Dashboard statistics

```http
GET /api/admin/statistics/dashboard
```

**Response 200**
```json
{
  "statistics": {
    "totalProducts": 99700,
    "liveProducts": 85000,
    "totalStyles": 4200,
    "totalBrands": 45,
    "activePricingRules": 28,
    "recentProducts": 150
  },
  "timestamp": "2025-01-30T12:00:00.000Z"
}
```

- `recentProducts`: count created in last 7 days.

---

# 4. Pricing Rules

Pricing rules define markup by price band. `sell_price = base_price × (1 + markup_percent/100)`. Base price is `carton_price` (or `single_price` if carton is 0).  
**Do not** update `sell_price` directly; use carton price or reprice.

### 4.1 List pricing rules

```http
GET /api/pricing/rules?active=true
```

| Query    | Type   | Description              |
|----------|--------|--------------------------|
| `active` | string | `"true"` = only active   |

**Response 200**
```json
{
  "items": [
    {
      "version": "1.0",
      "from_price": 0.01,
      "to_price": 1.99,
      "markup_percent": 195,
      "active": true
    },
    {
      "version": "1.0",
      "from_price": 2,
      "to_price": 2.99,
      "markup_percent": 75,
      "active": true
    }
  ]
}
```

---

### 4.2 Create pricing rule

```http
POST /api/pricing/rules
Content-Type: application/json

{
  "version": "1.0",
  "from_price": 10,
  "to_price": 14.99,
  "markup_percent": 127,
  "active": true
}
```

- Required: `from_price`, `to_price`, `markup_percent`.
- `to_price` must be ≥ `from_price`.
- `version` defaults to `"1.0"`, `active` defaults to `false`.

**Response 201**
```json
{
  "message": "Pricing rule created successfully",
  "data": {
    "version": "1.0",
    "from_price": 10,
    "to_price": 14.99,
    "markup_percent": 127,
    "active": true
  }
}
```

---

### 4.3 Update pricing rule

Rule is identified by composite key: `version`, `from_price`, `to_price`.  
URL `id` format: `{version}:{from_price}:{to_price}` (e.g. `1.0:10.00:14.99`).

```http
PUT /api/pricing/rules/1.0:10.00:14.99
Content-Type: application/json

{
  "markup_percent": 120,
  "active": true
}
```

Optional body (if not using URL id): `originalVersion`, `originalFromPrice`, `originalToPrice`.

**Response 200**
```json
{
  "message": "Pricing rule updated successfully",
  "data": {
    "version": "1.0",
    "from_price": 10,
    "to_price": 14.99,
    "markup_percent": 120,
    "active": true
  }
}
```

**Response 404** – Rule not found.

---

### 4.4 Reprice all products

Recalculates `sell_price` for all products from current active pricing rules and refreshes search view.

```http
POST /api/pricing/reprice
```

**Response 200**
```json
{
  "message": "Repricing job completed",
  "updatedProducts": 99700,
  "materializedViewRefreshed": true,
  "refreshError": null
}
```

Can take 1–5 minutes on large DBs. Show a loading state in the admin UI.

---

### 4.5 Direct sell_price update (disabled)

```http
PUT /api/pricing/products/{code}/sell-price
```

**Response 400**
```json
{
  "error": "DirectSellPriceDisabled",
  "message": "Direct sell_price updates are disabled. Please update carton_price via the admin API so sell_price can be recalculated from pricing rules."
}
```

Do not use; use carton price or reprice instead.

---

# 5. Display Order

Control order of products by brand and/or product type.

### 5.1 List display order entries

```http
GET /api/display-order?brand_id=28&product_type_id=21&style_code=YP&page=1&limit=50
```

| Query             | Type   | Description                    |
|-------------------|--------|--------------------------------|
| `brand_id`        | number | Filter by brand                |
| `product_type_id` | number | Filter by product type         |
| `style_code`      | string | Partial match (ILIKE)          |
| `page`            | number | Default 1                      |
| `limit`           | number | Default 50                     |

**Response 200**
```json
{
  "items": [
    {
      "id": 1,
      "style_code": "YP047",
      "brand_id": 28,
      "brand_name": "Brand",
      "product_type_id": 21,
      "product_type_name": "Type",
      "display_order": 1,
      "created_at": "...",
      "updated_at": "...",
      "product_name": "Style Name"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 50
}
```

---

### 5.2 Products with display order (for admin UI)

```http
GET /api/display-order/products?brand_id=28&product_type_id=21&page=1&limit=50
```

At least one of `brand_id` or `product_type_id` is required.

**Response 200**
```json
{
  "items": [
    {
      "style_code": "YP047",
      "product_name": "...",
      "brand_id": 28,
      "brand_name": "...",
      "product_type_id": 21,
      "product_type_name": "...",
      "display_order_id": 1,
      "display_order": 1,
      "display_order_created_at": "...",
      "image": "..."
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 50,
  "filters": {
    "brand_id": 28,
    "product_type_id": 21
  }
}
```

---

### 5.3 Brands (for dropdowns)

```http
GET /api/display-order/brands
```

**Response 200**
```json
{
  "items": [
    {
      "id": 28,
      "name": "Brand Name",
      "slug": "brand-slug",
      "display_order": 1,
      "product_count": "150"
    }
  ]
}
```

Only brands that have at least one live product.

---

### 5.4 Product types (for dropdowns)

```http
GET /api/display-order/product-types
```

**Response 200**
```json
{
  "items": [
    {
      "id": 21,
      "name": "Type Name",
      "slug": "type-slug",
      "display_order": 1,
      "product_count": "320"
    }
  ]
}
```

Only types that have at least one live product.

---

### 5.5 Create or update display order (upsert)

```http
POST /api/display-order
Content-Type: application/json

{
  "style_code": "YP047",
  "brand_id": 28,
  "product_type_id": 21,
  "display_order": 1
}
```

- Required: `style_code`, `display_order`.
- `brand_id` and `product_type_id` are optional; use for brand/type-specific ordering.
- If a row for same (style_code, brand_id, product_type_id) exists, it is updated.

**Response 201**
```json
{
  "message": "Display order saved successfully",
  "data": {
    "id": 1,
    "style_code": "YP047",
    "brand_id": 28,
    "product_type_id": 21,
    "display_order": 1,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Response 400** – Missing `style_code` or `display_order`.  
**Response 404** – style_code not found in `styles`.

---

### 5.6 Bulk update display orders

```http
POST /api/display-order/bulk
Content-Type: application/json

{
  "brand_id": 28,
  "product_type_id": 21,
  "orders": [
    { "style_code": "YP047", "display_order": 1 },
    { "style_code": "YP049", "display_order": 2 }
  ]
}
```

`brand_id` and `product_type_id` apply to all entries. `orders` is required and non-empty.

**Response 200**
```json
{
  "message": "Successfully updated 2 display orders",
  "updated": 2,
  "data": [ { "id": 1, "style_code": "YP047", ... }, ... ]
}
```

---

### 5.7 Update display order by ID

```http
PUT /api/display-order/{id}
Content-Type: application/json

{ "display_order": 5 }
```

**Response 200**
```json
{
  "message": "Display order updated successfully",
  "data": { "id": 1, "style_code": "YP047", "display_order": 5, ... }
}
```

**Response 404** – Entry not found.

---

### 5.8 Delete display order by ID

```http
DELETE /api/display-order/{id}
```

**Response 200**
```json
{
  "message": "Display order deleted successfully",
  "data": { "id": 1, "style_code": "YP047", ... }
}
```

**Response 404** – Entry not found.

---

### 5.9 Delete display order by context

```http
DELETE /api/display-order/by-context
Content-Type: application/json

{
  "style_code": "YP047",
  "brand_id": 28,
  "product_type_id": 21
}
```

- `style_code` required.
- `brand_id` and/or `product_type_id` optional; they identify which row(s) to delete.

**Response 200**
```json
{
  "message": "Display order deleted successfully",
  "data": { "id": 1, "style_code": "YP047", ... }
}
```

**Response 400** – Missing `style_code`.  
**Response 404** – No matching row.

---

# Error responses

All endpoints use the same error shape:

```json
{
  "error": "Bad request",
  "message": "Human-readable description"
}
```

| Status | `error` (typical) | When |
|--------|--------------------|------|
| 400    | Bad request        | Validation, missing/invalid params or body |
| 404    | Not found          | Resource or row not found |
| 408    | Request timeout    | Server timeout |
| 500    | Internal server error | DB or server error |

---

# Rules to follow in the admin panel

1. **Pricing**
   - Never update `sell_price` directly.
   - Always change price via:
     - **Single style:** `PUT /api/admin/products/{code}/carton-price`
     - **Multiple styles:** `PUT /api/admin/products/bulk-carton-price`
     - **All products after rule changes:** `POST /api/pricing/reprice`
   - Use `GET /api/admin/products/{code}/price-preview?carton_price=X` for live preview (with debounce).

2. **Tables**
   - Use lowercase table names: `products`, `brands`, `pricing_rules`, etc.
   - Get list: `GET /api/admin/tables`.
   - Get schema for forms: `GET /api/admin/{table}/columns`.

3. **Pricing rules**
   - Rule id in URL is `version:from_price:to_price` (e.g. `1.0:10.00:14.99`).
   - After changing rules, run `POST /api/pricing/reprice` so all products use new markups.

4. **Product status**
   - Only `sku_status = 'Live'` is updated by carton-price endpoints and included in customer-facing search.
   - Valid statuses: `Live`, `Discontinued`, `Archived`.

5. **Pagination**
   - List endpoints: default `limit` 100, max 500; use `offset` for pages.
   - Display-order list: `page` and `limit` (page-based).

6. **Search / materialized view**
   - After price or display-order updates, the backend refreshes the search materialized view; it can take 5–30 seconds. Responses include `materializedViewRefreshed` where relevant.

---

# Swagger (interactive docs)

- **URL:** `http://localhost:3004/api-docs`
- Use it to try endpoints and see request/response examples.

---

# One-page endpoint checklist

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/tables` | List tables |
| GET | `/api/admin/{table}` | List rows |
| GET | `/api/admin/{table}/count` | Row count |
| GET | `/api/admin/{table}/columns` | Schema |
| POST | `/api/admin/{table}/search` | Generic search |
| GET | `/api/admin/{table}/{id}` | Get one row |
| POST | `/api/admin/{table}` | Create row |
| PUT | `/api/admin/{table}/{id}` | Update row |
| DELETE | `/api/admin/{table}/{id}` | Delete row |
| GET | `/api/admin/statistics/dashboard` | Dashboard stats |
| GET | `/api/admin/products/search` | Product search |
| GET | `/api/admin/products/by-style/:code` | SKUs by style |
| GET | `/api/admin/products/statistics` | Product stats |
| GET | `/api/admin/products/:code/price-preview` | Price preview |
| PUT | `/api/admin/products/:code/carton-price` | Set carton price (one style) |
| PUT | `/api/admin/products/bulk-carton-price` | Bulk carton price |
| PUT | `/api/admin/products/bulk-status` | Bulk status |
| DELETE | `/api/admin/products/bulk` | Bulk delete |
| GET | `/api/pricing/rules` | List pricing rules |
| POST | `/api/pricing/rules` | Create rule |
| PUT | `/api/pricing/rules/:id` | Update rule |
| POST | `/api/pricing/reprice` | Reprice all |
| GET | `/api/display-order` | List display orders |
| GET | `/api/display-order/products` | Products with order |
| GET | `/api/display-order/brands` | Brands dropdown |
| GET | `/api/display-order/product-types` | Product types dropdown |
| POST | `/api/display-order` | Create/update order |
| POST | `/api/display-order/bulk` | Bulk update orders |
| PUT | `/api/display-order/:id` | Update order |
| DELETE | `/api/display-order/:id` | Delete order |
| DELETE | `/api/display-order/by-context` | Delete by context |

---

**Last updated:** January 2025  
**API version:** 1.0.0
