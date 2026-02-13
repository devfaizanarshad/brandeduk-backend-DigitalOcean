const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendQuoteEmail, sendQuoteEmailWithAttachments } = require('../utils/emailService');
const { queryWithTimeout } = require('../config/database');

// ===== MULTER CONFIGURATION =====
// Configure storage for uploaded logo files
const uploadsDir = path.join(__dirname, '..', 'uploads', 'logos');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: logo-{position}-{timestamp}-{random}.{ext}
    const ext = path.extname(file.originalname).toLowerCase();
    const positionSlug = file.fieldname.replace('logo_', '');
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    cb(null, `logo-${positionSlug}-${uniqueSuffix}${ext}`);
  }
});

// File filter - only allow images
const fileFilter = (req, file, cb) => {
  // Skip empty fields (when logo field is sent but empty)
  if (!file || !file.originalname || file.size === 0) {
    return cb(null, false); // Skip empty files
  }

  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = allowedMimes.includes(file.mimetype);
  const extOk = allowedExts.includes(ext);

  if (mimeOk && extOk) {
    cb(null, true);
  } else {
    cb(new Error(`Only image files are allowed. Received: ${file.mimetype}`), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per file
    files: 10 // Max 10 logo files
  },
  fileFilter
});

// Helper to clean up uploaded files
const cleanupFiles = (files) => {
  if (!files || !Array.isArray(files)) return;
  files.forEach(file => {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (err) {
      console.error(`[QUOTES] Failed to delete file ${file.path}:`, err.message);
    }
  });
};

// Schedule cleanup of old files (files older than 24 hours)
const cleanupOldFiles = () => {
  try {
    if (!fs.existsSync(uploadsDir)) return;

    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    const files = fs.readdirSync(uploadsDir);
    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`[QUOTES] Cleaned up old file: ${file}`);
      }
    });
  } catch (err) {
    console.error('[QUOTES] Error during file cleanup:', err.message);
  }
};

// Run cleanup every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);
// Also run on startup
cleanupOldFiles();

/**
 * POST /api/quotes
 * Submit a quote request with optional logo file uploads
 * 
 * Supports two formats:
 * 1. multipart/form-data with quoteData JSON and logo_* files
 * 2. application/json (backward compatible)
 */
