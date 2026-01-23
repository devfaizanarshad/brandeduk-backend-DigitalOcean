// services/emailService.js
const { Resend } = require("resend");

if (!process.env.RESEND_API_KEY) {
  throw new Error("❌ RESEND_API_KEY is missing in environment variables");
}

const resend = new Resend(process.env.RESEND_API_KEY);

console.log(process.env.RESEND_API_KEY);


console.log(resend);


// Helper function to escape HTML (like PHP's htmlspecialchars)
function escapeHtml(text) {
  if (text == null) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Helper function to format numbers (like PHP's number_format)
function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || num === 'POA') return num;
  return parseFloat(num).toFixed(decimals);
}

function generateQuoteEmailHTML(data) {
  const customer = data.customer || {};
  const summary = data.summary || {};
  const basket = data.basket || [];
  const customizations = data.customizations || [];
  const product = data.product || {}; // Legacy fallback

  // Get customer details (support both fullName and firstName/lastName formats)
  const customerName = customer.fullName || 
    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer';
  const customerEmail = customer.email || '';
  const customerPhone = customer.phone || '';
  const customerCompany = customer.company || null;
  const customerAddress = customer.address || null;

  /* -------- Basket Items HTML -------- */
  let basketHTML = '';
  if (basket.length > 0) {
    basket.forEach((item, index) => {
      const itemName = escapeHtml(item.name || 'Product');
      const itemCode = escapeHtml(item.code || 'N/A');
      const itemColor = escapeHtml(item.color || 'N/A');
      const itemQty = item.quantity || 0;
      const unitPrice = formatNumber(item.unitPrice);
      const itemTotal = formatNumber(item.itemTotal);

      // Build sizes breakdown
      let sizesText = '';
      if (item.sizes && typeof item.sizes === 'object') {
        const sizesArray = [];
        Object.entries(item.sizes).forEach(([size, qty]) => {
          if (qty > 0) {
            sizesArray.push(`${escapeHtml(size)}: ${qty}`);
          }
        });
        sizesText = sizesArray.length 
          ? sizesArray.join(', ') 
          : (item.sizesSummary ? escapeHtml(item.sizesSummary) : '');
      } else {
        sizesText = item.sizesSummary ? escapeHtml(item.sizesSummary) : '';
      }

      basketHTML += `
            <div class="basket-item">
                <div class="basket-item-header">Item #${index + 1}: ${itemName} (${itemCode})</div>
                <table>
                    <tr><td class="label">Color:</td><td class="value">${itemColor}</td></tr>
                    <tr><td class="label">Total Quantity:</td><td class="value"><strong>${itemQty} units</strong></td></tr>`;
      
      if (sizesText) {
        basketHTML += `<tr><td class="label">Sizes:</td><td class="value sizes-detail">${sizesText}</td></tr>`;
      }
      
      basketHTML += `
                    <tr><td class="label">Unit Price:</td><td class="value">£${unitPrice}</td></tr>
                    <tr><td class="label">Item Total:</td><td class="value"><strong>£${itemTotal}</strong></td></tr>
                </table>
            </div>`;
    });
  } else {
    // Fallback to old product format if basket is empty
    basketHTML = `
            <p>Product: ${escapeHtml(product.name || 'N/A')}</p>
            <p>Code: ${escapeHtml(product.code || 'N/A')}</p>
            <p>Quantity: ${product.quantity || 0} units</p>`;
  }

  /* -------- Customizations HTML -------- */
  let customizationsHTML = '';
  if (customizations.length > 0) {
    customizations.forEach(c => {
      const method = (c.method || 'N/A').toUpperCase();
      const type = escapeHtml(c.type || 'N/A');
      const position = escapeHtml(c.position || 'Unknown');
      const hasLogo = c.hasLogo ?? c.uploadedLogo ?? false;
      const logo = hasLogo ? '✅ Yes' : '❌ No';
      const text = c.text ? ` - Text: ${escapeHtml(c.text)}` : '';
      const unitPrice = c.unitPrice === 'POA' ? 'POA' : `£${formatNumber(c.unitPrice)}`;
      const lineTotal = c.lineTotal === 'POA' ? 'POA' : `£${formatNumber(c.lineTotal)}`;
      const qty = c.quantity || 0;

      customizationsHTML += `
                <tr>
                    <td class="label">${position}</td>
                    <td class="value">
                        <strong>${method}</strong> - ${type}<br>
                        Logo Uploaded: ${logo}${text}<br>
                        <small>Unit: ${unitPrice} × Qty: ${qty} = ${lineTotal}</small>
                    </td>
                </tr>`;
    });
  } else {
    customizationsHTML = `<tr><td colspan="2">No customizations selected</td></tr>`;
  }

  /* -------- Summary HTML -------- */
  const garmentCost = formatNumber(summary.garmentCost);
  const customizationCost = formatNumber(summary.customizationCost);
  const digitizingFee = formatNumber(summary.digitizingFee);
  const subtotal = formatNumber(summary.subtotal);
  const vatAmount = formatNumber(summary.vatAmount);
  const displayTotal = formatNumber(summary.displayTotal);
  const totalQty = summary.totalQuantity || 0;
  const totalItems = summary.totalItems || basket.length || 0;
  const vatMode = summary.vatMode || 'ex';

  // Format date like PHP: d/m/Y H:i:s
  const now = new Date();
  const formattedDate = now.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(',', '');

  return `
  <html>
  <head>
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #111827; }
      .header { background: #7c3aed; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
      .section { background: #f9fafb; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #7c3aed; }
      .section h2 { margin-top: 0; color: #374151; }
      .label { font-weight: bold; color: #374151; width: 150px; }
      .value { color: #111827; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      td { padding: 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
      tr:last-child td { border-bottom: none; }
      .summary-box { background: #ede9fe; padding: 15px; border-radius: 8px; margin-top: 10px; }
      .summary-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #ddd4fe; }
      .summary-row:last-child { border-bottom: none; font-weight: bold; font-size: 1.1em; }
      .basket-item { background: white; padding: 12px; margin: 8px 0; border-radius: 6px; border: 1px solid #e5e7eb; }
      .basket-item-header { font-weight: bold; color: #7c3aed; margin-bottom: 8px; }
      .sizes-detail { color: #6b7280; font-size: 0.9em; margin-top: 4px; }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>🎉 New Quote Request</h1>
    </div>

    <div class="section">
      <h2>👤 Customer Details</h2>
      <table>
        <tr><td class="label">Name:</td><td class="value">${escapeHtml(customerName)}</td></tr>
        ${customerCompany ? `<tr><td class="label">Company:</td><td class="value">${escapeHtml(customerCompany)}</td></tr>` : ''}
        <tr><td class="label">Email:</td><td class="value">${escapeHtml(customerEmail)}</td></tr>
        <tr><td class="label">Phone:</td><td class="value">${escapeHtml(customerPhone)}</td></tr>
        ${customerAddress ? `<tr><td class="label">Address:</td><td class="value">${escapeHtml(customerAddress)}</td></tr>` : ''}
      </table>
    </div>

    <div class="section">
      <h2>🛒 Basket Items (${totalItems} ${totalItems === 1 ? 'item' : 'items'})</h2>
      ${basketHTML}
    </div>

    <div class="section">
      <h2>🎨 Customizations</h2>
      <table>${customizationsHTML}</table>
    </div>

    <div class="section">
      <h2>💰 Quote Summary</h2>
      <div class="summary-box">
        <div class="summary-row"><span>Total Items:</span><span><strong>${totalItems} ${totalItems === 1 ? 'product' : 'products'}</strong></span></div>
        <div class="summary-row"><span>Total Quantity:</span><span><strong>${totalQty} units</strong></span></div>
        <div class="summary-row"><span>Garment Cost:</span><span>£${garmentCost} ex VAT</span></div>
        <div class="summary-row"><span>Customization Cost:</span><span>£${customizationCost} ex VAT</span></div>
        ${parseFloat(digitizingFee) > 0 ? `<div class="summary-row"><span>Digitizing Fee (one-time):</span><span>£${digitizingFee} ex VAT</span></div>` : ''}
        <div class="summary-row"><span>Subtotal (ex VAT):</span><span>£${subtotal}</span></div>
        <div class="summary-row"><span>VAT (20%):</span><span>£${vatAmount}</span></div>
        <div class="summary-row"><span><strong>Total (${vatMode === 'inc' ? 'inc' : 'ex'} VAT):</strong></span><span><strong>£${displayTotal}</strong></span></div>
      </div>
    </div>

    <div class="section">
      <h2>📅 Request Date</h2>
      <p>${formattedDate}</p>
    </div>

    <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">This quote was automatically generated from the BrandedUK website.</p>
  </body>
  </html>
  `;
}

