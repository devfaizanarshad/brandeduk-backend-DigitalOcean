const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendQuoteEmail, sendQuoteEmailWithAttachments } = require('../utils/emailService');
const { extractQuoteNotes } = require('../utils/quoteNotes');
const { queryWithTimeout } = require('../config/database');

// ===== MULTER CONFIGURATION =====
const uploadsDir = path.join(__dirname, '..', 'uploads', 'logos');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const positionSlug = file.fieldname.replace('logo_', '');
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    cb(null, `logo-${positionSlug}-${uniqueSuffix}${ext}`);
  }
});

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
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter
});

const MAX_TOTAL_ATTACHMENT_BYTES = 28 * 1024 * 1024;

const cleanupFiles = (files) => {
  if (!files || !Array.isArray(files)) return;
  files.forEach(file => {
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (err) {}
  });
};

const buildLogoUrl = (req, filename) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/logos/${encodeURIComponent(filename)}`;
};

const detectClientDevice = (userAgent = '') => {
  const ua = String(userAgent || '').toLowerCase();

  if (!ua) return 'unknown';
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
};

const buildQuoteRequestLog = (req, quoteId, quoteData, logoFiles) => {
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
    quoteData,
  };
};

const logQuoteRequest = (req, quoteId, quoteData, logoFiles) => {
  const snapshot = buildQuoteRequestLog(req, quoteId, quoteData, logoFiles);

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
        try {
          logoAttachments.push({
            filename: file.originalname,
            content: fs.readFileSync(file.path),
            contentType: file.mimetype,
            contentId,
            url: logoFiles[positionSlug].url,
          });
        } catch (e) {}
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
      customer, summary: summary || {}, 
      basket: Array.isArray(basket) ? basket.map(item => ({ ...item })) : [],
      customizations: Array.isArray(customizations) ? customizations.map(c => ({ ...c })) : [],
      logos: logoFiles, notes, notesNodes,
      timestamp: timestamp || new Date().toISOString(),
    };

    logQuoteRequest(req, quoteId, emailData, logoFiles);

    // Send email
    let emailResult;
    try {
      if (logoAttachments.length > 0) {
        emailResult = await sendQuoteEmailWithAttachments(emailData, logoAttachments, logoFiles);
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
        logos: logoFiles
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
