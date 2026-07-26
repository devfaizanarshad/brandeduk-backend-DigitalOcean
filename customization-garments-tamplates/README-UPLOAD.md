# BrandedUK Customization Garment Templates

This folder is the normalized upload set for the BrandedUK admin panel.

## Asset contract

- Format: PNG
- Canvas: 1200 x 1200 pixels
- Colour space: sRGB
- Background: real alpha transparency
- Garment: neutral grayscale, ready for frontend colour tinting
- Naming: lowercase canonical position names
- Maximum file size: below the admin panel's 5 MB upload limit

## Upload process

1. In the admin panel, open **Customization Configuration**.
2. Select the product type whose slug matches a folder in this directory.
3. For each configured position, upload the PNG with the matching name:
   - `front.png`
   - `back.png`
   - `sleeve.png`
   - `side.png`
   - `left.png`
   - `right.png`
4. Keep the existing position label, enabled methods, and prices unchanged.
5. Save the product-type configuration before moving to the next type.

Use `admin-upload-checklist.csv` as the full product-type/position checklist.
Do not upload `contact-sheet.png`; it is only for visual quality review.

## Important

Upload files from this `customization-garments-tamplates` folder. The previous
source files are archived outside the repository under
`.image-tools/archive/customization-garments-tamplates-original-backup`.