router.post('/', upload.any(), async (req, res) => {
  const uploadedFiles = req.files || [];

  try {
    let quoteData;

    // Debug logging
    console.log('[QUOTES] Content-Type:', req.headers['content-type']);
    console.log('[QUOTES] Body keys:', Object.keys(req.body || {}));
    console.log('[QUOTES] quoteData exists:', !!req.body.quoteData);
    console.log('[QUOTES] quoteData type:', typeof req.body.quoteData);
    if (req.body.quoteData) {
      console.log('[QUOTES] quoteData length:', req.body.quoteData.length);
      console.log('[QUOTES] quoteData preview:', req.body.quoteData.substring(0, 200));
    }

    // Determine if this is a multipart request or JSON request
    if (req.body.quoteData) {
      // Multipart/form-data: parse quoteData JSON string
      try {
        let quoteDataString = req.body.quoteData;

        // Handle both string and already-parsed JSON
        if (typeof quoteDataString === 'string') {
          // Trim whitespace
          quoteDataString = quoteDataString.trim();

          // Try URL decoding in case it's encoded (some clients encode form data)
          try {
            const decoded = decodeURIComponent(quoteDataString);
            if (decoded !== quoteDataString) {
              quoteDataString = decoded;
              console.log('[QUOTES] URL-decoded quoteData');
            }
          } catch (e) {
            // Not URL-encoded, continue with original
          }

          // If it looks like it might be double-encoded JSON string, try to decode
          if (quoteDataString.startsWith('"') && quoteDataString.endsWith('"')) {
            try {
              quoteDataString = JSON.parse(quoteDataString);
              console.log('[QUOTES] Unwrapped double-encoded JSON string');
            } catch (e) {
              // Not double-encoded, continue with original
            }
          }

          // Parse the JSON
          if (typeof quoteDataString === 'string') {
            quoteData = JSON.parse(quoteDataString);
          } else {
            quoteData = quoteDataString;
          }
        } else if (typeof req.body.quoteData === 'object') {
          // Already parsed (shouldn't happen with multer, but handle it)
          quoteData = req.body.quoteData;
        } else {
          throw new Error('quoteData must be a JSON string or object');
        }
        console.log('[QUOTES] Successfully parsed quoteData');
      } catch (parseErr) {
        console.error('[QUOTES] JSON parse error:', parseErr.message);
        console.error('[QUOTES] quoteData value:', req.body.quoteData);
        console.error('[QUOTES] quoteData type:', typeof req.body.quoteData);
        cleanupFiles(uploadedFiles);
        return res.status(400).json({
          success: false,
          message: 'Invalid quoteData JSON format',
          error: parseErr.message,
          received: typeof req.body.quoteData
        });
      }
    } else if (req.body.customer || req.body.basket) {
      // JSON request (backward compatible) - check if it's already structured
      quoteData = req.body;
      console.log('[QUOTES] Using JSON body directly');
    } else {
      // No quoteData and no structured body
      cleanupFiles(uploadedFiles);
      return res.status(400).json({
        success: false,
        message: 'quoteData is required for multipart/form-data requests, or send JSON body directly',
        bodyKeys: Object.keys(req.body || {})
      });
    }

    // Validate quoteData structure
    if (!quoteData || typeof quoteData !== 'object') {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({
        success: false,
        message: 'Invalid quote data structure',
        received: typeof quoteData
      });
    }

    const {
      customer,
      summary,
      basket,
      customizations,
      timestamp,
    } = quoteData;

    console.log('[QUOTES] Customer:', customer ? 'exists' : 'missing');
    console.log('[QUOTES] Customer email:', customer?.email || 'missing');

    // ===== VALIDATION =====
    if (!customer || !customer.email) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({
        success: false,
        message: 'Customer email is required',
        debug: {
          hasCustomer: !!customer,
          customerKeys: customer ? Object.keys(customer) : [],
          quoteDataKeys: Object.keys(quoteData || {})
        }
      });
    }

    if (!customer.fullName) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({
        success: false,
        message: 'Customer full name is required',
      });
    }

    if (!customer.phone) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({
        success: false,
        message: 'Customer phone is required',
      });
    }

    if (!Array.isArray(basket) || basket.length === 0) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({
        success: false,
        message: 'Basket is required',
      });
    }

    // ===== PROCESS UPLOADED LOGO FILES =====
    const logoFiles = {};
    const logoAttachments = [];

    uploadedFiles.forEach(file => {
      if (file.fieldname.startsWith('logo_')) {
        const positionSlug = file.fieldname.replace('logo_', '');
        logoFiles[positionSlug] = {
          originalName: file.originalname,
          filename: file.filename,
          path: file.path,
          size: file.size,
          mimetype: file.mimetype
        };

        // Prepare attachment for email
        try {
          const fileContent = fs.readFileSync(file.path);
          logoAttachments.push({
            filename: file.originalname,
            content: fileContent
          });
        } catch (readErr) {
          console.error(`[QUOTES] Failed to read file for attachment: ${file.path}`, readErr.message);
        }
      }
    });

    // Generate unique quote ID
    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // ===== PREPARE EMAIL DATA =====
    const emailData = {
      customer: {
        fullName: customer.fullName,
        company: customer.company || null,
        phone: customer.phone,
        email: customer.email,
        address: customer.address || null,
      },

      summary: summary || {},

      basket: basket.map(item => ({
        name: item.name,
        code: item.code,
        color: item.color,
        quantity: item.quantity,
        sizes: item.sizes || {},
        sizesSummary: item.sizesSummary || '',
        unitPrice: item.unitPrice,
        itemTotal: item.itemTotal,
        image: item.image || null,
      })),

      customizations: Array.isArray(customizations)
        ? customizations.map(c => ({
          position: c.position,
          method: c.method,
          type: c.type,
          hasLogo: c.hasLogo || logoFiles[c.position?.toLowerCase().replace(/\s+/g, '-')] !== undefined,
          text: c.text ?? null,
          unitPrice: c.unitPrice,
          lineTotal: c.lineTotal,
          quantity: c.quantity,
        }))
        : [],

      timestamp: timestamp || new Date().toISOString(),
    };

    // ===== SEND EMAIL =====
    let emailResult;

    if (logoAttachments.length > 0) {
      // Send email with attachments
      console.log(`[QUOTES] Sending quote email with ${logoAttachments.length} logo attachment(s)`);
      emailResult = await sendQuoteEmailWithAttachments(emailData, logoAttachments, {});
    } else {
      // Send regular email without attachments
      emailResult = await sendQuoteEmail(emailData);
    }

    // Cleanup uploaded files after sending email (we don't need to store them)
    cleanupFiles(uploadedFiles);

    // ===== SAVE TO DATABASE =====
    try {
      const {
        customer: { fullName, company, phone, email, address },
        summary: { total }
      } = emailData;

      const insertSql = `
        INSERT INTO quote_requests (
          quote_id, customer_name, customer_email, customer_phone, 
          customer_company, customer_address, total_amount, quote_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

      const insertParams = [
        quoteId,
        fullName,
        email,
        phone || null,
        company || null,
        address || null,
        total || null,
        JSON.stringify(emailData)
      ];

      await queryWithTimeout(insertSql, insertParams, 10000);
      console.log(`[QUOTES] Saved quote ${quoteId} to database`);
    } catch (dbError) {
      console.error(`[QUOTES DATABASE ERROR] Failed to save quote ${quoteId}:`, dbError.message);
      // We don't return error here because the email might have been sent successfully
    }

    if (emailResult?.success) {
      console.log(`[QUOTES] Successfully processed quote from ${customer.email} (ID: ${quoteId})`);
      return res.status(200).json({
        success: true,
        message: 'Quote submitted successfully',
        quoteId: quoteId
      });
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[QUOTES] Dev mode - quote received from ${customer.email} (ID: ${quoteId})`);
      return res.status(200).json({
        success: true,
        message: 'Quote received (email disabled in dev)',
        quoteId: quoteId
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to send quote email',
    });

  } catch (error) {
    // Cleanup files on error
    cleanupFiles(uploadedFiles);

    console.error('[QUOTES ERROR]', error);

    // Handle multer errors
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 5MB per file.'
        });
      }
      if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          message: 'Too many files. Maximum 10 logo files allowed.'
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Server error while submitting quote',
    });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB per file.'
      });
    }
    return res.status(400).json({
      success: false,
      message: `Upload error: ${error.message}`
    });
  }

  if (error.message && error.message.includes('Only image files')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  next(error);
});

module.exports = router;
