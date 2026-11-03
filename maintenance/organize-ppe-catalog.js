const { pool } = require('../config/database');

const apply = process.argv.includes('--apply');

const ROOT = {
  name: 'PPE & Safety Wear',
  slug: 'ppe-safety-wear',
  description: 'PPE & Safety Workwear UK | Protective Clothing & Hi-Vis | Branded UK. Protective workwear and safety equipment for construction, warehouse, logistics and industrial teams. Branding must not cover reflective areas or compromise product certification or protective performance.'
};

const GROUPS = [
  ['hi-vis-clothing', 'Hi-Vis Clothing', 10, 'Certified and protective high-visibility clothing. Hi-Vis remains available as a separate main navigation category.'],
  ['protective-jackets-outerwear', 'Protective Jackets & Outerwear', 20, 'Protective jackets, softshells, fleeces, bodywarmers and weatherproof outerwear.'],
  ['protective-trousers-coveralls', 'Protective Trousers & Coveralls', 30, 'Work trousers, coveralls, rain suits and protective legwear.'],
  ['gloves-hand-protection', 'Gloves & Hand Protection', 40, 'Work gloves and hand protection.'],
  ['safety-footwear', 'Safety Footwear', 50, 'Safety boots, shoes and protective work footwear.'],
  ['head-protection', 'Head Protection', 60, 'Safety helmets, bump caps and protective headwear.'],
  ['eye-hearing-protection', 'Eye & Hearing Protection', 70, 'Safety glasses, goggles and hearing protection.'],
  ['respiratory-protection', 'Respiratory Protection', 80, 'Masks and respiratory protection products.'],
  ['ppe-accessories', 'PPE Accessories', 90, 'Kneepads, armbands, first-aid products and other safety accessories.']
];

async function findRoot(client) {
  const result = await client.query(`
    SELECT id FROM categories
    WHERE slug IN ('ppe-safety-wear', 'safetywear')
    ORDER BY CASE slug WHEN 'ppe-safety-wear' THEN 0 ELSE 1 END
    LIMIT 1
  `);
  if (!result.rows[0]) throw new Error('Safetywear category was not found.');
  return result.rows[0].id;
}

async function upsertCategory(client, category, parentId = null) {
  const existing = await client.query('SELECT id FROM categories WHERE slug = $1 ORDER BY id LIMIT 1', [category.slug]);
  if (existing.rows[0]) {
    await client.query(`
      UPDATE categories
      SET name = $1, parent_id = $2, category_type = 'ppe', display_order = $3,
          description = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
    `, [category.name, parentId, category.displayOrder || 0, category.description, existing.rows[0].id]);
    return existing.rows[0].id;
  }

  const inserted = await client.query(`
    INSERT INTO categories (name, slug, parent_id, category_type, display_order, description)
    VALUES ($1, $2, $3, 'ppe', $4, $5)
    RETURNING id
  `, [category.name, category.slug, parentId, category.displayOrder || 0, category.description]);
  return inserted.rows[0].id;
}

async function stageProducts(client, sourceRootId) {
  await client.query(`
    CREATE TEMP TABLE staged_ppe_products ON COMMIT DROP AS
    SELECT DISTINCT p.id AS product_id, p.style_code,
      LOWER(COALESCE(pt.name, '')) AS product_type,
      LOWER(COALESCE(s.style_name, '')) AS style_name,
      LOWER(COALESCE(string_agg(DISTINCT source.name, ' '), '')) AS source_categories
    FROM products p
    JOIN styles s ON s.style_code = p.style_code
    LEFT JOIN product_types pt ON pt.id = s.product_type_id
    LEFT JOIN product_categories source_pc ON source_pc.product_id = p.id
    LEFT JOIN categories source ON source.id = source_pc.category_id
    WHERE EXISTS (
      SELECT 1
      FROM product_categories seed_pc
      JOIN categories seed ON seed.id = seed_pc.category_id
      WHERE seed_pc.product_id = p.id
        AND (seed.id = $1 OR seed.slug IN ('ppe', 'personal-protection'))
    )
      AND LOWER(COALESCE(pt.name, '')) <> 'snoods'
      AND LOWER(COALESCE(s.style_name, '')) !~ '(snood|morf|face covering|disposable face mask)'
    GROUP BY p.id, p.style_code, pt.name, s.style_name
  `, [sourceRootId]);

  await client.query(`
    CREATE TEMP TABLE staged_ppe_assignments (
      product_id integer NOT NULL,
      group_slug text NOT NULL,
      PRIMARY KEY (product_id, group_slug)
    ) ON COMMIT DROP
  `);

  const rules = [
    ['hi-vis-clothing', `product_type IN ('hi vis', 'polos', 't-shirts', 'tabards') OR style_name ~ '(hi[ -]?vis|high visibility|reflective)' OR source_categories ~ 'hi[ -]?vis'`],
    ['protective-jackets-outerwear', `product_type IN ('jackets', 'softshells', 'gilets & body warmers', 'fleece', 'hoodies', 'sweatshirts', 'ponchos', 'rain suits')`],
    ['protective-trousers-coveralls', `product_type IN ('trousers', 'coveralls', 'coverall', 'rain suits', 'sweatpants', 'shorts')`],
    ['gloves-hand-protection', `product_type = 'gloves' OR style_name ~ '(work|safety|grip|rigger|thermal|protective).{0,20}glove'`],
    ['safety-footwear', `product_type IN ('boots', 'trainers', 'shoes', 'footwear') OR style_name ~ '(safety|steel toe|composite toe).{0,20}(boot|shoe|trainer)'`],
    ['head-protection', `product_type IN ('helmets', 'caps', 'beanies') OR style_name ~ '(helmet|hard hat|bump cap)'`],
    ['eye-hearing-protection', `product_type IN ('glasses', 'goggles', 'ear defenders', 'ear plugs') OR style_name ~ '(safety spectacle|safety glasses|goggle|hearing protection|ear defender|ear plug)'`],
    ['respiratory-protection', `style_name ~ '(certified respirator|ffp[123]|en 149)'`],
    ['ppe-accessories', `product_type IN ('accessories', 'armbands', 'bags', 'first aid boxes', 'kneepads')`]
  ];

  for (const [slug, condition] of rules) {
    await client.query(`
      INSERT INTO staged_ppe_assignments (product_id, group_slug)
      SELECT product_id, $1 FROM staged_ppe_products WHERE ${condition}
      ON CONFLICT DO NOTHING
    `, [slug]);
  }

  await client.query(`
    INSERT INTO staged_ppe_assignments (product_id, group_slug)
    SELECT p.product_id, 'ppe-accessories'
    FROM staged_ppe_products p
    WHERE NOT EXISTS (SELECT 1 FROM staged_ppe_assignments a WHERE a.product_id = p.product_id)
    ON CONFLICT DO NOTHING
  `);
}

