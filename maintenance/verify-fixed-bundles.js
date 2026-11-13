require('dotenv').config();

const { queryWithTimeout, closePool } = require('../config/database');

const SOURCE_KEY = 'gocustom-2026-11-09';
const EXPECTED_MISSING_CODES = ['AS5001', 'B309', 'DX412', 'LW72', 'T710'];

async function verifyFixedBundles() {
  const summaryResult = await queryWithTimeout(`
    SELECT
      COUNT(*)::integer AS bundles,
      COALESCE(SUM(total_item_quantity), 0)::integer AS total_items,
      COUNT(*) FILTER (WHERE status = 'draft')::integer AS drafts,
      COUNT(*) FILTER (WHERE status = 'active')::integer AS active,
      COUNT(*) FILTER (WHERE catalogue_status = 'missing_products')::integer AS missing_product_bundles,
      COUNT(*) FILTER (WHERE pricing_status = 'margin_review')::integer AS margin_review_bundles,
      COUNT(*) FILTER (WHERE pricing_status = 'cost_review')::integer AS cost_review_bundles
      , COUNT(*) FILTER (WHERE included_decoration_methods = '["print"]'::jsonb)::integer AS print_only_bundles
      , COUNT(*) FILTER (WHERE included_decoration_methods = '["print", "embroidery"]'::jsonb)::integer AS print_or_embroidery_bundles
      , COUNT(*) FILTER (WHERE free_delivery)::integer AS free_delivery_bundles
      , COUNT(*) FILTER (WHERE included_logo_count = 1)::integer AS one_logo_bundles
      , COUNT(*) FILTER (WHERE logo_position IS NOT NULL)::integer AS specified_logo_positions
      , COUNT(*) FILTER (WHERE free_gift IS NOT NULL)::integer AS free_gift_bundles
    FROM bundles
    WHERE source_key = $1
  `, [SOURCE_KEY], 10000);

  const componentResult = await queryWithTimeout(`
    SELECT
      COUNT(*)::integer AS components,
      COUNT(*) FILTER (WHERE component_status = 'linked')::integer AS linked_components,
      COUNT(*) FILTER (WHERE component_status = 'missing_product')::integer AS missing_components,
      COALESCE(
        ARRAY_AGG(DISTINCT requested_style_code ORDER BY requested_style_code)
          FILTER (WHERE component_status = 'missing_product'),
        ARRAY[]::varchar[]
      ) AS missing_codes
    FROM bundle_components component
    JOIN bundles bundle ON bundle.id = component.bundle_id
    WHERE bundle.source_key = $1
  `, [SOURCE_KEY], 10000);

  const summary = {
    ...summaryResult.rows[0],
    ...componentResult.rows[0],
  };
  const errors = [];

  if (summary.bundles !== 94) errors.push(`Expected 94 bundles, found ${summary.bundles}`);
  if (summary.components !== 117) errors.push(`Expected 117 component lines, found ${summary.components}`);
  if (summary.linked_components !== 110) errors.push(`Expected 110 linked components, found ${summary.linked_components}`);
  if (summary.missing_components !== 7) errors.push(`Expected 7 missing components, found ${summary.missing_components}`);
  if (summary.missing_product_bundles !== 7) errors.push(`Expected 7 missing-product bundles, found ${summary.missing_product_bundles}`);
  if (summary.active !== 0) errors.push(`Expected 0 active bundles, found ${summary.active}`);
  if (summary.print_only_bundles !== 26) errors.push(`Expected 26 print-only bundles, found ${summary.print_only_bundles}`);
  if (summary.print_or_embroidery_bundles !== 68) errors.push(`Expected 68 print-or-embroidery bundles, found ${summary.print_or_embroidery_bundles}`);
  if (summary.free_delivery_bundles !== 67) errors.push(`Expected 67 free-delivery bundles, found ${summary.free_delivery_bundles}`);
  if (summary.one_logo_bundles !== 94) errors.push(`Expected 94 one-logo bundles, found ${summary.one_logo_bundles}`);
  if (summary.specified_logo_positions !== 0) errors.push(`Expected 0 specified logo positions, found ${summary.specified_logo_positions}`);
  if (summary.free_gift_bundles !== 0) errors.push(`Expected 0 free-gift bundles, found ${summary.free_gift_bundles}`);
  if (JSON.stringify(summary.missing_codes) !== JSON.stringify(EXPECTED_MISSING_CODES)) {
    errors.push(`Unexpected missing codes: ${summary.missing_codes.join(', ')}`);
  }

  console.log(JSON.stringify({ valid: errors.length === 0, ...summary, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
}

verifyFixedBundles()
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
