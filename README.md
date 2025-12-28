# brandeduk-backend

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
- `sort` (price|name|newest) - Sort field
- `order` (asc|desc) - Sort order

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

