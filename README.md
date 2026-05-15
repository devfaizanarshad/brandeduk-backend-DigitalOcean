# brandeduk-backend

## Deployment

🚀 **Ready to deploy?** See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete step-by-step instructions to deploy to Render.

## Setup

1. Install dependencies : 
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

### POST /api/quotes/stripe/payment-intent
Create a Stripe PaymentIntent for a quote. The frontend uses the returned `clientSecret` with Stripe.js to collect payment securely.

Required environment variables:
```bash
STRIPE_SECRET_KEY=sk_live_or_test_key_here
STRIPE_WEBHOOK_SECRET=whsec_webhook_secret_here
STRIPE_CURRENCY=gbp
```

Request:
```json
{
  "quoteData": {
    "customer": {
      "fullName": "John Doe",
      "email": "john@example.com",
      "phone": "+44 20 1234 5678"
    },
    "summary": {
      "totalIncVat": 930.00,
      "vatAmount": 155.00
    },
    "basket": [
      {
        "name": "Product Name",
        "code": "PROD-123",
        "quantity": 50,
        "unitPrice": 10.00,
        "itemTotal": 500.00
      }
    ],
    "customizations": []
  }
}
```

Response:
```json
{
  "success": true,
  "message": "Stripe payment intent created",
  "data": {
    "quoteId": "quote_pay_...",
    "paymentIntentId": "pi_...",
    "clientSecret": "pi_..._secret_...",
    "amount": 93000,
    "currency": "gbp",
    "status": "requires_payment_method"
  }
}
```

### GET /api/quotes/stripe/payment-intent/:id
Fetch the latest Stripe status for a quote PaymentIntent.

### POST /api/quotes/stripe/webhook
Stripe webhook endpoint. Add this URL in Stripe Dashboard and subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, and `payment_intent.processing`.

### GET /api/vecteezy/search
Search Vecteezy graphics through the backend. The Vecteezy API key stays private on the server and the frontend receives preview metadata only.

Required environment variables:
```bash
VECTEEZY_API_KEY=your_vecteezy_api_key
VECTEEZY_ACCOUNT_ID=your_vecteezy_account_id
VECTEEZY_DEFAULT_CONTENT_TYPE=vector
```

Example:
```txt
GET /api/vecteezy/search?q=lion%20logo&contentType=vector&page=1&perPage=24&familyFriendly=true
```

Response:
```json
{
  "success": true,
  "page": 1,
  "perPage": 24,
  "items": [
    {
      "id": "123456",
      "title": "Lion Logo Vector",
      "contentType": "vector",
      "thumbnailUrl": "https://...",
      "previewUrl": "https://...",
      "source": "vecteezy"
    }
  ]
}
```

## Database

The API connects to PostgreSQL database `Branded_UK` and uses:
- `products` table for SKU-level data
- `styles` table for product definitions
- `product_search_view` for optimized search queries

