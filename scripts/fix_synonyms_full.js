/**
 * FIX ALL MISSING SYNONYMS
 * Adds singular → plural product type mappings + edge cases
 */
const { pool } = require('../config/database');

const synonyms = [
    // SINGULAR → PLURAL product types (critical missing ones)
    { term: 'jacket', canonical: 'jackets', type: 'product_type' },
    { term: 'shirt', canonical: 'shirts', type: 'product_type' },
    { term: 'sweatshirt', canonical: 'sweatshirts', type: 'product_type' },
    { term: 'cap', canonical: 'caps', type: 'product_type' },
    { term: 'beanie', canonical: 'beanies', type: 'product_type' },
    { term: 'bag', canonical: 'bags', type: 'product_type' },
    { term: 'legging', canonical: 'leggings', type: 'product_type' },
    { term: 'gilet', canonical: 'gilets & body warmers', type: 'product_type' },
    { term: 'body warmer', canonical: 'gilets & body warmers', type: 'product_type' },
    { term: 'trouser', canonical: 'trousers', type: 'product_type' },
    { term: 'blouse', canonical: 'blouses', type: 'product_type' },
    { term: 'softshell', canonical: 'softshells', type: 'product_type' },
    { term: 'apron', canonical: 'aprons', type: 'product_type' },
    { term: 'hat', canonical: 'hats', type: 'product_type' },
    { term: 'glove', canonical: 'gloves', type: 'product_type' },
    { term: 'sock', canonical: 'socks', type: 'product_type' },
    { term: 'towel', canonical: 'towels', type: 'product_type' },
    { term: 'vest', canonical: 'vests (t-shirt)', type: 'product_type' },
    { term: 'scarf', canonical: 'scarves', type: 'product_type' },
    { term: 'dress', canonical: 'dresses', type: 'product_type' },
    { term: 'trainer', canonical: 'trainers', type: 'product_type' },
    { term: 'boot', canonical: 'boots', type: 'product_type' },
    { term: 'sweatpant', canonical: 'sweatpants', type: 'product_type' },
    { term: 'jogger', canonical: 'sweatpants', type: 'product_type' },
    { term: 'joggers', canonical: 'sweatpants', type: 'product_type' },

    // FIX: "hoodies" synonym currently maps to "hooded sweatshirts" — should map to "hoodies"
    { term: 'hoodies', canonical: 'hoodies', type: 'product_type' },

    // MULTI-WORD edge cases
    { term: 't shirts', canonical: 't-shirts', type: 'product_type' },
    { term: 't shirt', canonical: 't-shirts', type: 'product_type' },
    { term: 'tee', canonical: 't-shirts', type: 'product_type' },
    { term: 'safety vest', canonical: 'safety vests', type: 'product_type' },

    // Common misspellings / alternate names
    { term: 'cardigan', canonical: 'cardigans', type: 'product_type' },
    { term: 'chino', canonical: 'chinos', type: 'product_type' },
    { term: 'jean', canonical: 'jeans', type: 'product_type' },
    { term: 'onesie', canonical: 'onesies', type: 'product_type' },
    { term: 'pyjama', canonical: 'pyjamas', type: 'product_type' },
    { term: 'jumper', canonical: 'sweatshirts', type: 'product_type' },  // UK English
    { term: 'pullover', canonical: 'sweatshirts', type: 'product_type' },
    { term: 'windbreaker', canonical: 'jackets', type: 'product_type' },
    { term: 'raincoat', canonical: 'jackets', type: 'product_type' },
    { term: 'coat', canonical: 'jackets', type: 'product_type' },
    { term: 'anorak', canonical: 'jackets', type: 'product_type' },
    { term: 'hi-vis', canonical: 'safety vests', type: 'product_type' },
    { term: 'hi vis', canonical: 'safety vests', type: 'product_type' },
    { term: 'tabard', canonical: 'tabards', type: 'product_type' },
    { term: 'tunic', canonical: 'tunics', type: 'product_type' },
    { term: 'umbrella', canonical: 'umbrellas', type: 'product_type' },
    { term: 'tie', canonical: 'ties', type: 'product_type' },
    { term: 'waistcoat', canonical: 'waistcoats', type: 'product_type' },
    { term: 'bodysuit', canonical: 'bodysuits', type: 'product_type' },
    { term: 'robe', canonical: 'robes', type: 'product_type' },

    // Colour synonyms (shade → primary colour)
    { term: 'navy', canonical: 'blue', type: 'colour' },
    { term: 'charcoal', canonical: 'grey', type: 'colour' },
    { term: 'burgundy', canonical: 'red', type: 'colour' },
    { term: 'olive', canonical: 'green', type: 'colour' },
    { term: 'khaki', canonical: 'green', type: 'colour' },
    { term: 'silver', canonical: 'grey', type: 'colour' },
    { term: 'gold', canonical: 'yellow', type: 'colour' },
    { term: 'cream', canonical: 'neutral', type: 'colour' },
    { term: 'beige', canonical: 'neutral', type: 'colour' },
    { term: 'maroon', canonical: 'red', type: 'colour' },
    { term: 'aqua', canonical: 'blue', type: 'colour' },
    { term: 'lilac', canonical: 'purple', type: 'colour' },
    { term: 'coral', canonical: 'orange', type: 'colour' },
    { term: 'tan', canonical: 'brown', type: 'colour' },
    { term: 'magenta', canonical: 'pink', type: 'colour' },
];

async function run() {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const s of synonyms) {
        try {
            const result = await pool.query(`
        INSERT INTO search_synonyms (term, canonical, synonym_type) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (term) DO UPDATE SET canonical = $2, synonym_type = $3
        RETURNING (xmax = 0) as is_insert
      `, [s.term, s.canonical, s.type]);

            if (result.rows[0].is_insert) {
                inserted++;
                console.log(`  + INSERT: "${s.term}" → "${s.canonical}" (${s.type})`);
            } else {
                updated++;
                console.log(`  ~ UPDATE: "${s.term}" → "${s.canonical}" (${s.type})`);
            }
        } catch (e) {
            skipped++;
            console.log(`  ✗ SKIP: "${s.term}" → ${e.message}`);
        }
    }

    console.log(`\nDone: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);

    // Verify total synonyms
    const total = await pool.query('SELECT COUNT(*) as c FROM search_synonyms');
    console.log(`Total synonyms in DB: ${total.rows[0].c}`);

    pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });
