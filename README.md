# brandeduk-backend

## Deployment

🚀 **Ready to deploy?** See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete step-by-step instructions to deploy to Render.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=Branded_UK
DB_USER=postgres
DB_PASSWORD=1234
PORT=3000
```

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

### GET /api/products
Product list with filtering, search, and pagination.

**Query Parameters:**
- `page` (default: 1) - Page number
- `limit` (default: 25, max: 200) - Items per page
- `q` - Text search on product name/code
- `priceMin`, `priceMax` - Price range filter
- `gender`, `ageGroup`, `size`, `fabric`, `accreditations`, `tag`, `effect`, `sector`, `sport`, `style` - Array filters
- `primaryColour`, `colourShade` - Color filters
- `productType` or `productTypes` - Filter by product type name(s) (e.g., "T-Shirts", "Hoodies", "Polos")
- `category` or `categories` - Filter by category (slugs or IDs)
- `sort` - Sort option. Available values:
  - `newest` - Sort by creation date (newest first)
  - `best` - Best sellers (uses newest as proxy)
  - `brand-az` - Sort by brand name A-Z
  - `brand-za` - Sort by brand name Z-A
  - `code-az` - Sort by product code A-Z
  - `code-za` - Sort by product code Z-A
  - `price-lh` - Sort by price low to high
  - `price-hl` - Sort by price high to low
  - `price` - Sort by price (use with order parameter)
  - `name` - Sort by product name (use with order parameter)
- `order` (asc|desc) - Sort order (only used with `price` or `name` sort options)

**Response:**
```json
{
  "items": [...],
  "page": 1,
  "limit": 25,
  "total": 97000,
  "priceRange": { "min": 9.99, "max": 189.00 }
}
```

### GET /api/products/types
Get all product types with product counts and percentages.

**Response:**
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
    ...
  ],
  "total": 99700
}
```

### GET /api/products/:code
Get product details by style code.

**Response:**
```json
{
  "code": "GD067",
  "name": "...",
  "brand": "...",
  "basePrice": 17.58,
  "priceBreaks": [...],
  "colors": [...],
  "sizes": [...],
  "images": [...],
  "description": "...",
  "details": {...},
  "customization": [...]
}
```

## Database

The API connects to PostgreSQL database `Branded_UK` and uses:
- `products` table for SKU-level data
- `styles` table for product definitions
- `product_search_view` for optimized search queries

