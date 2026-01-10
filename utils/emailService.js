// services/emailService.js
const { Resend } = require("resend");

if (!process.env.RESEND_API_KEY) {
  throw new Error("❌ RESEND_API_KEY is missing in environment variables");
}

const resend = new Resend(process.env.RESEND_API_KEY);

function generateQuoteEmailHTML(data) {
  const customer = data.customer || {};
  const summary = data.summary || {};
  const basket = data.basket || [];
  const customizations = data.customizations || [];
  const product = data.product || {}; // Legacy fallback

  const customerName = customer.fullName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer';
  const customerEmail = customer.email || '';
  const customerPhone = customer.phone || '';

  /* -------- Basket Items HTML -------- */
  const basketHTML = basket.length
    ? basket.map((item, index) => {
        const itemName = item.name || 'Product';
        const itemCode = item.code || 'N/A';
        const itemColor = item.color || 'N/A';
        const itemQty = item.quantity || 0;
        const unitPrice = item.unitPrice ? parseFloat(item.unitPrice).toFixed(2) : '0.00';
        const itemTotal = item.itemTotal ? parseFloat(item.itemTotal).toFixed(2) : '0.00';

        let sizesText = '';
        if (item.sizes && typeof item.sizes === 'object') {
          const sizesArray = Object.entries(item.sizes)
            .filter(([size, qty]) => qty > 0)
            .map(([size, qty]) => `${size}: ${qty}`);
          sizesText = sizesArray.length ? sizesArray.join(', ') : item.sizesSummary || '';
        } else {
          sizesText = item.sizesSummary || '';
        }

        return `
        <div class="basket-item">
          <div class="basket-item-header">Item #${index + 1}: ${itemName} (${itemCode})</div>
          <table>
            <tr><td class="label">Color:</td><td class="value">${itemColor}</td></tr>
            <tr><td class="label">Total Quantity:</td><td class="value"><strong>${itemQty} units</strong></td></tr>
            ${sizesText ? `<tr><td class="label">Sizes:</td><td class="value sizes-detail">${sizesText}</td></tr>` : ''}
            <tr><td class="label">Unit Price:</td><td class="value">£${unitPrice}</td></tr>
            <tr><td class="label">Item Total:</td><td class="value"><strong>£${itemTotal}</strong></td></tr>
          </table>
        </div>`;
      }).join('')
    : `<p>Product: ${product.name || 'N/A'}</p>
       <p>Code: ${product.code || 'N/A'}</p>
       <p>Quantity: ${product.quantity || 0} units</p>`;

  /* -------- Customizations HTML -------- */
  const customizationsHTML = customizations.length
    ? customizations.map(c => {
        const method = (c.method || 'N/A').toUpperCase();
        const type = c.type || 'N/A';
        const position = c.position || 'Unknown';
        const hasLogo = c.hasLogo ?? c.uploadedLogo ?? false;
        const logo = hasLogo ? '✅ Yes' : '❌ No';
        const text = c.text ? ` - Text: ${c.text}` : '';
        const unitPrice = c.unitPrice === 'POA' ? 'POA' : `£${parseFloat(c.unitPrice || 0).toFixed(2)}`;
        const lineTotal = c.lineTotal === 'POA' ? 'POA' : `£${parseFloat(c.lineTotal || 0).toFixed(2)}`;
        const qty = c.quantity || 0;

        return `
        <tr>
          <td class="label">${position}</td>
          <td class="value">
            <strong>${method}</strong> - ${type}<br>
            Logo Uploaded: ${logo}${text}<br>
            <small>Unit: ${unitPrice} × Qty: ${qty} = ${lineTotal}</small>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="2">No customizations selected</td></tr>`;

  /* -------- Summary HTML -------- */
  const garmentCost = parseFloat(summary.garmentCost || 0).toFixed(2);
  const customizationCost = parseFloat(summary.customizationCost || 0).toFixed(2);
  const digitizingFee = parseFloat(summary.digitizingFee || 0).toFixed(2);
  const subtotal = parseFloat(summary.subtotal || 0).toFixed(2);
  const vatAmount = parseFloat(summary.vatAmount || 0).toFixed(2);
  const displayTotal = parseFloat(summary.displayTotal || 0).toFixed(2);
  const totalQty = summary.totalQuantity || 0;
  const totalItems = summary.totalItems || basket.length || 0;
  const vatMode = summary.vatMode || 'ex';

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
        <tr><td class="label">Name:</td><td class="value">${customerName}</td></tr>
        <tr><td class="label">Email:</td><td class="value">${customerEmail}</td></tr>
        <tr><td class="label">Phone:</td><td class="value">${customerPhone}</td></tr>
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
        ${digitizingFee > 0 ? `<div class="summary-row"><span>Digitizing Fee (one-time):</span><span>£${digitizingFee} ex VAT</span></div>` : ''}
        <div class="summary-row"><span>Subtotal (ex VAT):</span><span>£${subtotal}</span></div>
        <div class="summary-row"><span>VAT (20%):</span><span>£${vatAmount}</span></div>
        <div class="summary-row"><span><strong>Total (${vatMode === 'inc' ? 'inc' : 'ex'} VAT):</strong></span><span><strong>£${displayTotal}</strong></span></div>
      </div>
    </div>

    <div class="section">
      <h2>📅 Request Date</h2>
      <p>${new Date().toLocaleString()}</p>
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

    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      replyTo: data.customer?.email,
      subject: `New Quote Request - ${data.customer?.fullName || 'Customer'}`,
      html,
    });

    console.log("✅ Email sent via Resend:", result.id);
    return { success: true, id: result.id };

  } catch (error) {
    console.error("❌ Email sending failed:", error);
    throw error;
  }
}

module.exports = { sendQuoteEmail };
