const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost', port: 5432, database: 'brandeduk_ralawise_backup', user: 'postgres', password: '1234', ssl: false
});
async function check() {
    const styles = ['UC901', 'UC902', 'UC903', 'UC904', 'UC906'];
    const res = await pool.query(`
    SELECT 
      sku_code, 
      style_code, 
      carton_price, 
      single_price, 
      sell_price, 
      sku_status
    FROM products 
    WHERE style_code = ANY($1)
    ORDER BY style_code, sku_code;
  `, [styles]);

    if (res.rows.length === 0) {
        console.log("No data found at all for these styles.");
    } else {
        // Group by style to see if ANY variant has data
        const summary = {};
        res.rows.forEach(r => {
            if (!summary[r.style_code]) summary[r.style_code] = { count: 0, withData: 0 };
            summary[r.style_code].count++;
            if (parseFloat(r.carton_price || 0) > 0 || parseFloat(r.sell_price || 0) > 0) {
                summary[r.style_code].withData++;
            }
        });
        console.log("Style Data Summary:");
        console.table(summary);

        console.log("\nFull Batch Data:");
        console.log(JSON.stringify(res.rows, null, 2));
    }
    await pool.end();
}
check();
