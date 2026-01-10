const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Email Service Utility
 * Handles sending quote request emails
 */

// Create transporter - using SMTP configuration
const createTransporter = () => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // true for 465, false for other ports (587 uses TLS)
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_USER,
      pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD,
    },
  });

  return transporter;
};

/**
 * Generate HTML email template for quote request
 * Matches the PHP template design
 */
function generateQuoteEmailHTML(data) {
  const { customer, product, basket, customizations, timestamp } = data;

  // Get customer name (support both fullName and firstName/lastName)
  const customerName = customer?.fullName || 
    (customer?.firstName ? `${customer.firstName} ${customer.lastName || ''}`.trim() : 'Customer');
  const customerEmail = customer?.email || '';
  const customerPhone = customer?.phone || '';

  // Format customizations table rows
  const formatCustomizations = (customizations) => {
    if (!customizations || !Array.isArray(customizations) || customizations.length === 0) {
      return '<tr><td colspan="2">No customizations selected</td></tr>';
    }

    return customizations.map(custom => {
      const method = custom.method ? custom.method.toUpperCase() : 'N/A';
      const type = custom.type || 'N/A';
      const position = custom.position || 'Unknown';
      const logo = custom.uploadedLogo ? '✅ Logo uploaded' : '❌ No logo';
      const text = custom.text ? ` - Text: ${custom.text}` : '';
      
      return `
        <tr>
          <td class="label">${position}</td>
          <td class="value"><strong>${method}</strong> - ${type} - ${logo}${text}</td>
        </tr>
      `;
    }).join('');
  };

  // Format date
  const formatDate = (timestamp) => {
    if (!timestamp) return new Date().toLocaleString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    const date = new Date(timestamp);
    return date.toLocaleString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; }
    .header { background: #7c3aed; color: white; padding: 20px; }
    .section { background: #f9fafb; padding: 15px; margin: 10px 0; border-radius: 8px; }
    .label { font-weight: bold; color: #374151; }
    .value { color: #111827; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
    h2 { margin-top: 0; color: #111827; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">🎉 New Quote Request</h1>
  </div>
  
  <div class="section">
    <h2>👤 Customer Details</h2>
    <table>
      <tr><td class="label">Name:</td><td class="value">${customerName}</td></tr>
      <tr><td class="label">Email:</td><td class="value">${customerEmail}</td></tr>
      <tr><td class="label">Phone:</td><td class="value">${customerPhone}</td></tr>
    </table>
  </div>
  
  <div class="section">
    <h2>👕 Product Details</h2>
    <table>
      <tr><td class="label">Product:</td><td class="value">${product?.name || 'N/A'}</td></tr>
      <tr><td class="label">Code:</td><td class="value">${product?.code || 'N/A'}</td></tr>
      <tr><td class="label">Color:</td><td class="value">${product?.selectedColorName || 'N/A'}</td></tr>
      <tr><td class="label">Quantity:</td><td class="value">${product?.quantity || '0'} units</td></tr>
      <tr><td class="label">Price:</td><td class="value">£${product?.price || '0'} each</td></tr>
    </table>
  </div>
  
  <div class="section">
    <h2>🎨 Customizations</h2>
    <table>
      ${formatCustomizations(customizations)}
    </table>
  </div>
  
  <div class="section">
    <h2>💰 Request Date</h2>
    <p>${formatDate(timestamp)}</p>
  </div>
  
  <p style="color: #6b7280; font-size: 12px;">This quote was automatically generated from the BrandedUK website.</p>
</body>
</html>
  `;

  return html;
}

/**
 * Send quote request email
 */
async function sendQuoteEmail(data) {
  try {
    console.log("data", data);
    // Determine recipient email based on environment
    // const recipientEmail = process.env.NODE_ENV === 'production' 
    //   ? (process.env.QUOTE_EMAIL_PRODUCTION ||'devfaizanarshad@gmail.com')
    //   : (process.env.QUOTE_EMAIL_DEV || 'devfaizanarshad@gmail.com');

    const recipientEmail = 'devfaizanarshad@gmail.com';

    const transporter = createTransporter();

    // Validate email configuration
    const smtpUser = 'faizanarshaddev@gmail.com'
    const smtpPass = 'wpowirmmtibzucow'
    
    if (!smtpUser || !smtpPass) {
      console.warn('[EMAIL] Email credentials not configured. Email will not be sent.');
      console.warn('[EMAIL] Missing:', {
        SMTP_USER: !smtpUser ? 'NOT SET' : 'SET',
        SMTP_PASS: !smtpPass ? 'NOT SET' : 'SET'
      });
      // In development, you might want to just log instead of failing
    //   if (process.env.NODE_ENV === 'production') {
    //     throw new Error('Email service not configured');
    //   }
    //   return { sent: false, message: 'Email service not configured' };
    // }

    console.log('[EMAIL] SMTP Config:', {
      host:'smtp.gmail.com',
      port: 587,
      user: smtpUser,
      recipient: recipientEmail
    });

    // Get customer name for subject (support both fullName and firstName/lastName)
    const customerName = data.customer?.fullName || 
      (data.customer?.firstName ? `${data.customer.firstName} ${data.customer.lastName || ''}`.trim() : 'Customer');

    const mailOptions = {
      from: process.env.SMTP_USER || process.env.EMAIL_FROM || process.env.EMAIL_USER || 'faizanarshaddev@gmail.com',
      to: recipientEmail,
      replyTo: data.customer?.email || undefined,
      subject: `New Quote Request from ${customerName}`,
      html: generateQuoteEmailHTML(data),
      text: `
New Quote Request

Customer Information:
- Name: ${data.customer?.fullName || 'N/A'}
- Email: ${data.customer?.email || 'N/A'}
- Phone: ${data.customer?.phone || 'N/A'}

Product Details:
- Name: ${data.product?.name || 'N/A'}
- Code: ${data.product?.code || 'N/A'}
- Color: ${data.product?.selectedColorName || 'N/A'}
- Quantity: ${data.product?.quantity || 'N/A'}
- Price: £${data.product?.price || '0.00'}

Basket Items: ${data.basket?.length || 0} item(s)

Customizations: ${data.customizations?.length || 0} customization(s)

Requested at: ${data.timestamp ? new Date(data.timestamp).toLocaleString() : 'N/A'}
      `.trim(),
    };

    console.log('[EMAIL] Attempting to send email...');
    console.log('[EMAIL] Mail options prepared:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      htmlLength: mailOptions.html?.length || 0
    });

    // Add timeout to prevent hanging
    const sendPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Email send timeout after 30 seconds')), 30000)
    );

    const info = await Promise.race([sendPromise, timeoutPromise]);
    console.log('[EMAIL] Quote email sent successfully!');
    console.log('[EMAIL] Message ID:', info.messageId);
    console.log('[EMAIL] Response:', info.response || 'No response');
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Error sending quote email:');
    console.error('[EMAIL] Error name:', error.name);
    console.error('[EMAIL] Error message:', error.message);
    console.error('[EMAIL] Error code:', error.code);
    console.error('[EMAIL] Full error:', error);
    
    // Check for specific Gmail errors
    if (error.code === 'EAUTH') {
      console.error('[EMAIL] Authentication failed - check SMTP credentials');
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      console.error('[EMAIL] Connection timeout - check network/firewall settings');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('[EMAIL] Connection refused - check SMTP host and port');
    }
    
    throw error;
  }
}

module.exports = {
  sendQuoteEmail,
  generateQuoteEmailHTML,
};

