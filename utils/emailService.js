// services/emailService.js

const { Resend } = require("resend");

if (!process.env.RESEND_API_KEY) {
  throw new Error("❌ RESEND_API_KEY is missing in environment variables");
}

const resend = new Resend(process.env.RESEND_API_KEY);

/* =========================
   HTML GENERATOR
========================= */
function generateQuoteEmailHTML(data) {
  const customer = data.customer || {};
  const summary = data.summary || {};
  const basket = data.basket || [];
  const customizations = data.customizations || [];

  /* -------- Basket Table -------- */
  const basketRows = basket.map(item => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${item.name}</td>
      <td style="padding:8px;border:1px solid #ddd;">${item.code}</td>
      <td style="padding:8px;border:1px solid #ddd;">${item.color}</td>
      <td style="padding:8px;border:1px solid #ddd;">${item.sizesSummary || ''}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:center;">${item.quantity}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">£${item.unitPrice}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">£${item.itemTotal}</td>
    </tr>
  `).join("");

  /* -------- Customizations Table -------- */
  const customRows = customizations.map(c => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${c.position}</td>
      <td style="padding:8px;border:1px solid #ddd;">${c.method}</td>
      <td style="padding:8px;border:1px solid #ddd;">${c.type}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:center;">${c.quantity}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">${c.unitPrice}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">${c.lineTotal}</td>
    </tr>
  `).join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:900px;margin:auto">

    <h2>📩 New Quote Request</h2>

    <h3>👤 Customer</h3>
    <p>
      <strong>Name:</strong> ${customer.fullName || 'N/A'}<br/>
      <strong>Email:</strong> ${customer.email || 'N/A'}<br/>
      <strong>Phone:</strong> ${customer.phone || 'N/A'}
    </p>

    <h3>📦 Basket</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
      <thead>
        <tr>
          <th style="padding:8px;border:1px solid #ddd;">Product</th>
          <th style="padding:8px;border:1px solid #ddd;">Code</th>
          <th style="padding:8px;border:1px solid #ddd;">Color</th>
          <th style="padding:8px;border:1px solid #ddd;">Sizes</th>
          <th style="padding:8px;border:1px solid #ddd;">Qty</th>
          <th style="padding:8px;border:1px solid #ddd;">Unit £</th>
          <th style="padding:8px;border:1px solid #ddd;">Total £</th>
        </tr>
      </thead>
      <tbody>
        ${basketRows}
      </tbody>
    </table>

    ${customRows ? `
    <h3>🎨 Customizations</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
      <thead>
        <tr>
          <th style="padding:8px;border:1px solid #ddd;">Position</th>
          <th style="padding:8px;border:1px solid #ddd;">Method</th>
          <th style="padding:8px;border:1px solid #ddd;">Type</th>
          <th style="padding:8px;border:1px solid #ddd;">Qty</th>
          <th style="padding:8px;border:1px solid #ddd;">Unit £</th>
          <th style="padding:8px;border:1px solid #ddd;">Line £</th>
        </tr>
      </thead>
      <tbody>
        ${customRows}
      </tbody>
    </table>
    ` : ''}

    <h3>💷 Summary</h3>
    <p>
      Garment Cost: £${summary.garmentCost}<br/>
      Customization Cost: £${summary.customizationCost}<br/>
      Digitizing Fee: £${summary.digitizingFee}<br/>
      Subtotal: £${summary.subtotal}<br/>
      VAT (${(summary.vatRate || 0) * 100}%): £${summary.vatAmount}<br/>
      <strong>Total (${summary.vatMode === 'inc' ? 'Inc VAT' : 'Ex VAT'}): £${summary.displayTotal}</strong>
    </p>

    <p style="margin-top:20px;color:#666">
      Submitted: ${new Date(data.timestamp || Date.now()).toLocaleString()}
    </p>

  </div>
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

module.exports = {
  sendQuoteEmail,
};
