const fs = require('fs');
const path = require('path');
const { pool, closePool } = require('../config/database');

const SOURCE_KEY = 'gocustom-2026-11-09';
const DATA_PATH = path.join(__dirname, 'data', 'gocustom-bundle-benefits-2026-11-09.json');
const MIGRATION_PATH = path.join(__dirname, 'migrations', '006_fixed_bundle_benefits.sql');

async function applyFixedBundleBenefits() {
  const benefits = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (!Array.isArray(benefits) || benefits.length !== 94) {
    throw new Error(`Expected 94 bundle benefit records, received ${benefits.length}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    let updated = 0;
    for (const benefit of benefits) {
      const result = await client.query(`
        UPDATE bundles SET
          included_decoration_methods = $3::jsonb,
          included_logo_count = $4,
          logo_position = $5,
          free_delivery = $6,
          free_gift = $7::jsonb,
          source_include_text = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE source_key = $1 AND source_bundle_number = $2
      `, [
        SOURCE_KEY,
        benefit.sourceNumber,
        JSON.stringify(benefit.includedDecorationMethods),
        benefit.includedLogoCount,
        benefit.logoPosition,
        benefit.freeDelivery,
        benefit.freeGift == null ? null : JSON.stringify(benefit.freeGift),
        benefit.sourceIncludeText,
      ]);
      updated += result.rowCount;
    }

    const summaryResult = await client.query(`
      SELECT
        COUNT(*)::integer AS bundles,
        COUNT(*) FILTER (WHERE included_decoration_methods = '["print"]'::jsonb)::integer AS print_only,
        COUNT(*) FILTER (WHERE included_decoration_methods = '["print", "embroidery"]'::jsonb)::integer AS print_or_embroidery,
        COUNT(*) FILTER (WHERE free_delivery)::integer AS free_delivery,
        COUNT(*) FILTER (WHERE free_gift IS NOT NULL)::integer AS free_gifts,
        COUNT(*) FILTER (WHERE logo_position IS NOT NULL)::integer AS specified_positions,
        COUNT(*) FILTER (WHERE included_logo_count = 1)::integer AS one_logo
      FROM bundles
      WHERE source_key = $1
    `, [SOURCE_KEY]);
    const summary = { updated, ...summaryResult.rows[0] };
    if (
      updated !== 94
      || summary.bundles !== 94
      || summary.print_only !== 26
      || summary.print_or_embroidery !== 68
      || summary.free_delivery !== 67
      || summary.free_gifts !== 0
      || summary.specified_positions !== 0
      || summary.one_logo !== 94
    ) {
      throw new Error(`Bundle benefit verification failed: ${JSON.stringify(summary)}`);
    }
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

applyFixedBundleBenefits()
  .then(summary => console.log(JSON.stringify({ valid: true, ...summary }, null, 2)))
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