/* =========================
   SEND EMAIL
========================= */
async function sendQuoteEmail(data) {
  try {
    const html = generateQuoteEmailHTML(data);

    console.log(`[EMAIL] Attempting to send quote email to: ${process.env.EMAIL_TO}`);
    console.log(`[EMAIL] From: ${process.env.EMAIL_FROM}`);

    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      replyTo: data.customer?.email,
      subject: `New Quote Request - ${data.customer?.fullName || 'Customer'}`,
      html,
    });

    // Resend API returns { data: { id: '...' } } or { id: '...' } depending on version
    const emailId = result?.data?.id || result?.id;
    
    if (emailId) {
      console.log("✅ Email sent via Resend. ID:", emailId);
      console.log("[EMAIL] Full response:", JSON.stringify(result, null, 2));
      return { success: true, id: emailId };
    } else {
      console.warn("⚠️ Email response received but no ID found. Full response:", JSON.stringify(result, null, 2));
      // Still return success if no error was thrown
      return { success: true, id: null, warning: "Email sent but no ID returned" };
    }

  } catch (error) {
    console.error("❌ Email sending failed:", error);
    console.error("[EMAIL] Error details:", {
      message: error.message,
      status: error.status,
      response: error.response?.data || error.response,
      stack: error.stack
    });
    throw error;
  }
}

