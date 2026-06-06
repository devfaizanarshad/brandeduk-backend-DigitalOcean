// services/emailService.js
const { Resend } = require("resend");
const { extractQuoteNotes } = require('./quoteNotes');

if (!process.env.RESEND_API_KEY) {
  throw new Error("❌ RESEND_API_KEY is missing in environment variables");
}

const resend = new Resend(process.env.RESEND_API_KEY);

// Never log API keys or client objects (security).

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

function formatCurrencyFromMinorUnits(amount, currency = 'gbp') {
  const numericAmount = Number(amount || 0) / 100;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: String(currency || 'gbp').toUpperCase(),
  }).format(numericAmount);
}

function buildAdminQuoteUrl(quoteId) {
  if (!quoteId) return '';

  const encodedQuoteId = encodeURIComponent(String(quoteId));
  const template = String(process.env.ADMIN_QUOTE_URL_TEMPLATE || '').trim();
  if (template) {
    return template
      .replace(/\{quoteId\}/g, encodedQuoteId)
      .replace(/\{id\}/g, encodedQuoteId);
  }

  const adminPanelUrl = String(process.env.ADMIN_PANEL_URL || '').trim().replace(/\/+$/, '');
  if (adminPanelUrl) {
    return `${adminPanelUrl}/orders/${encodedQuoteId}`;
  }

  const defaultAdminPanelUrl = process.env.NODE_ENV === 'production'
    ? 'https://admin.brandeduk.com'
    : 'http://localhost:5173';
  return `${defaultAdminPanelUrl}/orders/${encodedQuoteId}`;
}

