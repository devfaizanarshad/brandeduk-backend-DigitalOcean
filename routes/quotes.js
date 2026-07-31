const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendQuoteEmail, sendQuoteEmailWithAttachments } = require('../utils/emailService');
const { extractQuoteNotes } = require('../utils/quoteNotes');
const { queryWithTimeout } = require('../config/database');
const stripeQuoteRoutes = require('./stripeQuotes');

router.use('/stripe', stripeQuoteRoutes);

// ===== MULTER CONFIGURATION =====
const logoUploadsDir = path.join(__dirname, '..', 'uploads', 'logos');
const previewUploadsDir = path.join(__dirname, '..', 'uploads', 'quote-previews');
[logoUploadsDir, previewUploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const isPreviewField = (fieldname = '') => {
  const normalized = String(fieldname).toLowerCase();
  return normalized === 'preview_image'
    || normalized === 'mockup_image'
    || normalized === 'design_preview'
    || normalized === 'product_preview'
    || normalized === 'garment_preview'
    || normalized === 'customized_product_image'
    || normalized.startsWith('preview_')
    || normalized.startsWith('mockup_');
};

const getPreviewView = (fieldname = '') => {
  const normalized = String(fieldname).toLowerCase();
  if (['preview_image', 'mockup_image', 'design_preview', 'product_preview', 'garment_preview', 'customized_product_image'].includes(normalized)) {
    return 'main';
  }
  return normalized.replace(/^(preview|mockup)_/, '') || 'main';
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, isPreviewField(file.fieldname) ? previewUploadsDir : logoUploadsDir),
  filename: (req, file, cb) => {
    const ext = getImageExtension(file);
    const fieldSlug = String(file.fieldname || 'image').replace(/[^a-zA-Z0-9_-]/g, '-');
    const prefix = isPreviewField(file.fieldname) ? 'preview' : 'logo';
    const positionSlug = fieldSlug.replace(/^(logo|preview|mockup)_/, '') || 'main';
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    cb(null, `${prefix}-${positionSlug}-${uniqueSuffix}${ext}`);
  }
});