/* =========================
   CONTACT FORM EMAIL
========================= */
function generateContactEmailHTML(data) {
  const name = escapeHtml(data.name || 'Anonymous');
  const email = escapeHtml(data.email || 'Not provided');
  const interest = escapeHtml(data.interest || 'Not specified');
  const phone = data.phone ? escapeHtml(data.phone) : null;
  const address = data.address ? escapeHtml(data.address) : null;
  const postCode = data.postCode ? escapeHtml(data.postCode) : null;
  const message = escapeHtml(data.message || '');
  const submittedAt = data.submittedAt || new Date().toISOString();

  // Format date
  const date = new Date(submittedAt);
  const formattedDate = date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(',', '');

  // Interest badge colors
  const interestColors = {
    embroidery: '#7c3aed',
    printing: '#2563eb',
    workwear: '#059669',
    uniforms: '#dc2626',
    promotional: '#d97706',
    other: '#6b7280'
  };
  const badgeColor = interestColors[data.interest?.toLowerCase()] || interestColors.other;

  return `
  <html>
  <head>
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #111827; margin: 0; padding: 0; }
      .container { max-width: 600px; margin: 0 auto; }
      .header { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
      .header h1 { margin: 0; font-size: 24px; }
      .header p { margin: 10px 0 0; opacity: 0.9; }
      .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; }
      .section { margin-bottom: 25px; }
      .section-title { font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
      .info-row { display: flex; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
      .info-row:last-child { border-bottom: none; }
      .info-label { font-weight: 600; color: #374151; width: 120px; flex-shrink: 0; }
      .info-value { color: #111827; }
      .interest-badge { display: inline-block; background: ${badgeColor}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
      .message-box { background: #f9fafb; border-left: 4px solid #7c3aed; padding: 20px; margin-top: 10px; border-radius: 0 8px 8px 0; }
      .message-text { white-space: pre-wrap; color: #374151; margin: 0; }
      .footer { background: #f3f4f6; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none; }
      .footer p { margin: 0; color: #6b7280; font-size: 12px; }
      .reply-btn { display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 15px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>📬 New Contact Form Submission</h1>
        <p>Someone has reached out through the website</p>
      </div>

      <div class="content">
        <div class="section">
          <div class="section-title">👤 Contact Information</div>
          <div class="info-row">
            <span class="info-label">Name:</span>
            <span class="info-value"><strong>${name}</strong></span>
          </div>
          <div class="info-row">
            <span class="info-label">Email:</span>
            <span class="info-value"><a href="mailto:${email}" style="color: #7c3aed;">${email}</a></span>
          </div>
          ${phone ? `
          <div class="info-row">
            <span class="info-label">Phone:</span>
            <span class="info-value"><a href="tel:${phone}" style="color: #7c3aed;">${phone}</a></span>
          </div>` : ''}
          <div class="info-row">
            <span class="info-label">Interest:</span>
            <span class="info-value"><span class="interest-badge">${interest}</span></span>
          </div>
          ${address || postCode ? `
          <div class="info-row">
            <span class="info-label">Location:</span>
            <span class="info-value">${[address, postCode].filter(Boolean).join(', ')}</span>
          </div>` : ''}
        </div>

        <div class="section">
          <div class="section-title">💬 Message</div>
          <div class="message-box">
            <p class="message-text">${message}</p>
          </div>
        </div>

        <div class="section" style="text-align: center; margin-bottom: 0;">
          <a href="mailto:${email}?subject=Re: Your inquiry about ${interest}" class="reply-btn">Reply to ${name.split(' ')[0]}</a>
        </div>
      </div>

      <div class="footer">
        <p>Submitted on ${formattedDate}</p>
        <p style="margin-top: 5px;">This message was sent from the BrandedUK contact form</p>
      </div>
    </div>
  </body>
  </html>
  `;
}

