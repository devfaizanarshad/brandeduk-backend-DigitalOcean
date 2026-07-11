const fs = require('fs');
const path = require('path');
const { saveCustomizationConfig } = require('../services/customizationConfigService');
const { pool } = require('../config/database');

const FOLDER_TO_SLUG = {
  'aprons': 'aprons',
  'bags': 'bags',
  'beanies': 'beanies',
  'caps': 'caps',
  'fleece': 'fleece',
  'gilets_body_warmers': 'gilets-body-warmers',
  'hats': 'hats',
  'hi_vis': 'safety-vests',
  'hoodies': 'hoodies',
  'jackets': 'jackets',
  'polos': 'polos',
  'shirts': 'shirts',
  'shorts': 'shorts',
  'softshells': 'softshells',
  'sweatpants': 'sweatpants',
  'sweatshirts': 'sweatshirts',
  'trousers': 'trousers',
  'tshirts': 'tshirts',
  'vests_tshirt': 'vests-t-shirt'
};

const TEMPLATES_ROOT = path.join(__dirname, '..', 'customization-garments-tamplates');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'customization');
const BASE_URL = 'https://api.brandeduk.com/uploads/customization';

async function seed() {
  console.log('=== STARTING CUSTOMIZATION TEMPLATE SEEDING ===');
  
  // Ensure uploads directory exists
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log(`Created directory: ${UPLOADS_DIR}`);
  }

  // Iterate over folder mappings
  for (const [folderName, productTypeSlug] of Object.entries(FOLDER_TO_SLUG)) {
    const folderPath = path.join(TEMPLATES_ROOT, folderName);
    
    if (!fs.existsSync(folderPath)) {
      console.warn(`[WARNING] Directory does not exist: ${folderPath}. Skipping.`);
      continue;
    }

    console.log(`\nProcessing folder: "${folderName}" for product type slug: "${productTypeSlug}"`);
    
    const files = fs.readdirSync(folderPath);
    const positions = [];
    
    // Sort files to keep a deterministic order (e.g. front first, then back, then others)
    const sortedFiles = files.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
    }).sort((a, b) => {
      const isFrontA = a.includes('-front');
      const isFrontB = b.includes('-front');
      if (isFrontA && !isFrontB) return -1;
      if (!isFrontA && isFrontB) return 1;
      
      const isBackA = a.includes('-back');
      const isBackB = b.includes('-back');
      if (isBackA && !isBackB) return -1;
      if (!isBackA && isBackB) return 1;
      
      return a.localeCompare(b);
    });

    for (let index = 0; index < sortedFiles.length; index++) {
      const filename = sortedFiles[index];
      const sourcePath = path.join(folderPath, filename);
      const ext = path.extname(filename).toLowerCase();
      
      // Determine position slug and label
      let positionSlug = 'front';
      let positionLabel = 'Front';
      
      if (filename.includes('-back')) {
        positionSlug = 'back';
        positionLabel = 'Back';
      } else if (filename.includes('-sleeve')) {
        positionSlug = 'sleeve';
        positionLabel = 'Sleeve';
      } else if (filename.includes('-left')) {
        positionSlug = 'left';
        positionLabel = 'Left Side';
      } else if (filename.includes('-right')) {
        positionSlug = 'right';
        positionLabel = 'Right Side';
      } else if (filename.includes('-side')) {
        positionSlug = 'side';
        positionLabel = 'Side';
      }

      // Generate unique name for the uploads folder
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const targetFilename = `${productTypeSlug}-${positionSlug}-${uniqueSuffix}${ext}`;
      const targetPath = path.join(UPLOADS_DIR, targetFilename);

      // Copy file
      fs.copyFileSync(sourcePath, targetPath);
      
      const imageUrl = `${BASE_URL}/${targetFilename}`;
      
      positions.push({
        label: positionLabel,
        slug: positionSlug,
        imageUrl,
        sortOrder: index,
        isActive: true,
        methods: [
          { method: 'embroidery', priceType: 'fixed', price: 0, enabled: true },
          { method: 'print', priceType: 'fixed', price: 0, enabled: true }
        ]
      });
    }

    if (positions.length === 0) {
      console.log(`No images found in folder: "${folderName}". Skipping config save.`);
      continue;
    }

    try {
      console.log(`Saving customization config for "${productTypeSlug}" with ${positions.length} positions...`);
      const result = await saveCustomizationConfig(productTypeSlug, { positions });
      console.log(`[SUCCESS] Configured ${productTypeSlug} (ID: ${result.productType.id})`);
    } catch (error) {
      console.error(`[ERROR] Failed to save config for "${productTypeSlug}":`, error.message);
    }
  }

  console.log('\n=== SEEDING COMPLETED ===');
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Fatal seeding error:', err);
    pool.end();
  });
