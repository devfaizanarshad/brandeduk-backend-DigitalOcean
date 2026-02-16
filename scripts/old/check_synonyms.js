const { pool } = require('../config/database');
async function main() {
    const r = await pool.query("SELECT term, canonical, synonym_type FROM search_synonyms ORDER BY synonym_type, term");
    console.log('DB Synonyms:');
    r.rows.forEach(row => console.log(`  [${row.synonym_type}] "${row.term}" -> "${row.canonical}"`));
    console.log('\nTotal:', r.rows.length);
    pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
