const express = require('express');
const router = express.Router();
const { sendQuoteEmail } = require('../utils/emailService');

/**
 * POST /api/quotes
 * Submit a quote request
 * 
 * Request body:
 * {
 *   "customer": {
 *     "fullName": "John Smith",
 *     "phone": "+44 7700 900000",
 *     "email": "john@example.com"
 *   },
 *   "product": {
 *     "name": "Golf performance crested cap",
 *     "code": "AD082",
 *     "selectedColorName": "Navy",
 *     "quantity": 10,
 *     "price": 12.50,
 *     "sizes": {
 *       "M": 5,
 *       "L": 5
 *     }
 *   },
 *   "basket": [...],
 *   "customizations": [...],
 *   "timestamp": "2026-01-09T20:30:00.000Z"
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { customer, product, basket, customizations, timestamp } = req.body;

    console.log(req.body);
    
    // Validate required fields
    if (!customer || !customer.email) {
      return res.status(400).json({
        success: false,
        message: 'Customer email is required',
      });
    }

    if (!product || !product.code) {
      return res.status(400).json({
        success: false,
        message: 'Product code is required',
      });
    }

    // Prepare email data
    const emailData = {
      customer: {
        fullName: customer.fullName || 'N/A',
        email: customer.email,
        phone: customer.phone || 'N/A',
      },
      product: {
        name: product.name || 'N/A',
        code: product.code,
        selectedColorName: product.selectedColorName || 'N/A',
        quantity: product.quantity || 0,
        price: product.price || 0,
        sizes: product.sizes || {},
      },
      basket: basket || [],
      customizations: customizations || [],
      timestamp: timestamp || new Date().toISOString(),
    };


    console.log("emailData", emailData);
    

    // Send email
    const emailResult = await sendQuoteEmail(emailData);

    if (emailResult.sent) {
      res.json({
        success: true,
        message: 'Quote sent successfully',
      });
    } else {
      // If email service is not configured but we're in development, still return success
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[QUOTES] Email not sent but returning success in development mode');
        res.json({
          success: true,
          message: 'Quote request received (email service not configured)',
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to send quote email',
        });
      }
    }
  } catch (error) {
    console.error('[ERROR] Failed to process quote request:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while processing your quote request',
    });
  }
});

module.exports = router;