async function sendContactEmail(data) {
  try {
    const html = generateContactEmailHTML(data);

    console.log(html);
    

    console.log(`[EMAIL] Attempting to send contact email to: ${process.env.EMAIL_TO}`);
    console.log(`[EMAIL] From: ${process.env.EMAIL_FROM}`);

    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      replyTo: data.email,
      subject: `New Contact Form: ${data.interest?.charAt(0).toUpperCase() + data.interest?.slice(1)} - ${data.name}`,
      html,
    });

    console.log("Result" , result);
    

    // Resend API returns { data: { id: '...' } } or { id: '...' } depending on version
    const emailId = result?.data?.id || result?.id;

    console.log('Email Id', emailId);
    
    
    if (emailId) {
      console.log("✅ Contact email sent via Resend. ID:", emailId);
      console.log("[EMAIL] Full response:", JSON.stringify(result, null, 2));
      return { success: true, id: emailId };
    } else {
      console.warn("⚠️ Email response received but no ID found. Full response:", JSON.stringify(result, null, 2));
      // Still return success if no error was thrown
      return { success: true, id: null, warning: "Email sent but no ID returned" };
    }

  } catch (error) {
    console.error("❌ Contact email sending failed:", error);
    console.error("[EMAIL] Error details:", {
      message: error.message,
      status: error.status,
      response: error.response?.data || error.response,
      stack: error.stack
    });
    throw error;
  }
}

/* =========================
   QUOTE EMAIL WITH ATTACHMENTS
========================= */
function generateQuoteWithLogosEmailHTML(data, logoUrls = {}) {
  // Use the existing quote HTML generator
  let html = generateQuoteEmailHTML(data);
  
  // If there are logo URLs, add a section for them
  if (Object.keys(logoUrls).length > 0) {
    const logosSection = `
    <div class="section">
      <h2>🖼️ Uploaded Logos</h2>
      <table>
        ${Object.entries(logoUrls).map(([position, url]) => `
          <tr>
            <td class="label">${escapeHtml(position.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))}:</td>
            <td class="value">
              <a href="${escapeHtml(url)}" target="_blank" style="color: #7c3aed;">View Logo</a>
              ${url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? `<br><img src="${escapeHtml(url)}" alt="Logo" style="max-width: 150px; max-height: 100px; margin-top: 8px; border: 1px solid #e5e7eb; border-radius: 4px;">` : ''}
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
    `;
    
    // Insert logos section before the request date section
    html = html.replace(
      /<div class="section">\s*<h2>📅 Request Date<\/h2>/,
      `${logosSection}\n    <div class="section">\n      <h2>📅 Request Date</h2>`
    );
  }
  
  return html;
}

async function sendQuoteEmailWithAttachments(data, attachments = [], logoUrls = {}) {
  try {
    const html = generateQuoteWithLogosEmailHTML(data, logoUrls);

    console.log(`[EMAIL] Attempting to send quote email with ${attachments.length} attachment(s) to: ${process.env.EMAIL_TO}`);
    console.log(`[EMAIL] From: ${process.env.EMAIL_FROM}`);

    const emailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      replyTo: data.customer?.email,
      subject: `New Quote Request - ${data.customer?.fullName || 'Customer'}`,
      html,
    };

    // Add attachments if provided (Resend supports attachments)
    if (attachments.length > 0) {
      emailOptions.attachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content, // Buffer or base64 string
      }));
    }

    const result = await resend.emails.send(emailOptions);

    console.log(result);
    

    // Resend API returns { data: { id: '...' } } or { id: '...' } depending on version
    const emailId = result?.data?.id || result?.id;
    
    if (emailId) {
      console.log("✅ Quote email with attachments sent via Resend. ID:", emailId);
      console.log("[EMAIL] Full response:", JSON.stringify(result, null, 2));
      return { success: true, id: emailId };
    } else {
      console.warn("⚠️ Email response received but no ID found. Full response:", JSON.stringify(result, null, 2));
      return { success: true, id: null, warning: "Email sent but no ID returned" };
    }

  } catch (error) {
    console.error("❌ Quote email with attachments sending failed:", error);
    console.error("[EMAIL] Error details:", {
      message: error.message,
      status: error.status,
      response: error.response?.data || error.response,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = { sendQuoteEmail, sendContactEmail, sendQuoteEmailWithAttachments };