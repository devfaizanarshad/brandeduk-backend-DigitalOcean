
const { queryWithTimeout } = require('../config/database');

async function debugSuggestions() {
    const searchTerm = 'golf polo';
    const likeTerm = `%${searchTerm}%`;

    console.log('--- DEBUGGING SUGGESTIONS FOR "golf polo" ---');

    const productsRes = await queryWithTimeout(`
      SELECT DISTINCT ON (s.style_code)
        s.style_code, 
        s.style_name, 
        p.primary_image_url, 
        b.name as brand
      FROM styles s
      JOIN products p ON s.style_code = p.style_code
      LEFT JOIN brands b ON s.brand_id = b.id
      WHERE p.sku_status = 'Live'
        AND (s.style_name ILIKE $1 OR s.style_code ILIKE $1 OR b.name ILIKE $1)
      LIMIT 5
    `, [likeTerm]);

    console.log('Simple ILIKE results count:', productsRes.rows.length);
    productsRes.rows.forEach(r => console.log(` - ${r.style_name} (${r.style_code})`));

    // Try splitting words
    const words = searchTerm.split(' ').filter(w => w.length > 2);
    if (words.length > 1) {
        console.log('\n--- Trying split words ---');
        const wordConditions = words.map((_, i) => `s.style_name ILIKE $${i + 1}`).join(' AND ');
        const wordParams = words.map(w => `%${w}%`);

        const splitRes = await queryWithTimeout(`
        SELECT DISTINCT ON (s.style_code)
          s.style_code, 
          s.style_name
        FROM styles s
        JOIN products p ON s.style_code = p.style_code
        WHERE p.sku_status = 'Live'
          AND ${wordConditions}
        LIMIT 5
      `, wordParams);

        console.log('Split ILIKE results count:', splitRes.rows.length);
        splitRes.rows.forEach(r => console.log(` - ${r.style_name}`));
    }

    process.exit(0);
}

debugSuggestions().catch(err => {
    console.error(err);
    process.exit(1);
});
