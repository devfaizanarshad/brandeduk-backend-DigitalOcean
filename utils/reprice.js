const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // set this
  max: 5,
});

async function fetchActiveRules(client) {
  const { rows } = await client.query(
    `SELECT version, from_price, to_price, markup_percent
     FROM pricing_rules
     WHERE active = true
     ORDER BY from_price ASC`
  );
  return rows;
}

function calcSell(raw, rules) {
  if (!raw || raw <= 0) return 0;
  const tier = rules.find(r => raw >= r.from_price && raw <= r.to_price);
  const markup = tier ? tier.markup_percent : 0;
  return Math.round(raw * (1 + markup / 100) * 100) / 100;
}

async function repriceBatch(client, rules) {
  // Base cost: carton_price preferred, fallback to single_price
  const { rowCount } = await client.query(
    `UPDATE products p
     SET sell_price = ROUND(
         COALESCE(NULLIF(p.carton_price,0), NULLIF(p.single_price,0))
         * (1 + (
           SELECT markup_percent/100
           FROM pricing_rules r
           WHERE r.active = true
             AND COALESCE(NULLIF(p.carton_price,0), NULLIF(p.single_price,0))
                 BETWEEN r.from_price AND r.to_price
           ORDER BY r.from_price
           LIMIT 1
         )), 2),
         pricing_version = (SELECT version FROM pricing_rules r WHERE r.active = true LIMIT 1),
         last_priced_at = NOW()
     WHERE COALESCE(NULLIF(p.carton_price,0), NULLIF(p.single_price,0)) IS NOT NULL`
  );
  return rowCount;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rules = await fetchActiveRules(client);
    const updated = await repriceBatch(client, rules);
    await client.query('COMMIT');
    console.log(`Repriced ${updated} products`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Repricing failed', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();