function generateQuoteEmailHTML(data) {
  const customer = data.customer || {};
  const summary = data.summary || {};
  const basket = data.basket || [];
  const customizations = data.customizations || [];
  const product = data.product || {}; // Legacy fallback
  const { notes } = extractQuoteNotes(data);
  const adminQuoteUrl = buildAdminQuoteUrl(data.quoteId);

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
                    <tr><td class="label">Item Total:</td><td class="value"><strong>£${itemTotal}</strong></td></tr>`;

      // Add item notes if present
      if (item.note) {
        basketHTML += `<tr><td class="label">Notes:</td><td class="value" style="color:#7c3aed;font-style:italic;">${escapeHtml(item.note)}</td></tr>`;
      }

      basketHTML += `
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
      const hasLogo = c.hasLogo ?? c.uploadedLogo ?? !!c.logo;
      const text = c.text ? ` - Text: ${escapeHtml(c.text)}` : '';
      const unitPrice = c.unitPrice === 'POA' ? 'POA' : `£${formatNumber(c.unitPrice)}`;
      const lineTotal = c.lineTotal === 'POA' ? 'POA' : `£${formatNumber(c.lineTotal)}`;
      const qty = c.quantity || 0;

      // Build logo preview HTML
      let logoHTML = '';
      if (c.logo) {
        const posSlug = (c.position || 'unknown').replace(/\s+/g, '-').toLowerCase();
        if (c.logo.startsWith('data:')) {
          // Base64 — show message to check attachment
          const ext = c.logo.startsWith('data:image/png') ? 'png' : 'jpg';
          logoHTML = `<br><span style="background:#7c3aed;color:white;padding:4px 10px;border-radius:4px;font-size:13px;">📎 Logo attached: <strong>logo-${escapeHtml(posSlug)}.${ext}</strong></span>`;
        } else {
          // CDN URL — show inline
          logoHTML = `<br><img src="${escapeHtml(c.logo)}" alt="Logo" style="max-width: 150px; max-height: 100px; margin-top: 8px; border: 1px solid #e5e7eb; border-radius: 4px;"><br><a href="${escapeHtml(c.logo)}" target="_blank" style="color: #7c3aed; font-size: 12px;">Download Logo</a>`;
        }
      } else if (hasLogo) {
        logoHTML = '<br><span style="color:#059669;">✅ Logo uploaded</span>';
      }

      customizationsHTML += `
                <tr>
                    <td class="label">${position}</td>
                    <td class="value">
                        <strong>${method}</strong> - ${type}${logoHTML}${text}<br>
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
      .admin-button { display: inline-block; background: #111827; color: #ffffff !important; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; }
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

    ${notes ? `
    <div class="section">
      <h2>Notes</h2>
      <p style="white-space: pre-wrap; margin: 0;">${escapeHtml(notes)}</p>
    </div>
    ` : ''}

    ${adminQuoteUrl ? `
    <div class="section" style="text-align:center;">
      <h2>Open This Quote</h2>
      <p>Review the complete request and prepare the customer quote in the admin panel.</p>
      <a href="${escapeHtml(adminQuoteUrl)}" class="admin-button" target="_blank">Open Quote in Admin</a>
    </div>
    ` : ''}

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

    // Extract base64 logos from customizations as email attachments
    const customizations = data.customizations || [];
    const logoAttachments = [];
    for (const c of customizations) {
      if (!c.logo) continue;

      if (c.logo.startsWith('data:')) {
        // BASE64 LOGO — convert to downloadable attachment
        const matches = c.logo.match(/data:([^;]+);base64,(.+)/);
        if (matches) {
          const mimeType = matches[1];
          const ext = mimeType === 'image/png' ? 'png' : 'jpg';
          const posSlug = (c.position || 'unknown').replace(/\s+/g, '-').toLowerCase();
          logoAttachments.push({
            filename: `logo-${posSlug}.${ext}`,
            content: matches[2], // base64 string directly
          });
          console.log(`[EMAIL] Extracted base64 logo for position: ${c.position}`);
        }
      }
      // URL logos don't need attachment — they render inline via <img src="URL">
    }

    const emailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      replyTo: data.customer?.email,
      subject: `New Quote Request - ${data.customer?.fullName || 'Customer'}`,
      html,
    };

    // Add attachments if any base64 logos were found
    if (logoAttachments.length > 0) {
      emailOptions.attachments = logoAttachments;
      console.log(`[EMAIL] Adding ${logoAttachments.length} logo attachment(s)`);
    }

    const result = await resend.emails.send(emailOptions);

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

function buildPaymentSummaryRows(quoteData = {}) {
  const summary = quoteData.summary || {};
  const basket = Array.isArray(quoteData.basket) ? quoteData.basket : [];
  const customizations = Array.isArray(quoteData.customizations) ? quoteData.customizations : [];

  return {
    totalQuantity: summary.totalQuantity || basket.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    totalItems: summary.totalItems || basket.length,
    displayTotal: summary.displayTotal || summary.totalIncVat || summary.total || null,
    basket,
    customizations,
  };
}

function buildPaymentProductSummary(quoteData = {}) {
  const basket = Array.isArray(quoteData.basket) ? quoteData.basket : [];

  if (!basket.length) {
    return {
      title: quoteData.product?.name || 'your Branded UK order',
      rows: [],
    };
  }

  const rows = basket.map((item) => {
    const quantity = Number(item.quantity) || 0;
    const name = item.name || 'Product';
    const code = item.code ? ` (${item.code})` : '';
    const color = item.color ? ` - ${item.color}` : '';

    return {
      name,
      quantity,
      label: `${name}${code}${color}${quantity ? ` x ${quantity}` : ''}`,
    };
  });

  const title = rows.length === 1
    ? rows[0].name
    : `${rows[0].name} + ${rows.length - 1} more ${rows.length === 2 ? 'item' : 'items'}`;

  return { title, rows };
}

function generatePaymentSuccessAdminHTML(data) {
  const quoteData = data.quoteData || {};
  const customer = quoteData.customer || {};
  const summary = buildPaymentSummaryRows(quoteData);
  const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
  const formattedPaidAt = paidAt.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(',', '');

  const basketRows = summary.basket.length
    ? summary.basket.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.name || 'Product')}</td>
        <td>${escapeHtml(item.code || 'N/A')}</td>
        <td>${escapeHtml(item.color || 'N/A')}</td>
        <td>${escapeHtml(item.quantity || 0)}</td>
        <td>${item.itemTotal != null ? `£${formatNumber(item.itemTotal)}` : 'N/A'}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="6">No basket items found in quote data.</td></tr>';

  const customizationRows = summary.customizations.length
    ? summary.customizations.map((item) => `
      <tr>
        <td>${escapeHtml(item.position || 'N/A')}</td>
        <td>${escapeHtml(item.method || 'N/A')}</td>
        <td>${escapeHtml(item.type || 'N/A')}</td>
        <td>${escapeHtml(item.quantity || 0)}</td>
        <td>${item.lineTotal != null ? `£${formatNumber(item.lineTotal)}` : 'N/A'}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5">No customizations found in quote data.</td></tr>';

  return `
  <html>
  <head>
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #111827; }
      .header { background: #059669; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
      .section { background: #f9fafb; padding: 18px; margin: 14px 0; border-radius: 8px; border-left: 4px solid #059669; }
      .label { font-weight: bold; color: #374151; width: 170px; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { padding: 9px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
      th { background: #ecfdf5; color: #065f46; }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>Payment Received</h1>
      <p>A customer payment has been confirmed by Stripe.</p>
    </div>

    <div class="section">
      <h2>Payment Details</h2>
      <table>
        <tr><td class="label">Quote ID:</td><td>${escapeHtml(data.quoteId)}</td></tr>
        <tr><td class="label">Payment Intent:</td><td>${escapeHtml(data.paymentIntentId)}</td></tr>
        <tr><td class="label">Amount Paid:</td><td><strong>${escapeHtml(data.amountFormatted)}</strong></td></tr>
        <tr><td class="label">Paid At:</td><td>${escapeHtml(formattedPaidAt)}</td></tr>
      </table>
    </div>

    <div class="section">
      <h2>Customer</h2>
      <table>
        <tr><td class="label">Name:</td><td>${escapeHtml(data.customerName || customer.fullName || customer.name || 'N/A')}</td></tr>
        <tr><td class="label">Email:</td><td>${escapeHtml(data.customerEmail || customer.email || 'N/A')}</td></tr>
        ${customer.phone ? `<tr><td class="label">Phone:</td><td>${escapeHtml(customer.phone)}</td></tr>` : ''}
        ${customer.company ? `<tr><td class="label">Company:</td><td>${escapeHtml(customer.company)}</td></tr>` : ''}
      </table>
    </div>

    <div class="section">
      <h2>Quote Summary</h2>
      <table>
        <tr><td class="label">Total Items:</td><td>${escapeHtml(summary.totalItems)}</td></tr>
        <tr><td class="label">Total Quantity:</td><td>${escapeHtml(summary.totalQuantity)}</td></tr>
        <tr><td class="label">Quote Total:</td><td>${summary.displayTotal != null ? `£${formatNumber(summary.displayTotal)}` : 'N/A'}</td></tr>
      </table>
    </div>

    <div class="section">
      <h2>Basket</h2>
      <table>
        <tr><th>#</th><th>Product</th><th>Code</th><th>Color</th><th>Qty</th><th>Total</th></tr>
        ${basketRows}
      </table>
    </div>

    <div class="section">
      <h2>Customizations</h2>
      <table>
        <tr><th>Position</th><th>Method</th><th>Type</th><th>Qty</th><th>Total</th></tr>
        ${customizationRows}
      </table>
    </div>
  </body>
  </html>
  `;
}

