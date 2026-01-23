const express = require('express');
const router = express.Router();
const { sendContactEmail } = require('../utils/emailService');

// Rate limiting for contact form (per email)
const contactRateLimitMap = new Map();
const CONTACT_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const CONTACT_RATE_LIMIT_MAX = 3; // Max 3 submissions per email per hour

// Valid interest options
const VALID_INTERESTS = ['embroidery', 'printing', 'workwear', 'uniforms', 'promotional', 'other'];

/**
 * POST /api/contact
 * Submit contact form
 */
router.post('/', async (req, res) => {
  try {
    const { name, email, interest, phone, address, postCode, message } = req.body;

    // ===== VALIDATION =====
    const errors = {};

    // Required field validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      errors.name = 'Name is required';
    } else if (name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    } else if (name.trim().length > 100) {
      errors.name = 'Name must be less than 100 characters';
    }

    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      errors.email = 'Email is required';
    } else {
      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errors.email = 'Invalid email format';
      }
    }

    if (!interest || typeof interest !== 'string' || interest.trim().length === 0) {
      errors.interest = 'Interest is required';
    } else if (!VALID_INTERESTS.includes(interest.trim().toLowerCase())) {
      errors.interest = `Interest must be one of: ${VALID_INTERESTS.join(', ')}`;
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      errors.message = 'Message is required';
    } else if (message.trim().length < 10) {
      errors.message = 'Message must be at least 10 characters';
    } else if (message.trim().length > 5000) {
      errors.message = 'Message must be less than 5000 characters';
    }

    // Optional field validation
    if (phone && typeof phone === 'string' && phone.trim().length > 0) {
      // Basic phone validation (allow various formats)
      const phoneRegex = /^[\d\s\+\-\(\)]{7,20}$/;
      if (!phoneRegex.test(phone.trim())) {
        errors.phone = 'Invalid phone number format';
      }
    }

    if (postCode && typeof postCode === 'string' && postCode.trim().length > 0) {
      // UK postcode validation (loose pattern)
      const postcodeRegex = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;
      if (!postcodeRegex.test(postCode.trim())) {
        errors.postCode = 'Invalid UK post code format';
      }
    }

    // Return validation errors
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors
      });
    }

    // ===== RATE LIMITING (per email) =====
    const normalizedEmail = email.trim().toLowerCase();
    const now = Date.now();

    // Clean up old entries
    if (contactRateLimitMap.size > 10000) {
      for (const [key, value] of contactRateLimitMap.entries()) {
        if (now - value.firstRequest > CONTACT_RATE_LIMIT_WINDOW) {
          contactRateLimitMap.delete(key);
        }
      }
    }

    const emailRateData = contactRateLimitMap.get(normalizedEmail) || { count: 0, firstRequest: now };

    if (now - emailRateData.firstRequest > CONTACT_RATE_LIMIT_WINDOW) {
      emailRateData.count = 1;
      emailRateData.firstRequest = now;
    } else {
      emailRateData.count++;
    }

    contactRateLimitMap.set(normalizedEmail, emailRateData);

    if (emailRateData.count > CONTACT_RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((CONTACT_RATE_LIMIT_WINDOW - (now - emailRateData.firstRequest)) / 1000);
      return res.status(429).json({
        success: false,
        error: 'Too many submissions',
        message: `Maximum ${CONTACT_RATE_LIMIT_MAX} contact form submissions per hour. Please try again later.`,
        retryAfter
      });
    }

    // ===== PREPARE CONTACT DATA =====
    const contactData = {
      name: name.trim(),
      email: normalizedEmail,
      interest: interest.trim().toLowerCase(),
      phone: phone ? phone.trim() : null,
      address: address ? address.trim() : null,
      postCode: postCode ? postCode.trim().toUpperCase() : null,
      message: message.trim(),
      submittedAt: new Date().toISOString()
    };

    // Generate unique contact ID
    const contactId = `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // ===== SEND EMAIL NOTIFICATION =====
    const emailResult = await sendContactEmail(contactData);

    if (emailResult?.success) {
      console.log(`[CONTACT] Successfully processed contact form from ${normalizedEmail} (ID: ${contactId})`);
      return res.status(200).json({
        success: true,
        message: "Thank you for your inquiry. We'll get back to you soon.",
        id: contactId
      });
    }

    // Handle email failure in dev mode
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CONTACT] Dev mode - contact form received from ${normalizedEmail} (ID: ${contactId})`);
      return res.status(200).json({
        success: true,
        message: "Thank you for your inquiry. We'll get back to you soon.",
        id: contactId
      });
    }

    // Email failed in production
    console.error(`[CONTACT] Failed to send email for contact form from ${normalizedEmail}`);
    return res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.'
    });

  } catch (error) {
    console.error('[CONTACT ERROR]', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.'
    });
  }
});

module.exports = router;

