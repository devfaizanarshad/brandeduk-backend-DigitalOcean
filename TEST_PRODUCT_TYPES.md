# Product Type Filter - Testing Guide

## Quick Test Commands

### 1. Get All Product Types with Counts
```bash
curl "https://brandeduk-backend.onrender.com/api/products/types"
```

### 2. Filter Products by Single Product Type
```bash
# Filter by T-Shirts
curl "https://brandeduk-backend.onrender.com/api/products?productType=T-Shirts&limit=5"

# Filter by Hoodies
curl "https://brandeduk-backend.onrender.com/api/products?productType=Hoodies&limit=5"
```

### 3. Filter by Multiple Product Types
```bash
curl "https://brandeduk-backend.onrender.com/api/products?productType=T-Shirts&productType=Hoodies&productType=Polos&limit=10"
```

### 4. Combine with Other Filters
```bash
# Product type + price range
curl "https://brandeduk-backend.onrender.com/api/products?productType=T-Shirts&priceMin=10&priceMax=50&limit=5"

# Product type + color
curl "https://brandeduk-backend.onrender.com/api/products?productType=Hoodies&primaryColour=black&limit=5"
```

### 5. Test Case Insensitivity
```bash
# Should work the same
curl "https://brandeduk-backend.onrender.com/api/products?productType=t-shirts&limit=5"
curl "https://brandeduk-backend.onrender.com/api/products?productType=T-SHIRTS&limit=5"
```

## Browser Testing

### Get Product Types List
Open in browser:
```
https://brandeduk-backend.onrender.com/api/products/types
```

### Filter Products
Open in browser:
```
https://brandeduk-backend.onrender.com/api/products?productType=T-Shirts&limit=10
```

## Expected Responses

### Product Types Endpoint Response
```json
{
  "productTypes": [
    {
      "id": 1,
      "name": "T-Shirts",
      "count": 22606,
      "percentage": "22.67%",
      "displayOrder": 1
    },
    {
      "id": 2,
      "name": "Hoodies",
      "count": 12942,
      "percentage": "12.98%",
      "displayOrder": 2
    }
    // ... more types
  ],
  "total": 99700
}
```

### Filtered Products Response
```json
{
  "items": [
    {
      "code": "GD067",
      "name": "Product Name",
      "price": 17.58,
      "image": "https://...",
      "colors": [...],
      "sizes": [...],
      "customization": [...],
      "brand": "...",
      "priceBreaks": [...]
    }
    // ... more products
  ],
  "page": 1,
  "limit": 10,
  "total": 22606,
  "priceRange": {
    "min": 9.99,
    "max": 89.99
  }
}
```

## Common Product Type Names

Based on your list, here are the exact names to use:

- `T-Shirts`
- `Hoodies`
- `Polos`
- `Sweatshirts`
- `Jackets`
- `Shirts`
- `Gilets & Body Warmers`
- `Fleece`
- `Softshells`
- `Trousers`
- `Shorts`
- `Bags`
- `Caps`
- `Sweatpants`
- `Vests (t-shirt)`
- `Blouses`
- `Safety Vests`
- `Beanies`
- `Knitted Jumpers`
- `Trackwear`
- ... and more

**Note:** Use the exact name as it appears in your database. The filter is case-insensitive, so "t-shirts" and "T-Shirts" both work.

## Troubleshooting

### No products returned
- Check the product type name matches exactly (case-insensitive)
- Verify products exist for that type in the database
- Check if products have `sku_status = 'Live'`

### Slow response
- The EXISTS subquery may be slower for large datasets
- Consider adding an index on `styles.product_type_id` if not already present
- Consider adding an index on `product_types.name` if not already present

### Error 500
- Check server logs in Render dashboard
- Verify database connection is working
- Check if `product_types` table exists and has data