function generatePaymentSuccessCustomerHTML(data) {
  const productSummary = buildPaymentProductSummary(data.quoteData || {});
  const productRows = productSummary.rows.length
    ? productSummary.rows.map((item) => `<li>${escapeHtml(item.label)}</li>`).join('')
    : `<li>${escapeHtml(productSummary.title)}</li>`;

  return `
  <html>
  <body style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
    <div style="background:#059669;color:white;padding:20px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;">Payment received</h1>
    </div>
    <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
      <p>Hi ${escapeHtml(data.customerName || 'there')},</p>
      <p>Thanks, we have received your payment for <strong>${escapeHtml(productSummary.title)}</strong>.</p>
      <p><strong>What you paid for:</strong></p>
      <ul style="padding-left:20px;margin-top:6px;">${productRows}</ul>
      <p><strong>Amount paid:</strong> ${escapeHtml(data.amountFormatted)}</p>
      <p>Our team will review the details and continue processing your order.</p>
      <p style="color:#6b7280;font-size:12px;">Quote ID: ${escapeHtml(data.quoteId)}</p>
      <p style="color:#6b7280;font-size:12px;">Payment reference: ${escapeHtml(data.paymentIntentId)}</p>
    </div>
  </body>
  </html>
  `;
}

async function sendPaymentSuccessEmail(data) {
  const adminTo = process.env.PAYMENT_EMAIL_TO || process.env.EMAIL_TO;
  const from = process.env.EMAIL_FROM;
  const sendCustomerEmail = process.env.PAYMENT_SEND_CUSTOMER_EMAIL !== 'false';
  const customerEmail = data.customerEmail || data.quoteData?.customer?.email || null;
  const amountFormatted = formatCurrencyFromMinorUnits(data.amount, data.currency);
  const emailData = { ...data, amountFormatted, customerEmail };
  const results = { admin: null, customer: null };

  if (!adminTo) {
    throw new Error('PAYMENT_EMAIL_TO or EMAIL_TO is required for payment notifications');
  }

  const adminResult = await resend.emails.send({
    from,
    to: adminTo,
    replyTo: customerEmail || undefined,
    subject: `Payment Received - ${data.quoteId}`,
    html: generatePaymentSuccessAdminHTML(emailData),
  });
  results.admin = adminResult?.data?.id || adminResult?.id || null;

  if (sendCustomerEmail && customerEmail) {
    const productSummary = buildPaymentProductSummary(data.quoteData || {});
    const customerResult = await resend.emails.send({
      from,
      to: customerEmail,
      subject: `Payment received for ${productSummary.title}`,
      html: generatePaymentSuccessCustomerHTML(emailData),
    });
    results.customer = customerResult?.data?.id || customerResult?.id || null;
  }

  return { success: true, ...results };
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

    console.log("Result", result);


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
function insertBeforeQuoteRequestDate(html, sectionHtml) {
  const marker = /<div class="section">\s*<h2>[^<]*Request Date<\/h2>/;
  if (marker.test(html)) {
    return html.replace(marker, match => `${sectionHtml}\n    ${match}`);
  }
  return html.replace('</body>', `${sectionHtml}\n  </body>`);
}

function buildInitialQuotePreviewSection(previewImages = {}) {
  return `
    <div class="section">
      <h2>Garment Preview</h2>
      <table>
        ${Object.entries(previewImages).map(([view, asset]) => {
          const url = typeof asset === 'string' ? asset : asset?.url || '';
          if (!url) return '';
          const label = String(view || 'Preview').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
          return `
          <tr>
            <td class="label">${escapeHtml(label)}:</td>
            <td class="value">
              <img src="${escapeHtml(url)}" alt="${escapeHtml(label)} garment preview" style="display:block;width:100%;max-width:520px;height:auto;margin-top:8px;border:1px solid #e5e7eb;border-radius:6px;">
              <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;margin-top:8px;color:#7c3aed;font-size:12px;">Open full-size preview</a>
            </td>
          </tr>`;
        }).join('')}
      </table>
    </div>
  `;
}

function generateQuoteWithLogosEmailHTML(data, logoAssets = {}) {
  // Use the existing quote HTML generator
  let html = generateQuoteEmailHTML(data);
  const previewImages = data.previewImages && typeof data.previewImages === 'object'
    ? data.previewImages
    : {};

  // If there are logo assets, add a section for them
  if (Object.keys(logoAssets).length > 0) {
    const logosSection = `
    <div class="section">
      <h2>🖼️ Uploaded Logos</h2>
      <table>
        ${Object.entries(logoAssets).map(([position, asset]) => {
          const url = asset?.url || '';
          const imageSrc = url;
          const canPreview = !!imageSrc;

          return `
          <tr>
            <td class="label">${escapeHtml(position.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))}:</td>
            <td class="value">
              ${url ? `<a href="${escapeHtml(url)}" target="_blank" style="color: #7c3aed;">View Logo</a>` : 'Attached to email'}
              ${canPreview ? `<br><img src="${escapeHtml(imageSrc)}" alt="Logo" style="max-width: 150px; max-height: 100px; margin-top: 8px; border: 1px solid #e5e7eb; border-radius: 4px;">` : ''}
            </td>
          </tr>
        `;
        }).join('')}
      </table>
    </div>
    `;

    // Insert logos section before the request date section
    html = html.replace(
      /<div class="section">\s*<h2>📅 Request Date<\/h2>/,
      `${logosSection}\n    <div class="section">\n      <h2>📅 Request Date</h2>`
    );
  }

  if (Object.keys(previewImages).length > 0) {
    const previewsSection = `
    <div class="section">
      <h2>Garment Preview</h2>
      <table>
        ${Object.entries(previewImages).map(([view, asset]) => {
          const url = typeof asset === 'string' ? asset : asset?.url || '';
          if (!url) return '';
          const label = String(view || 'Preview').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
          return `
          <tr>
            <td class="label">${escapeHtml(label)}:</td>
            <td class="value">
              <img src="${escapeHtml(url)}" alt="${escapeHtml(label)} garment preview" style="display:block;width:100%;max-width:520px;height:auto;margin-top:8px;border:1px solid #e5e7eb;border-radius:6px;">
              <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;margin-top:8px;color:#7c3aed;font-size:12px;">Open full-size preview</a>
            </td>
          </tr>`;
        }).join('')}
      </table>
    </div>
    `;

    html = html.replace(
      /<div class="section">\s*<h2>ðŸ“… Request Date<\/h2>/,
      `${previewsSection}\n    <div class="section">\n      <h2>ðŸ“… Request Date</h2>`
    );
  }

  if (Object.keys(previewImages).length > 0 && !html.includes('Garment Preview')) {
    html = insertBeforeQuoteRequestDate(html, buildInitialQuotePreviewSection(previewImages));
  }

  return html;
}

