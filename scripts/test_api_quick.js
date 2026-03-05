/**
 * Quick API smoke tests - run with: node scripts/test_api_quick.js
 * Requires API server on http://localhost:3004
 */
const base = 'http://localhost:3004/api';

async function test(name, url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const ok = r.ok;
    const data = ok ? await r.json() : await r.text();
    const total = data.total ?? data.items?.length ?? '-';
    const agg = data.aggregations ? Object.keys(data.aggregations).filter(k => (data.aggregations[k] || []).length > 0) : [];
    console.log(ok ? 'OK' : 'FAIL', name);
    console.log('  URL:', url.length > 70 ? url.substring(0, 70) + '...' : url);
    if (data.items) console.log('  items:', data.items.length, 'total:', total);
    if (data.aggregations) console.log('  aggregations:', agg.join(', ') || '(none)');
    if (data.productType !== undefined) console.log('  productType:', data.productType);
    if (!ok) console.log('  error:', (typeof data === 'string' ? data : JSON.stringify(data)).substring(0, 120));
  } catch (e) {
    console.log('ERR', name, e.message);
  }
  console.log('');
}

async function main() {
  console.log('=== API tests (localhost:3004) ===\n');
  await test('GET /products (default)', base + '/products?page=1&limit=3');
  await test('GET /products supplier=ralawise', base + '/products?page=1&limit=3&supplier=ralawise');
  await test('GET /products supplier=absolute-apparel', base + '/products?page=1&limit=3&supplier=absolute-apparel');
  await test('GET /products q=uneek', base + '/products?page=1&limit=3&q=uneek');
  await test('GET /products q=absolute apparel', base + '/products?page=1&limit=3&q=absolute%20apparel');
  await test('GET /filters', base + '/filters');
  await test('GET /filters?supplier=absolute-apparel', base + '/filters?supplier=absolute-apparel');
  await test('GET /products/by-code/G5000', base + '/products/by-code/G5000');
  console.log('Done.');
}

main();