async function report(client, rootId) {
  const root = await client.query(`
    SELECT COUNT(DISTINCT style_code)::int AS styles,
      COUNT(DISTINCT product_id)::int AS skus,
      COUNT(DISTINCT style_code) FILTER (WHERE EXISTS (
        SELECT 1 FROM products live WHERE live.style_code = staged_ppe_products.style_code AND live.sku_status = 'Live'
      ))::int AS live_styles
    FROM staged_ppe_products
  `);
  const groups = await client.query(`
    SELECT g.name, g.slug, COUNT(DISTINCT p.style_code)::int AS styles,
      COUNT(DISTINCT a.product_id)::int AS skus
    FROM categories g
    LEFT JOIN staged_ppe_assignments a ON a.group_slug = g.slug
    LEFT JOIN staged_ppe_products p ON p.product_id = a.product_id
    WHERE g.parent_id = $1 AND g.category_type = 'ppe'
    GROUP BY g.id, g.name, g.slug, g.display_order
    ORDER BY g.display_order, g.name
  `, [rootId]);
  const coverage = await client.query(`
    SELECT COUNT(DISTINCT p.style_code)::int AS ungrouped_styles
    FROM staged_ppe_products p
    WHERE NOT EXISTS (SELECT 1 FROM staged_ppe_assignments a WHERE a.product_id = p.product_id)
  `);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    root: ROOT,
    ...root.rows[0],
    ...coverage.rows[0],
    groups: groups.rows
  }, null, 2));
}

async function applyAssignments(client, rootId, groupIds) {
  const managedIds = [...groupIds.values()];
  await client.query('DELETE FROM product_categories WHERE category_id = $1 OR category_id = ANY($2::int[])', [rootId, managedIds]);
  await client.query(`
    INSERT INTO product_categories (product_id, category_id)
    SELECT DISTINCT a.product_id, mapping.category_id
    FROM staged_ppe_assignments a
    JOIN unnest($1::text[], $2::int[]) AS mapping(group_slug, category_id)
      ON mapping.group_slug = a.group_slug
  `, [[...groupIds.keys()], managedIds]);
  await client.query(`
    INSERT INTO product_categories (product_id, category_id)
    SELECT staged.product_id, $1
    FROM staged_ppe_products staged
    WHERE NOT EXISTS (
      SELECT 1 FROM product_categories existing
      WHERE existing.product_id = staged.product_id AND existing.category_id = $1
    )
  `, [rootId]);
  await client.query('DELETE FROM category_hierarchy_cache WHERE category_id = $1 OR category_id = ANY($2::int[])', [rootId, managedIds]);
  await client.query(`
    INSERT INTO category_hierarchy_cache (category_id, all_child_ids, updated_at)
    VALUES ($1, $2::int[], CURRENT_TIMESTAMP)
  `, [rootId, managedIds]);
  for (const categoryId of managedIds) {
    await client.query(`
      INSERT INTO category_hierarchy_cache (category_id, all_child_ids, updated_at)
      VALUES ($1, ARRAY[]::int[], CURRENT_TIMESTAMP)
    `, [categoryId]);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rootId = await findRoot(client);
    await client.query(`
      UPDATE categories SET name = $1, slug = $2, category_type = 'ppe', display_order = 60,
        description = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4
    `, [ROOT.name, ROOT.slug, ROOT.description, rootId]);

    const groupIds = new Map();
    for (const [slug, name, displayOrder, description] of GROUPS) {
      const id = await upsertCategory(client, { slug, name, displayOrder, description }, rootId);
      groupIds.set(slug, id);
    }

    await stageProducts(client, rootId);
    await report(client, rootId);
    if (apply) {
      await applyAssignments(client, rootId, groupIds);
      await client.query('COMMIT');
      console.log('PPE catalogue organisation applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('Dry run complete. No database changes were saved.');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
