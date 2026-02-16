
/**
 * DEEP CACHE WARMING & STRESS TEST SCRIPT
 * 
 * Simulates 100+ real-world user search scenarios to:
 * 1. Validate API stability under load
 * 2. Pre-warm Redis cache for instant user experience
 * 3. Cover extensive permutations of Brands, Categories, and Attributes
 */

const BASE_URL = 'http://127.0.0.1:5000/api/products';
const DELAY_MS = 100; // Small delay to prevent local port exhaustion

// --- 1. CORE DATASETS ---

const brands = [
    'Nike', 'Adidas', 'Puma', 'Under Armour', 'Regatta',
    'Russell', 'Fruit of the Loom', 'Gildan', 'AWDis',
    'Result', 'Stormtech', 'Beechfield', 'Tee Jays'
];

const categories = [
    'T-shirt', 'Polo', 'Hoodie', 'Sweatshirt', 'Jacket',
    'Fleece', 'Shorts', 'Pants', 'Joggers', 'Vest',
    'Cap', 'Beanie', 'Bag'
];

const colors = [
    'Black', 'White', 'Red', 'Blue', 'Navy',
    'Grey', 'Green', 'Orange', 'Yellow'
];

const genders = ['Mens', 'Womens', 'Kids', 'Unisex'];

const activities = ['Running', 'Gym', 'Golf', 'Football', 'Workwear'];

// --- 2. GENERATE EXTENSIVE TEST SCENARIOS ---

const scenarios = [];

// A. Core Category Searches (Standard)
categories.forEach(cat => {
    scenarios.push({ q: cat, desc: `Core Category: ${cat}` });
    // Plural variations
    scenarios.push({ q: cat + 's', desc: `Core Category Plural: ${cat}s` });
});

// B. Brand Searches (Standard)
brands.forEach(brand => {
    scenarios.push({ q: brand, desc: `Core Brand: ${brand}` });
});

// C. Brand + Category Combinations (High Volume)
// e.g., "Nike Hoodie", "Adidas Polo"
brands.slice(0, 8).forEach(brand => {
    categories.slice(0, 8).forEach(cat => {
        scenarios.push({ q: `${brand} ${cat}`, desc: `Combo: ${brand} + ${cat}` });
    });
});

// D. Attribute Combinations
// e.g., "Black Hoodie", "Red T-shirt"
colors.forEach(color => {
    categories.slice(0, 5).forEach(cat => {
        scenarios.push({ q: `${color} ${cat}`, desc: `Color: ${color} + ${cat}` });
    });
});

// E. Gender Specific
// e.g., "Mens Polo", "Womens Fleece"
genders.forEach(gender => {
    categories.slice(0, 4).forEach(cat => {
        scenarios.push({ q: `${gender} ${cat}`, desc: `Gender: ${gender} + ${cat}` });
    });
});

// F. Sport/Activity Specific
activities.forEach(activity => {
    scenarios.push({ q: activity, desc: `Activity: ${activity}` });
    scenarios.push({ q: `${activity} clothing`, desc: `Activity Phrase: ${activity} clothing` });
});

// G. Sort Variations (Price, Newest)
const sortTests = [
    { q: 'Polo', sort: 'price', order: 'asc', desc: 'Polo - Price Low to High' },
    { q: 'Hoodie', sort: 'price', order: 'desc', desc: 'Hoodie - Price High to Low' },
    { q: 'Nike', sort: 'newest', desc: 'Nike - Newest Items' },
    { q: 'T-shirt', sort: 'best', desc: 'T-shirt - Best Sellers' }
];
scenarios.push(...sortTests);

// H. Complex Filter + Search
const filterTests = [
    { q: 'Polo', priceMin: 10, priceMax: 20, desc: 'Polo + Price Range £10-20' },
    { q: 'Hoodie', brand: 'Nike', color: 'Black', desc: 'Complex: Hoodie + Nike + Black' },
    { q: 'Jacket', waterproof: 'true', desc: 'Jacket + Attribute (Waterproof)' }
];
scenarios.push(...filterTests);


// --- 3. EXECUTION ENGINE ---

async function runAudit() {
    console.log(`🚀 STARTING DEEP CACHE WARM & AUDIT`);
    console.log(`🎯 Total Scenarios: ${scenarios.length}`);
    console.log(`--------------------------------------------------`);

    let successCount = 0;
    let totalTime = 0;

    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];

        // Construct Query String manually to avoid dependency issues
        const params = new URLSearchParams();
        Object.keys(scenario).forEach(key => {
            if (key !== 'desc') params.append(key, scenario[key]);
        });

        const url = `${BASE_URL}?${params.toString()}`;

        try {
            const start = Date.now();
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            const duration = Date.now() - start;

            const itemCount = data.items ? data.items.length : 0;
            const totalCount = data.total || 0;

            const idxStr = (i + 1).toString().padStart(3);
            console.log(`[${idxStr}/${scenarios.length}] ✅ ${scenario.desc.padEnd(45)} | Found: ${itemCount.toString().padStart(3)} (Total: ${totalCount}) | ⏱️ ${duration}ms`);

            successCount++;
            totalTime += duration;

        } catch (err) {
            const idxStr = (i + 1).toString().padStart(3);
            console.error(`[${idxStr}/${scenarios.length}] ❌ ${scenario.desc.padEnd(45)} | FAILED: ${err.message}`);
        }

        // Rate limit delay
        await new Promise(r => setTimeout(r, DELAY_MS));
    }

    console.log(`--------------------------------------------------`);
    console.log(`🏁 COMPLETE`);
    console.log(`✅ Success: ${successCount}/${scenarios.length}`);
    if (successCount > 0) {
        const avg = totalTime / successCount;
        console.log(`⏱️ Avg Response: ${avg.toFixed(0)}ms`);
    }
}

runAudit();
