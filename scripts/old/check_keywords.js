const { pool } = require('../config/database');
async function main() {
    const sk = await pool.query("SELECT DISTINCT keyword_type FROM style_keywords");
    console.log('Style Keyword Types:', sk.rows.map(r => r.keyword_type));

    const sports = await pool.query("SELECT name FROM style_keywords WHERE keyword_type = 'sport'");
    console.log('Sports in style_keywords:', sports.rows.map(r => r.name));

    const relSports = await pool.query("SELECT name FROM related_sports");
    console.log('Sports in related_sports:', relSports.rows.map(r => r.name));

    pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
