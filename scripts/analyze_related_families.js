require('dotenv').config();
const { Client } = require('pg');

const STYLE_CODES = process.argv.slice(2);
const DEFAULT_CODES = ['GD001', 'GD01B', 'GD072', 'GD067', 'GD67B', 'GD024', 'GD24B', 'GD026'];

const NORMALIZED_ROOT_SQL = `
trim(
  regexp_replace(
    regexp_replace(
      regexp_replace(lower(style_name), '[^a-z0-9 ]', ' ', 'g'),
      '\\m(adult|youth|kids|kid|children|child|womens|women s|women|mens|men s|men|ladies|lady|girls|girl s|boys|boy s|unisex|junior|juniors|toddler|toddlers)\\M',
      '',
      'g'
    ),
    '\\s+',
    ' ',
    'g'
  )
)`;

async function connect() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: String(process.env.DB_SSL).toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false
  });

  await client.connect();
  return client;
}

async function getClusterStats(client) {
  const sql = `
    WITH roots AS (
      SELECT
        s.style_code,
        b.name AS brand,
        pt.name AS product_type,
        ${NORMALIZED_ROOT_SQL.replaceAll('style_name', 's.style_name')} AS root_name
      FROM styles s
      JOIN brands b ON b.id = s.brand_id
      JOIN product_types pt ON pt.id = s.product_type_id
      WHERE EXISTS (
        SELECT 1
        FROM products p
        WHERE p.style_code = s.style_code
          AND p.sku_status = 'Live'
      )
    )
    SELECT
      MAX(cnt) AS max_cluster_size,
      COUNT(*) FILTER (WHERE cnt = 2) AS groups_of_2,
      COUNT(*) FILTER (WHERE cnt = 3) AS groups_of_3,
      COUNT(*) FILTER (WHERE cnt = 4) AS groups_of_4,
      COUNT(*) FILTER (WHERE cnt > 4) AS groups_gt_4
    FROM (
      SELECT brand, product_type, root_name, COUNT(*) AS cnt
      FROM roots
      GROUP BY brand, product_type, root_name
      HAVING COUNT(*) > 1
    ) grouped
  `;

  const { rows } = await client.query(sql);
  return rows[0];
}

async function analyzeStyle(client, styleCode) {
  const metaSql = `
    SELECT
      s.style_code,
      s.style_name,
      b.name AS brand,
      pt.name AS product_type,
      g.slug AS gender,
      ag.slug AS age_group,
      ${NORMALIZED_ROOT_SQL.replaceAll('style_name', 's.style_name')} AS normalized_root
    FROM styles s
    LEFT JOIN brands b ON b.id = s.brand_id
    LEFT JOIN product_types pt ON pt.id = s.product_type_id
    LEFT JOIN genders g ON g.id = s.gender_id
    LEFT JOIN age_groups ag ON ag.id = s.age_group_id
    WHERE s.style_code = $1
  `;

  const currentSql = `
    WITH base AS (
      SELECT brand_id, product_type_id
      FROM styles
      WHERE style_code = $1
    )
    SELECT DISTINCT s.style_code, s.style_name
    FROM styles s
    JOIN products p
      ON p.style_code = s.style_code
     AND p.sku_status = 'Live'
    JOIN base b
      ON s.brand_id = b.brand_id
     AND s.product_type_id = b.product_type_id
    WHERE s.style_code <> $1
    ORDER BY s.style_name
  `;

  const normalizedSql = `
    WITH base AS (
      SELECT
        brand_id,
        product_type_id,
        ${NORMALIZED_ROOT_SQL} AS root_name
      FROM styles
      WHERE style_code = $1
    )
    SELECT DISTINCT
      s.style_code,
      s.style_name,
      g.slug AS gender,
      ag.slug AS age_group
    FROM styles s
    JOIN products p
      ON p.style_code = s.style_code
     AND p.sku_status = 'Live'
    LEFT JOIN genders g ON g.id = s.gender_id
    LEFT JOIN age_groups ag ON ag.id = s.age_group_id
    JOIN base b
      ON s.brand_id = b.brand_id
     AND s.product_type_id = b.product_type_id
    WHERE s.style_code <> $1
      AND ${NORMALIZED_ROOT_SQL.replaceAll('style_name', 's.style_name')} = b.root_name
    ORDER BY s.style_name
  `;

  const [meta, current, normalized] = await Promise.all([
    client.query(metaSql, [styleCode]),
    client.query(currentSql, [styleCode]),
    client.query(normalizedSql, [styleCode])
  ]);

  return {
    meta: meta.rows[0] || null,
    current: current.rows,
    normalized: normalized.rows
  };
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printRows(rows) {
  if (!rows.length) {
    console.log('(none)');
    return;
  }

  for (const row of rows) {
    console.log(JSON.stringify(row));
  }
}

async function main() {
  const codes = STYLE_CODES.length ? STYLE_CODES : DEFAULT_CODES;
  const client = await connect();

  try {
    printSection('Normalized Cluster Stats');
    console.log(JSON.stringify(await getClusterStats(client), null, 2));

    for (const code of codes) {
      const result = await analyzeStyle(client, code);

      printSection(`Style ${code}`);
      console.log(JSON.stringify(result.meta, null, 2));

      printSection(`Current same-brand + same-product-type candidates (${result.current.length})`);
      printRows(result.current.slice(0, 25));

      printSection(`Normalized family candidates (${result.normalized.length})`);
      printRows(result.normalized);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
