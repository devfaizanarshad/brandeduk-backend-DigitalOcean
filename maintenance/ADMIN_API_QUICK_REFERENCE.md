# Admin API Quick Reference

**Quick lookup guide for common admin operations**

---

## Base URL
```
Development: http://localhost:3004
Production: https://api.brandeduk.com
```

---

## Generic CRUD (Any Table)

```javascript
// List tables
GET /api/admin/tables

// List rows (pagination)
GET /api/admin/{table}?limit=100&offset=0

// Get single row
GET /api/admin/{table}/{id}

// Create row
POST /api/admin/{table}
Body: { "column1": "value1", "column2": "value2" }

// Update row
PUT /api/admin/{table}/{id}
Body: { "column1": "new_value" }

// Delete row
DELETE /api/admin/{table}/{id}
```

---

## Product Pricing

```javascript
// Preview sell_price (no DB change)
GET /api/admin/products/{code}/price-preview?carton_price=4.65

// Update carton_price (auto-calculates sell_price)
PUT /api/admin/products/{code}/carton-price
Body: { "carton_price": 4.65 }
```

---

## Pricing Rules

```javascript
// List rules
GET /api/pricing/rules?active=true

// Create rule
POST /api/pricing/rules
Body: {
  "version": "1.0",
  "from_price": 10.00,
  "to_price": 14.99,
  "markup_percent": 127.00,
  "active": true
}

// Update rule (composite key)
PUT /api/pricing/rules/{version}:{from_price}:{to_price}
Body: { "markup_percent": 120.00 }

// Reprice all products
POST /api/pricing/reprice
```

---

## Common Tables

- `products` - Product SKUs
- `pricing_rules` - Pricing rules
- `brands` - Brands
- `categories` - Categories
- `styles` - Product styles
- `sizes` - Size options
- `colors` - Color options
- `genders` - Gender options
- `product_types` - Product types

---

## Important Rules

1. ✅ **Always** update `carton_price`, never `sell_price` directly
2. ✅ Use price-preview for real-time UX
3. ✅ After changing pricing rules, run `/api/pricing/reprice`
4. ✅ Only `sku_status = 'Live'` products are updated
5. ✅ Materialized view refresh happens automatically (may take 5-30s)

---

## Error Codes

- `400` - Bad request (validation error)
- `404` - Not found
- `500` - Internal server error

---

**Full Documentation:** See `ADMIN_API_README.md`
