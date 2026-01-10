// services/emailService.js

const { Resend } = require("resend");

if (!process.env.RESEND_API_KEY) {
  throw new Error("❌ RESEND_API_KEY is missing in environment variables");
}

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Generates HTML email
 */
function generateQuoteEmailHTML(data) {
  const customerName =
    data.customer?.fullName ||
    `${data.customer?.firstName || ""} ${data.customer?.lastName || ""}`.trim() ||
    "Customer";

  const customizationsHTML = (data.customizations || [])
    .map(
      (item) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${item.label}</td>
        <td style="padding:8px;border:1px solid #ddd;">
          ${
            item.logoUrl
              ? `<a href="${item.logoUrl}" target="_blank">View Logo</a>`
              : item.value || "N/A"
          }
        </td>
      </tr>
    `
    )
    .join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:auto">
    <h2>📩 New Quote Request</h2>

    <h3>👤 Customer Details</h3>
    <p>
      <strong>Name:</strong> ${customerName}<br/>
      <strong>Email:</strong> ${data.customer?.email || "N/A"}<br/>
      <strong>Phone:</strong> ${data.customer?.phone || "N/A"}
    </p>

    <h3>📦 Product</h3>
    <p>
      <strong>Name:</strong> ${data.product?.name || "N/A"}<br/>
      <strong>Code:</strong> ${data.product?.code || "N/A"}<br/>
      <strong>Quantity:</strong> ${data.product?.quantity || "N/A"}<br/>
      <strong>Price:</strong> ${data.product?.price || "N/A"}
    </p>

    ${
      customizationsHTML
        ? `
      <h3>🎨 Customizations</h3>
      <table style="border-collapse:collapse;width:100%">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Type</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Value</th>
          </tr>
        </thead>
        <tbody>
          ${customizationsHTML}
        </tbody>
      </table>
      `
        : ""
    }

    <p style="margin-top:20px;color:#666">
      Submitted on: ${new Date(data.timestamp || Date.now()).toLocaleString()}
    </p>
  </div>
  `;
}

/**
 * Sends quote email via Resend
 */
async function sendQuoteEmail(data) {
  try {
    const html = generateQuoteEmailHTML(data);

    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      replyTo: data.customer?.email,
      subject: `New Quote Request - ${data.customer?.fullName || "Customer"}`,
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
