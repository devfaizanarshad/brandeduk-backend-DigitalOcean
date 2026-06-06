# Quote API Endpoint Documentation

## Endpoint
```
POST /api/quotes
```

## Garment Preview Upload

The endpoint accepts a final customized garment preview as an additional
multipart image file. Use `preview_image` for the main shirt-with-logo preview:

```text
Content-Type: multipart/form-data

quoteData: <JSON string>
logo_left-chest: <logo file>
preview_image: <final customized garment image>
```

Optional multiple views can use fields such as `preview_front`, `preview_back`,
or `preview_left`. Uploaded previews are stored in
`quote_requests.quote_data.previewImages`, returned through the existing admin
quote APIs, included in quote emails, and inherited by later sent quote
revisions.

## Admin Quote Email Deep Link

Set a route template for the button in the initial admin quote notification:

```env
ADMIN_QUOTE_URL_TEMPLATE=http://localhost:5173/quotes/{quoteId}
```

Production example:

```env
ADMIN_QUOTE_URL_TEMPLATE=https://admin.brandeduk.com/quotes/{quoteId}
```

The admin frontend route should be protected. If the admin is already signed
in, open that exact quote. Otherwise, redirect to login while preserving the
requested URL, then return to the quote after successful login.

When an admin previews or sends an adjusted quote, the backend automatically
inherits the original uploaded `logos` and `previewImages`. The admin frontend
does not need to resend those assets.

## Request Headers
```
Content-Type: application/json
```

## Request Body

The endpoint accepts a JSON object with the following structure:

```json
{
  "customer": {
    "fullName": "John Smith",           // Required: Full name OR firstName + lastName
    "firstName": "John",                // Optional: Use if fullName not provided
    "lastName": "Smith",                // Optional: Use if fullName not provided
    "email": "john@example.com",        // Required
    "phone": "+44 7700 900000"          // Optional
  },
  "product": {
    "name": "Golf performance crested cap",  // Optional
    "code": "AD082",                         // Required
    "selectedColorName": "Navy",             // Optional
    "quantity": 10,                          // Optional (default: 0)
    "price": 12.50                           // Optional (default: 0)
  },
  "basket": [],                              // Optional: Array of basket items
  "customizations": [                        // Optional: Array of customization objects
    {
      "method": "embroidery",                // Required: "embroidery" or "print"
      "type": "logo",                        // Optional: e.g., "logo", "text"
      "position": "Front",                   // Optional: e.g., "Front", "Back", "Left", "Right"
      "uploadedLogo": true,                  // Optional: Boolean indicating if logo was uploaded
      "text": "Company Logo"                 // Optional: Text content if applicable
    }
  ],
  "timestamp": "2026-01-10T11:39:00.427Z"   // Optional: ISO timestamp (auto-generated if not provided)
}
```

## Response Format

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Quote sent successfully"
}
```

### Error Responses

#### 400 Bad Request - Missing Customer Email
```json
{
  "success": false,
  "message": "Customer email is required"
}
```

#### 400 Bad Request - Missing Product Code
```json
{
  "success": false,
  "message": "Product code is required"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Failed to send quote email"
}
```

## Example Request (JavaScript/Fetch)

```javascript
const quoteData = {
  customer: {
    fullName: "John Smith",
    email: "john@example.com",
    phone: "+44 7700 900000"
  },
  product: {
    name: "Golf performance crested cap",
    code: "AD082",
    selectedColorName: "Navy",
    quantity: 10,
    price: 12.50
  },
  basket: [],
  customizations: [
    {
      method: "embroidery",
      type: "logo",
      position: "Front",
      uploadedLogo: true,
      text: "Company Logo"
    },
    {
      method: "print",
      type: "text",
      position: "Back",
      uploadedLogo: false,
      text: "Branded UK"
    }
  ]
};

fetch('https://your-api-domain.com/api/quotes', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(quoteData)
})
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      console.log('Quote sent successfully!');
      // Show success message to user
    } else {
      console.error('Error:', data.message);
      // Show error message to user
    }
  })
  .catch(error => {
    console.error('Network error:', error);
    // Handle network error
  });
```

## Example Request (Axios)

```javascript
import axios from 'axios';

const quoteData = {
  customer: {
    fullName: "John Smith",
    email: "john@example.com",
    phone: "+44 7700 900000"
  },
  product: {
    name: "Golf performance crested cap",
    code: "AD082",
    selectedColorName: "Navy",
    quantity: 10,
    price: 12.50
  },
  customizations: [
    {
      method: "embroidery",
      type: "logo",
      position: "Front",
      uploadedLogo: true,
      text: "Company Logo"
    }
  ]
};

try {
  const response = await axios.post('https://your-api-domain.com/api/quotes', quoteData);
  
  if (response.data.success) {
    // Show success message
    alert('Quote request sent successfully!');
  }
} catch (error) {
  if (error.response) {
    // Server responded with error
    console.error('Error:', error.response.data.message);
    alert(`Error: ${error.response.data.message}`);
  } else {
    // Network error
    console.error('Network error:', error.message);
    alert('Network error. Please try again.');
  }
}
```

## Important Notes

1. **Customer Name**: The endpoint accepts either:
   - `customer.fullName` (preferred)
   - OR `customer.firstName` + `customer.lastName` (fallback)

2. **Required Fields**:
   - `customer.email` (required)
   - `product.code` (required)
   - All other fields are optional

3. **Email Recipients**:
   - Development: Emails sent to `devfaizanarshad@gmail.com`
   - Production: Emails sent to `info@brandeduk.com`
   - The customer's email is set as the Reply-To address

4. **CORS**: The endpoint supports CORS and accepts requests from any origin (configurable via environment variables)

5. **Request Size Limit**: 10MB (for potential logo uploads in future)

6. **Response Time**: Typically responds within 1-3 seconds

## Testing

You can test the endpoint using:
- Postman
- cURL
- Your frontend application
- The test script: `node test-quote.js`

## Base URL

- **Development**: `http://localhost:3000`
- **Production**: `https://your-production-domain.com`

Make sure to replace `your-api-domain.com` with your actual API domain in production.

