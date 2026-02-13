async function verify() {
    const baseUrl = 'http://localhost:3004';
    try {
        const productsRes = await fetch(`${baseUrl}/api/products?limit=1`);
        const productsData = await productsRes.json();
        const hasCarton = productsData.items?.[0] && 'carton_price' in productsData.items[0];
        console.log(`MAIN_API_CARTON_PRICE: ${hasCarton ? 'YES' : 'NO'}`);
        if (hasCarton) console.log(`SAMPLE_CARTON_PRICE: ${productsData.items[0].carton_price}`);

        const discontinuedRes = await fetch(`${baseUrl}/api/products/discontinued?limit=1`);
        const discontinuedData = await discontinuedRes.json();
        const hasPrice = discontinuedData.items?.[0] && discontinuedData.items[0].price !== undefined;
        console.log(`DISCONTINUED_API_PRICE: ${hasPrice ? 'YES' : 'NO'}`);
        if (hasPrice) console.log(`SAMPLE_DISCONTINUED_PRICE: ${discontinuedData.items[0].price}`);
    } catch (e) { console.error(e); }
}
verify();