async function sendQuoteEmailWithAttachments(data, attachments = [], logoAssets = {}) {
  try {
    const html = generateQuoteWithLogosEmailHTML(data, logoAssets);

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
        content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content,
        contentType: att.contentType,
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

function formatQuoteMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '&pound;0.00';
  return `&pound;${number.toFixed(2)}`;
}

function formatQuotePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `${number % 1 === 0 ? number.toFixed(0) : number.toFixed(2)}%`;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getOriginalLineTotal(item = {}) {
  return numberOrNull(item.originalLineTotal)
    ?? numberOrNull(item.itemTotal)
    ?? numberOrNull(item.lineTotal)
    ?? roundMoney(Number(item.quantity || 0) * Number(item.unitPrice || 0));
}

function getRawAdjustedLineTotal(item = {}) {
  return numberOrNull(item.adjustedLineTotal)
    ?? numberOrNull(item.adjustedTotal)
    ?? numberOrNull(item.adjustedPrice);
}

function normalizeQuoteLines(products, customizations, totals = {}) {
  const adjustedSubtotal = numberOrNull(totals.adjustedSubtotal);
  const lines = [
    ...products.map((item, index) => ({ type: 'product', index, item })),
    ...customizations.map((item, index) => ({ type: 'customization', index, item })),
  ].map(line => {
    const original = getOriginalLineTotal(line.item);
    const rawAdjusted = getRawAdjustedLineTotal(line.item);
    const hasUsableAdjusted = rawAdjusted !== null && !(original > 0 && rawAdjusted <= 0 && adjustedSubtotal > 0);
    return {
      ...line,
      original,
      adjusted: hasUsableAdjusted ? rawAdjusted : null,
      needsAllocation: !hasUsableAdjusted && original > 0,
    };
  });

  const knownAdjustedTotal = lines
    .filter(line => line.adjusted !== null)
    .reduce((sum, line) => sum + Number(line.adjusted || 0), 0);
  const missingLines = lines.filter(line => line.needsAllocation);
  const missingOriginalTotal = missingLines.reduce((sum, line) => sum + Number(line.original || 0), 0);
  let remainingAdjusted = adjustedSubtotal !== null
    ? roundMoney(adjustedSubtotal - knownAdjustedTotal)
    : null;

  if (remainingAdjusted !== null && missingLines.length > 0) {
    missingLines.forEach((line, index) => {
      if (index === missingLines.length - 1) {
        line.adjusted = roundMoney(Math.max(0, remainingAdjusted));
      } else {
        const share = missingOriginalTotal > 0 ? line.original / missingOriginalTotal : 1 / missingLines.length;
        const allocated = roundMoney(Math.max(0, remainingAdjusted * share));
        line.adjusted = allocated;
        remainingAdjusted = roundMoney(remainingAdjusted - allocated);
      }
    });
  }

  lines.forEach(line => {
    if (line.adjusted === null) line.adjusted = line.original;
    line.discountPercent = line.original > 0 && line.adjusted < line.original
      ? ((line.original - line.adjusted) / line.original) * 100
      : null;
  });

  return {
    products: products.map((item, index) => {
      const line = lines.find(entry => entry.type === 'product' && entry.index === index);
      return { ...item, _quoteOriginalTotal: line.original, _quoteAdjustedTotal: line.adjusted, _quoteDiscountPercent: line.discountPercent };
    }),
    customizations: customizations.map((item, index) => {
      const line = lines.find(entry => entry.type === 'customization' && entry.index === index);
      return { ...item, _quoteOriginalTotal: line.original, _quoteAdjustedTotal: line.adjusted, _quoteDiscountPercent: line.discountPercent };
    }),
  };
}

function renderAdjustedAmount(originalValue, adjustedValue, discountPercent) {
  const original = Number(originalValue);
  const adjusted = Number(adjustedValue);
  const hasOriginal = Number.isFinite(original);
  const hasAdjusted = Number.isFinite(adjusted);
  const isDiscounted = hasOriginal && hasAdjusted && adjusted < original;
  const discount = formatQuotePercent(discountPercent || (isDiscounted ? ((original - adjusted) / original) * 100 : null));

  if (!hasAdjusted && !hasOriginal) return '&pound;0.00';

  return `
    <div class="price-cell">
      ${isDiscounted ? `<div class="old-price">${formatQuoteMoney(original)}</div>` : ''}
      <div class="new-price">${formatQuoteMoney(hasAdjusted ? adjusted : original)}</div>
      ${isDiscounted && discount ? `<div class="discount-badge">${discount} off</div>` : ''}
    </div>
  `;
}

function renderSizes(sizes) {
  if (!sizes || typeof sizes !== 'object') return '';
  return Object.entries(sizes)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([size, quantity]) => `${escapeHtml(size)}: ${escapeHtml(quantity)}`)
    .join(', ');
}

