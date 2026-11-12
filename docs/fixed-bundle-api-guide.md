# Fixed Bundle API Guide

## Important security rule

Never put an administrator token, password or bulk update request inside browser/frontend code. Browser code is visible to every visitor.

The storefront should only use the public `GET` endpoints. Bulk updates must run from Postman, a private server, CI, or a local script with an administrator token stored outside the source code.

## Storefront endpoints

- `GET /api/bundles` lists active bundles.
- `GET /api/bundles/:slug` returns one active bundle and its required products.
- `GET /api/bundles/:slug/components/:componentId/options` returns live colour and size SKU choices.
- `POST /api/bundles/:slug/validate-selection` checks that selected SKUs and quantities exactly match the bundle.

Draft, incomplete and unapproved bundles never appear through these endpoints.

## Safe bulk workflow

All management requests require `Authorization: Bearer ADMIN_TOKEN`.

1. Download an example with `GET /api/admin/bundles/bulk/template`.
2. Prepare up to 100 bundles in the same JSON structure.
3. Send the file to `POST /api/admin/bundles/bulk/validate`.
4. Fix every reported error.
5. Send the same file to `POST /api/admin/bundles/bulk/upsert`.
6. Review and approve pricing before publishing.

Bulk writes are atomic: if one bundle is invalid, none are changed. Every imported bundle remains a draft and pricing approval is reset, even when updating an existing draft.

## Stable references

`reference` identifies a bundle across repeated uploads. Keep it short and never change it after the first upload.

Sending the same reference again updates that draft instead of creating a duplicate. Active and archived bundles cannot be bulk updated.

## Example

Use `examples/fixed-bundles-bulk.example.json` as the starting file.

```json
{
  "bundles": [
    {
      "reference": "starter-polo-10",
      "name": "10 Polo Shirt Starter Bundle",
      "slug": "10-polo-shirt-starter-bundle",
      "priceExVat": 99.99,
      "components": [
        { "styleCode": "UC101", "quantity": 10 }
      ]
    }
  ]
}
```

Validation reports unknown products, duplicate references, duplicate slugs, invalid prices, invalid quantities, active bundles and archived bundles with readable messages.
