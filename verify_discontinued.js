const { pool } = require('./config/database');
async function test() {
    try {
        const discontinuedSample = await pool.query("SELECT style_code, primary_image_url, colour_image_url, carton_price, sell_price, sku_status FROM products WHERE sku_status = 'Discontinued' LIMIT 2");
        console.log('Discontinued sample (raw):');
        console.log(JSON.stringify(discontinuedSample.rows, null, 2));

        // Check if any have missing primary image but have color image
        const missingPrimary = await pool.query("SELECT style_code, primary_image_url, colour_image_url FROM products WHERE sku_status = 'Discontinued' AND primary_image_url IS NULL AND colour_image_url IS NOT NULL LIMIT 5");
        console.log('Missing primary, has colour image:');
        console.log(JSON.stringify(missingPrimary.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
test();