function renderQuotePreviewGallery(snapshot = {}) {
  const previewImages = snapshot.previewImages || snapshot.preview_images || {};
  const normalized = [];

  if (previewImages && typeof previewImages === 'object' && !Array.isArray(previewImages)) {
    Object.entries(previewImages).forEach(([view, asset]) => {
      const url = typeof asset === 'string' ? asset : asset?.url || '';
      if (url) normalized.push({ view, url });
    });
  }

  const singlePreview = snapshot.previewImage || snapshot.preview_image || snapshot.mockupImage || snapshot.mockup_image;
  if (typeof singlePreview === 'string' && singlePreview && !normalized.some(item => item.url === singlePreview)) {
    normalized.unshift({ view: 'main', url: singlePreview });
  }

  if (normalized.length === 0) return '';

  return `
    <div class="section">
      <h2>Garment Preview</h2>
      ${normalized.map(({ view, url }) => {
        const label = String(view || 'Preview').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
        return `
          <div class="preview-item">
            <div class="item-title">${escapeHtml(label)}</div>
            <img src="${escapeHtml(url)}" alt="${escapeHtml(label)} garment preview" class="preview-image">
            <a href="${escapeHtml(url)}" target="_blank" class="preview-link">Open full-size preview</a>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderQuoteLogoGallery(snapshot = {}) {
  const logos = snapshot.logos && typeof snapshot.logos === 'object' && !Array.isArray(snapshot.logos)
    ? snapshot.logos
    : {};
  const normalized = Object.entries(logos)
    .map(([position, asset]) => ({
      position,
      url: typeof asset === 'string' ? asset : asset?.url || '',
    }))
    .filter(item => item.url);

  if (normalized.length === 0) return '';

  return `
    <div class="section">
      <h2>Uploaded Logos</h2>
      ${normalized.map(({ position, url }) => {
        const label = String(position || 'Logo').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
        return `
          <div class="preview-item">
            <div class="item-title">${escapeHtml(label)}</div>
            <img src="${escapeHtml(url)}" alt="${escapeHtml(label)} logo" class="logo-image">
            <a href="${escapeHtml(url)}" target="_blank" class="preview-link">Open full-size logo</a>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function generateAdjustedQuoteEmailHTML(snapshot = {}, quote = {}) {
  const customer = snapshot.customer || {};
  const rawProducts = Array.isArray(snapshot.products) ? snapshot.products : [];
  const rawCustomizations = Array.isArray(snapshot.customizations) ? snapshot.customizations : [];
  const totals = snapshot.totals || {};
  const normalizedLines = normalizeQuoteLines(rawProducts, rawCustomizations, totals);
  const products = normalizedLines.products;
  const customizations = normalizedLines.customizations;

  const customerName = customer.name || customer.fullName || quote.customer_name || 'Customer';
  const quoteRef = quote.quote_id || quote.id || '';
  const discountPercent = formatQuotePercent(totals.discountPercent);

  const productRows = products.length ? products.map(product => {
    const sizeText = renderSizes(product.sizes);
    return `
      <tr>
        <td>
          <div class="item-title">${escapeHtml(product.name || 'Product')}</div>
          <div class="muted">${escapeHtml(product.code || '')}${product.colour ? ` - ${escapeHtml(product.colour)}` : ''}</div>
          ${sizeText ? `<div class="muted">Sizes: ${sizeText}</div>` : ''}
        </td>
        <td class="numeric">${escapeHtml(product.quantity || 0)}</td>
        <td class="numeric">${formatQuoteMoney(product.unitPrice || 0)}</td>
        <td class="numeric">${renderAdjustedAmount(product._quoteOriginalTotal, product._quoteAdjustedTotal, product._quoteDiscountPercent)}</td>
      </tr>
    `;
  }).join('') : `
    <tr><td colspan="4" class="muted">No garment lines included.</td></tr>
  `;

  const customizationRows = customizations.length ? customizations.map(item => `
    <tr>
      <td>
        <div class="item-title">${escapeHtml(item.position || 'Customization')}</div>
        <div class="muted">${escapeHtml(item.method || '')}</div>
      </td>
      <td class="numeric">${escapeHtml(item.quantity || 0)}</td>
      <td class="numeric">${formatQuoteMoney(item.unitPrice || 0)}</td>
      <td class="numeric">${renderAdjustedAmount(item._quoteOriginalTotal, item._quoteAdjustedTotal, item._quoteDiscountPercent)}</td>
    </tr>
  `).join('') : `
    <tr><td colspan="4" class="muted">No customization lines included.</td></tr>
  `;

  return `
  <html>
    <head>
      <style>
        body { margin: 0; padding: 0; background: #f3f4f6; font-family: Arial, sans-serif; color: #111827; }
        .wrapper { max-width: 760px; margin: 0 auto; padding: 24px; }
        .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
        .header { background: #111827; color: #ffffff; padding: 24px; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 8px 0 0; color: #d1d5db; }
        .content { padding: 24px; }
        .section { margin-bottom: 24px; }
        .section h2 { margin: 0 0 12px; font-size: 17px; color: #111827; }
        .details { width: 100%; border-collapse: collapse; }
        .details td { padding: 6px 0; vertical-align: top; }
        .label { color: #6b7280; width: 120px; }
        .quote-table { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; table-layout: fixed; }
        .quote-table th { background: #f9fafb; color: #374151; font-size: 12px; text-align: left; padding: 10px; border-bottom: 1px solid #e5e7eb; }
        .quote-table td { padding: 12px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; word-break: break-word; }
        .quote-table tr:last-child td { border-bottom: none; }
        .numeric { text-align: right; white-space: nowrap; }
        .item-title { font-weight: 700; color: #111827; }
        .muted { color: #6b7280; font-size: 13px; margin-top: 3px; }
        .old-price { color: #9ca3af; text-decoration: line-through; font-size: 13px; }
        .new-price { color: #111827; font-weight: 700; }
        .discount-badge { display: inline-block; margin-top: 4px; padding: 2px 7px; border-radius: 999px; background: #dcfce7; color: #166534; font-size: 12px; font-weight: 700; }
        .preview-item { margin-bottom: 14px; }
        .preview-image { display: block; width: 100%; max-width: 520px; height: auto; margin-top: 8px; border: 1px solid #e5e7eb; border-radius: 6px; }
        .logo-image { display: block; width: auto; max-width: 100%; max-height: 260px; height: auto; margin-top: 8px; border: 1px solid #e5e7eb; border-radius: 6px; }
        .preview-link { display: inline-block; margin-top: 8px; color: #2563eb; font-size: 12px; }
        .totals { width: 100%; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; border-collapse: separate; border-spacing: 0; }
        .totals td { padding: 9px 14px; border-bottom: 1px solid #e5e7eb; }
        .totals tr:last-child td { border-bottom: none; font-size: 18px; font-weight: 800; color: #111827; }
        .total-value { text-align: right; white-space: nowrap; }
        .footer { color: #6b7280; font-size: 12px; padding: 0 24px 24px; }
        @media only screen and (max-width: 620px) {
          .wrapper { padding: 0 !important; }
          .content { padding: 16px !important; }
          .header { padding: 18px !important; }
          .quote-table th, .quote-table td { padding: 8px 6px !important; font-size: 12px !important; }
          .quote-table th:nth-child(2), .quote-table td:nth-child(2) { width: 42px !important; }
          .quote-table th:nth-child(3), .quote-table td:nth-child(3) { width: 60px !important; }
          .quote-table th:nth-child(4), .quote-table td:nth-child(4) { width: 78px !important; }
          .numeric { white-space: normal !important; }
          .old-price, .new-price { display: block; }
          .discount-badge { font-size: 11px !important; padding: 2px 5px !important; }
        }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="card">
          <div class="header">
            <h1>Your BrandedUK Quote</h1>
            <p>${quoteRef ? `Quote reference: ${escapeHtml(quoteRef)}` : 'Your adjusted quote is ready.'}</p>
          </div>
          <div class="content">
            <div class="section">
              <h2>Customer Details</h2>
              <table class="details">
                <tr><td class="label">Name</td><td>${escapeHtml(customerName)}</td></tr>
                <tr><td class="label">Email</td><td>${escapeHtml(customer.email || quote.customer_email || '')}</td></tr>
                ${customer.phone || quote.customer_phone ? `<tr><td class="label">Phone</td><td>${escapeHtml(customer.phone || quote.customer_phone)}</td></tr>` : ''}
                ${customer.company || quote.customer_company ? `<tr><td class="label">Company</td><td>${escapeHtml(customer.company || quote.customer_company)}</td></tr>` : ''}
                ${customer.address || quote.customer_address ? `<tr><td class="label">Address</td><td>${escapeHtml(customer.address || quote.customer_address)}</td></tr>` : ''}
              </table>
            </div>

            ${renderQuoteLogoGallery(snapshot)}
            ${renderQuotePreviewGallery(snapshot)}

            <div class="section">
              <h2>Products</h2>
              <table class="quote-table">
                <thead><tr><th style="width:52%;">Item</th><th class="numeric" style="width:10%;">Qty</th><th class="numeric" style="width:16%;">Unit</th><th class="numeric" style="width:22%;">Line Total</th></tr></thead>
                <tbody>${productRows}</tbody>
              </table>
            </div>

            <div class="section">
              <h2>Customizations</h2>
              <table class="quote-table">
                <thead><tr><th style="width:52%;">Position</th><th class="numeric" style="width:10%;">Qty</th><th class="numeric" style="width:16%;">Unit</th><th class="numeric" style="width:22%;">Line Total</th></tr></thead>
                <tbody>${customizationRows}</tbody>
              </table>
            </div>

            <div class="section">
              <h2>Quote Summary</h2>
              <table class="totals">
                ${Number(totals.originalSubtotal) > Number(totals.adjustedSubtotal) ? `<tr><td>Original subtotal</td><td class="total-value old-price">${formatQuoteMoney(totals.originalSubtotal)}</td></tr>` : ''}
                <tr><td>Adjusted subtotal</td><td class="total-value">${formatQuoteMoney(totals.adjustedSubtotal)}</td></tr>
                ${Number(totals.discountAmount) > 0 ? `<tr><td>Discount${discountPercent ? ` (${discountPercent})` : ''}</td><td class="total-value">${formatQuoteMoney(totals.discountAmount)}</td></tr>` : ''}
                <tr><td>VAT (${formatQuotePercent(Number(totals.vatRate || 0) * 100) || '0%'})</td><td class="total-value">${formatQuoteMoney(totals.vatAmount)}</td></tr>
                ${Number(totals.originalTotalIncVat) > Number(totals.totalIncVat) ? `<tr><td>Original total inc VAT</td><td class="total-value old-price">${formatQuoteMoney(totals.originalTotalIncVat)}</td></tr>` : ''}
                <tr><td>Total inc VAT</td><td class="total-value">${formatQuoteMoney(totals.totalIncVat)}</td></tr>
              </table>
            </div>
          </div>
          <div class="footer">This quote was prepared by BrandedUK. Prices are based on the snapshot sent in this email.</div>
        </div>
      </div>
    </body>
  </html>
  `;
}

async function sendAdjustedQuoteEmail({ to, snapshot, quote, html }) {
  const customerName = snapshot?.customer?.name || snapshot?.customer?.fullName || quote?.customer_name || 'Customer';
  const quoteRef = quote?.quote_id || quote?.id || 'Quote';
  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    replyTo: process.env.EMAIL_TO || process.env.EMAIL_FROM,
    subject: `Your BrandedUK Quote - ${quoteRef}`,
    html: html || generateAdjustedQuoteEmailHTML(snapshot, quote),
  });

  const emailId = result?.data?.id || result?.id || null;
  console.log(`[EMAIL] Adjusted quote sent to ${to} for ${customerName}. ID: ${emailId || 'n/a'}`);
  return { success: true, id: emailId };
}

module.exports = {
  sendQuoteEmail,
  sendContactEmail,
  sendQuoteEmailWithAttachments,
  sendPaymentSuccessEmail,
  generateQuoteWithLogosEmailHTML,
  generateAdjustedQuoteEmailHTML,
  sendAdjustedQuoteEmail,
};