const IMAGE_EXTENSIONS_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const getImageExtension = (file = {}) => {
  return IMAGE_EXTENSIONS_BY_MIME[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.jpg';
};

const getAttachmentFilename = (file = {}, fallback = 'logo') => {
  const parsed = path.parse(file.originalname || fallback);
  const ext = getImageExtension(file);
  return `${parsed.name || fallback}${ext}`;
};

const fileFilter = (req, file, cb) => {
  if (!file || !file.originalname || file.size === 0) return cb(null, false);
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Only image files are allowed.`), false);
  }
};

const upload = multer({
  storage,
  // A quote can include several garments and several decorated views per
  // garment. Keep the per-file cap while allowing all view previews through.
  limits: { fileSize: 5 * 1024 * 1024, files: 30 },
  fileFilter
});

const MAX_TOTAL_ATTACHMENT_BYTES = 28 * 1024 * 1024;
const shouldAttachQuoteLogos = String(process.env.QUOTE_EMAIL_ATTACH_LOGOS || '').toLowerCase() === 'true';

const cleanupFiles = (files) => {
  if (!files || !Array.isArray(files)) return;
  files.forEach(file => {
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (err) {}
  });
};

const buildLogoUrl = (req, filename) => {
  const configuredBaseUrl = process.env.API_PUBLIC_URL || process.env.API_BASE_URL;
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const baseUrl = configuredBaseUrl || `${protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/logos/${encodeURIComponent(filename)}`;
};

const buildPreviewUrl = (req, filename) => {
  const configuredBaseUrl = process.env.API_PUBLIC_URL || process.env.API_BASE_URL;
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const baseUrl = configuredBaseUrl || `${protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/quote-previews/${encodeURIComponent(filename)}`;
};

const normalizePreviewImages = (quoteData = {}) => {
  const previews = {};
  const supplied = quoteData.previewImages || quoteData.preview_images || {};

  if (supplied && typeof supplied === 'object' && !Array.isArray(supplied)) {
    Object.entries(supplied).forEach(([key, value]) => {
      if (typeof value === 'string' && value.trim()) previews[key] = { url: value.trim() };
      else if (value && typeof value === 'object' && typeof value.url === 'string') previews[key] = { ...value };
    });
  }

  const singlePreview = quoteData.previewImage || quoteData.preview_image || quoteData.mockupImage || quoteData.mockup_image;
  if (typeof singlePreview === 'string' && singlePreview.trim()) {
    previews.main = { url: singlePreview.trim() };
  }

  return previews;
};

const detectClientDevice = (userAgent = '') => {
  const ua = String(userAgent || '').toLowerCase();

  if (!ua) return 'unknown';
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
};

const buildQuoteRequestLog = (req, quoteId, quoteData, logoFiles, previewImages) => {
  const userAgent = req.get('user-agent') || '';

  return {
    event: 'quote_submission_received',
    quoteId,
    receivedAt: new Date().toISOString(),
    request: {
      method: req.method,
      path: req.originalUrl || req.path,
      ip: req.ip || req.connection?.remoteAddress || null,
      contentType: req.get('content-type') || null,
      origin: req.get('origin') || null,
      referer: req.get('referer') || null,
      userAgent,
      clientDevice: detectClientDevice(userAgent),
    },
    uploadedLogos: Object.entries(logoFiles).map(([position, file]) => ({
      position,
      originalName: file.originalName || null,
      storedFilename: file.filename || null,
      mimetype: file.mimetype || null,
      url: file.url || null,
    })),
    uploadedPreviews: Object.entries(previewImages).map(([view, file]) => ({
      view,
      originalName: file.originalName || null,
      storedFilename: file.filename || null,
      mimetype: file.mimetype || null,
      url: file.url || null,
    })),
    quoteData,
  };
};

const logQuoteRequest = (req, quoteId, quoteData, logoFiles, previewImages) => {
  const snapshot = buildQuoteRequestLog(req, quoteId, quoteData, logoFiles, previewImages);

  console.log('\n[QUOTES] ===== FRONTEND TO BACKEND PAYLOAD =====');
  console.log(JSON.stringify(snapshot, null, 2));
  console.log('[QUOTES] ===== END PAYLOAD =====\n');
};

/**
 * POST /api/quotes
 */
router.post('/', upload.any(), async (req, res) => {
  const uploadedFiles = req.files || [];

  try {
    let quoteData;

    // Parse quoteData
    if (req.body.quoteData) {
      try {
        let quoteDataString = req.body.quoteData;
        if (typeof quoteDataString === 'string') {
          quoteDataString = quoteDataString.trim();
          try {
            const decoded = decodeURIComponent(quoteDataString);
            if (decoded !== quoteDataString) quoteDataString = decoded;
          } catch (e) {}
          if (quoteDataString.startsWith('"') && quoteDataString.endsWith('"')) {
            try { quoteDataString = JSON.parse(quoteDataString); } catch (e) {}
          }
          quoteData = typeof quoteDataString === 'string' ? JSON.parse(quoteDataString) : quoteDataString;
        } else {
          quoteData = req.body.quoteData;
        }
      } catch (parseErr) {
        cleanupFiles(uploadedFiles);
        return res.status(400).json({ success: false, message: 'Invalid quoteData JSON' });
      }
    } else if (req.body.customer || req.body.basket) {
      quoteData = req.body;
    } else {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ success: false, message: 'quoteData is required' });
    }

    if (!quoteData || typeof quoteData !== 'object') {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ success: false, message: 'Invalid quote data structure' });
    }

    const { customer, summary, basket, customizations, timestamp } = quoteData;
    const { notes, notesNodes } = extractQuoteNotes(quoteData);

    if (!customer || !customer.email || !customer.fullName) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ success: false, message: 'Customer details required' });
    }

    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Logos processing
    const logoFiles = {};
    const previewImages = normalizePreviewImages(quoteData);
    const logoAttachments = [];
    uploadedFiles.forEach(file => {
      if (file.fieldname.startsWith('logo_')) {
        const positionSlug = file.fieldname.replace('logo_', '');
        const contentId = `${quoteId}-${positionSlug}`.replace(/[^a-zA-Z0-9_-]/g, '');
        logoFiles[positionSlug] = {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          url: buildLogoUrl(req, file.filename),
          contentId,
        };
        if (shouldAttachQuoteLogos) {
          try {
            logoAttachments.push({
              filename: getAttachmentFilename(file, `logo-${positionSlug}`),
              content: fs.readFileSync(file.path),
              contentType: file.mimetype,
              url: logoFiles[positionSlug].url,
            });
          } catch (e) {}
        }
      } else if (isPreviewField(file.fieldname)) {
        const view = getPreviewView(file.fieldname);
        previewImages[view] = {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          url: buildPreviewUrl(req, file.filename),
        };
      }
    });

    const totalAttachmentBytes = logoAttachments.reduce((sum, attachment) => {
      if (Buffer.isBuffer(attachment.content)) {
        return sum + attachment.content.length;
      }
      return sum;
    }, 0);

    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({
        success: false,
        message: 'Uploaded logos are too large to send by email. Please reduce the total logo size and try again.'
      });
    }

    const emailData = {
      quoteId,
      customer, summary: summary || {}, 
      basket: Array.isArray(basket) ? basket.map(item => ({ ...item })) : [],
      customizations: Array.isArray(customizations) ? customizations.map(c => ({ ...c })) : [],
      logos: logoFiles, previewImages, notes, notesNodes,
      timestamp: timestamp || new Date().toISOString(),
    };

    logQuoteRequest(req, quoteId, emailData, logoFiles, previewImages);

    // Send email
    let emailResult;
    try {
      if (Object.keys(logoFiles).length > 0 || Object.keys(previewImages).length > 0) {
        if (shouldAttachQuoteLogos && logoAttachments.length > 0) {
          console.log(`[EMAIL] Quote logo attachments enabled (${logoAttachments.length} file(s))`);
        } else {
          console.log('[EMAIL] Quote logo attachments disabled; sending logo links only');
        }
        emailResult = await sendQuoteEmailWithAttachments(
          emailData,
          shouldAttachQuoteLogos ? logoAttachments : [],
          logoFiles
        );
      } else {
        emailResult = await sendQuoteEmail(emailData);
      }
    } catch (emailErr) {
      console.error('[EMAIL ERROR]', emailErr.message);
      if (process.env.NODE_ENV === 'production') throw emailErr;
    }

    // Save to DB
    try {
      const insertSql = `INSERT INTO quote_requests (quote_id, customer_name, customer_email, customer_phone, customer_company, customer_address, total_amount, quote_data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
      await queryWithTimeout(insertSql, [quoteId, customer.fullName, customer.email, customer.phone || null, customer.company || null, customer.address || null, summary?.total || null, JSON.stringify(emailData)], 10000);
    } catch (dbErr) {}

    if (emailResult?.success || process.env.NODE_ENV !== 'production') {
      return res.status(200).json({
        success: true,
        message: emailResult?.success ? 'Quote submitted successfully' : 'Quote processed (Dev Mode)',
        quoteId,
        logos: logoFiles,
        previewImages
      });
    }

    return res.status(500).json({ success: false, message: 'Failed to send quote email' });

  } catch (error) {
    cleanupFiles(uploadedFiles);
    console.error('[QUOTES ERROR]', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ success: false, message: error.message });
  next(error);
});

module.exports = router;
