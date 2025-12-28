/**
 * Test script for Product Type Filter API
 * 
 * Run with: node test-product-types.js
 * 
 * Make sure to update the BASE_URL if testing locally vs production
 */

const BASE_URL = 'https://brandeduk-backend.onrender.com';
// For local testing, use: const BASE_URL = 'http://localhost:3000';

async function testEndpoint(name, url) {
  console.log(`\n🧪 Testing: ${name}`);
  console.log(`   URL: ${url}`);
  
  try {
    const startTime = Date.now();
    const response = await fetch(url);
    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`   ❌ Failed: ${response.status} ${response.statusText}`);
      console.log(`   Error: ${errorText.substring(0, 200)}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`   ✅ Success (${duration}ms)`);
    
    // Pretty print summary
    if (data.productTypes) {
      console.log(`   📊 Found ${data.productTypes.length} product types`);
      console.log(`   📦 Total products: ${data.total.toLocaleString()}`);
      if (data.productTypes.length > 0) {
        console.log(`   📋 Top 5 types:`);
        data.productTypes.slice(0, 5).forEach((pt, i) => {
          console.log(`      ${i + 1}. ${pt.name}: ${pt.count.toLocaleString()} (${pt.percentage})`);
        });
      }
    } else if (data.items) {
      console.log(`   📦 Found ${data.total.toLocaleString()} products`);
      console.log(`   📄 Showing ${data.items.length} items (page ${data.page})`);
      if (data.items.length > 0) {
        console.log(`   💰 Price range: £${data.priceRange.min} - £${data.priceRange.max}`);
        console.log(`   📋 Sample products:`);
        data.items.slice(0, 3).forEach((item, i) => {
          console.log(`      ${i + 1}. ${item.name} (${item.code}) - £${item.price}`);
        });
      }
    }
    
    return data;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('🚀 Starting Product Type API Tests');
  console.log('=' .repeat(60));
  
  // Test 1: Get all product types
  const typesData = await testEndpoint(
    'Get All Product Types',
    `${BASE_URL}/api/products/types`
  );
  
  if (!typesData || !typesData.productTypes || typesData.productTypes.length === 0) {
    console.log('\n⚠️  No product types found. Cannot continue with filter tests.');
    return;
  }
  
  // Test 2: Filter by first product type
  const firstType = typesData.productTypes[0];
  await testEndpoint(
    `Filter by "${firstType.name}"`,
    `${BASE_URL}/api/products?productType=${encodeURIComponent(firstType.name)}&limit=5`
  );
  
  // Test 3: Filter by multiple product types
  if (typesData.productTypes.length >= 2) {
    const types = [typesData.productTypes[0].name, typesData.productTypes[1].name];
    await testEndpoint(
      `Filter by multiple types: "${types.join('", "')}"`,
      `${BASE_URL}/api/products?productType=${encodeURIComponent(types[0])}&productType=${encodeURIComponent(types[1])}&limit=5`
    );
  }
  
  // Test 4: Filter by common product types from your list
  const commonTypes = ['T-Shirts', 'Hoodies', 'Polos'];
  for (const type of commonTypes) {
    await testEndpoint(
      `Filter by "${type}"`,
      `${BASE_URL}/api/products?productType=${encodeURIComponent(type)}&limit=3`
    );
  }
  
  // Test 5: Combine product type with other filters
  await testEndpoint(
    `Filter by "T-Shirts" with price range`,
    `${BASE_URL}/api/products?productType=T-Shirts&priceMin=10&priceMax=50&limit=3`
  );
  
  // Test 6: Test case insensitivity
  await testEndpoint(
    `Filter by "t-shirts" (lowercase)`,
    `${BASE_URL}/api/products?productType=t-shirts&limit=3`
  );
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests completed!');
  console.log('\n💡 Tips:');
  console.log('   - Use productType parameter for single type');
  console.log('   - Use multiple productType parameters for multiple types');
  console.log('   - Product type names are case-insensitive');
  console.log('   - Can combine with other filters (price, color, etc.)');
}

// Run tests
runTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});

