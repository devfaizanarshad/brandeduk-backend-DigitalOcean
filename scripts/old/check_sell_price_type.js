
const { queryWithTimeout } = require('../config/database');

async function checkSchema() {
    const res = await queryWithTimeout(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'sell_price'
  `, []);
    console.log('sell_price type:', res.rows[0]);
    process.exit(0);
}

checkSchema();
