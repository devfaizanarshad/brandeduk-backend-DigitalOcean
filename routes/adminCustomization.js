const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const {
  getCustomizationConfigByProductTypeSlug,
  listCustomizationProductTypes,
  saveCustomizationConfig,
  deleteCustomizationConfig,
  normalizeSlug,
} = require('../services/customizationConfigService');

const uploadsDir = path.join(__dirname, '..', 'uploads', 'customization');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const IMAGE_EXTENSIONS_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = IMAGE_EXTENSIONS_BY_MIME[file.mimetype]
      || path.extname(file.originalname || '').toLowerCase()
      || '.png';
    const base = normalizeSlug(req.body.productTypeSlug || req.body.productType || 'customization');
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    cb(null, `${base}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image uploads are allowed'));
    }
  },
});

function buildImageUrl(req, filename) {
  const configuredBaseUrl = process.env.API_PUBLIC_URL || process.env.API_BASE_URL;
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const baseUrl = configuredBaseUrl || `${protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/customization/${encodeURIComponent(filename)}`;
}

router.get('/product-types', async (req, res) => {
  try {
    const items = await listCustomizationProductTypes();
    res.json({ success: true, data: { items } });
  } catch (error) {
    console.error('[CUSTOMIZATION] Failed to list product types:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:productTypeSlug', async (req, res) => {
  try {
    const config = await getCustomizationConfigByProductTypeSlug(req.params.productTypeSlug);
    if (!config) {
      return res.status(404).json({ success: false, message: 'Customization config not found' });
    }
    return res.json({ success: true, data: config });
  } catch (error) {
    console.error('[CUSTOMIZATION] Failed to fetch admin configuration:', error.message);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.put('/:productTypeSlug', async (req, res) => {
  try {
    const config = await saveCustomizationConfig(req.params.productTypeSlug, req.body || {});
    return res.json({ success: true, data: config });
  } catch (error) {
    console.error('[CUSTOMIZATION] Failed to save configuration:', error.message);
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }
});

router.delete('/:productTypeSlug', async (req, res) => {
  try {
    const result = await deleteCustomizationConfig(req.params.productTypeSlug);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[CUSTOMIZATION] Failed to delete configuration:', error.message);
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }
});

router.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded' });
    }

    const imageUrl = buildImageUrl(req, req.file.filename);
    return res.json({
      success: true,
      data: {
        filename: req.file.filename,
        imageUrl,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
    });
  } catch (error) {
    console.error('[CUSTOMIZATION] Failed to upload image:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
