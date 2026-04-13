/**
 * Test script to verify logo email fix
 * Run: node test-email-logo.js
 */
require('dotenv').config();

const { sendQuoteEmail } = require('./utils/emailService');

// Larger test logo - BrandedUK purple square 100x100 with "LOGO" text (PNG)
const TEST_LOGO_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAACXBIWXMAAAsTAAALEwEAmpwYAAAE7klEQVR4nO2dW4hVVRjHf+M4OmZqmZlZapZaVmZlF7OHsqKLRUQX6iF6CPqCgoiIHoqgh4J6iIiIHoKIBLtJF7JMK7PMytJKy9Isy8zKxsp0pofvG9fZnpk5e8/Za++9/j/4Meecvdda3/r2Wt9lrwUSiUQikUgkEolEIpFIJBKJvuF44FJgJjAZGAUMA/YD24FNwHvAOmBHTjJ2CxOBxcABYGcXdhh4H1gIjM5B1q5gNvBSF0p4FJsL3JKt2NXPNOA9OqfIo9l7wPQM5a5qTgR2UL9CkuyftazVyhLqV0QpWwKclJHslc544Gfiq+VPYEIGOlQtPUCv4vb1IWBM8JJXN8OAV4h/xn4DDAxc9qrlEuI+Y0sZD4wMWvYqZgDwLfGfrb8ELHsV0yd8SfzT5SPgioC1qBYOBu4k/jP1AvBAwLpUBe8Q/5n6JHB+sBpUC58R/5n6KXBWsBpUC1sIn1fWJioqWA2qhTmE7xtVOqWD1aBa2IcGQBWmHIoNg9WgWhgCfET8Z+x2NFVQWB2qhTHAG0R+xr6FpgoKo0M1sJZyh1E7sJb2Sk8DzqXY+dHhKKQTxqIJyHqEOxd4DDgjo3K7htXAfGABcDcal+jEWuA24Mws6u4arkHjEFsJ1wD69aQe4ALgjIzq7hqGIp/yNuFmFrYCewJXUgm8TrxnbLn9ClwXsCJVwI3E88mh7BzgsoBliEoeoebKhmwHrghYhmrgeOI9Y7/aBswMWIZqoB/4h/jP4J+Ac0K0VRV8TvxnMMmqeVxAAdhB/GcwyQpZXrcykHDPYJKFLK8rGEH8ZzDJfiJ+ed1IH9IthlOqJE8hXF+xeSfwoVIkeSp0tWOQ7UeDpk3IrzwJPCXUYO8NyBedR/hZzYPAOuAXwi6yeQf4R4ibMTrJnwTuhpwL/E7YVQX3A38TN4C4Frgb2EXYwOku4K/QtdUJM4k/gZ5kswNXVwlLiR8InGTLQ1dXCQuJHwicZCtCV1cJc4gfCJxkS0NXVwmziB8InGQLQldXCdOIPxE5yW4LXF7l0QP8RO1A2k6Z1EHO0BVW3jHAYmAz8VcU1GKJb1QVcDLhp8snWbWn3UFlcDzhZxUn2QLgqYA1qRY0VnAL8Z/NJHsceDBgTaqBE4B/if8MJtmDwH0Ba1INDAReJJxvGYf86WeAuwLWpBo4FviAcO0wyRYRf85d1A0CXkP7JEKdD5xkDwP3BKxJNXAs8Cph2liSzQfuDFiTauA44DXitcMkuwe4I2BNqoGhKLCK1w6T7C7g5oA1qQb6o8DqJeK1wyS7k/BOcNUxCHiZcO0wyeYANwasSTVwDPA04caBkmwOcGPAmlQDgyj/9i6EHSRc3xXxmPsQriNeG2uVVXPStgBMCG0N97n/G+CbSm/iN2AY8QOwWqzafnMdsD9QhSqBPuoLrM6yxwoYSwfCBFYp7b2UcPvJk+wqNDM+ZB2C0K+w7CW/tjmYsOdJJtkVwNXATsFPLJah9T4hKvBRJ6a+3rfOEfCTi+Xo8E7AN/4XsJwws+s7tf1o38u2wI//gS2h8Bvh9xJsDm0i8qQE5j1aqc2HRCSN24FltFdxVIpPgCGEv4SwlcJvMpRIJBKJRCKRSCQSiUQikehu/gNLgT6MJlD8vQAAAABJRU5ErkJggg==';

const testData = {
  customer: {
    fullName: 'Test User',
    email: 'info@brandeduk.com',
    phone: '+44 1234 567890',
    company: 'Test Company Ltd',
    address: '123 Test Street, London'
  },
  basket: [
    {
      name: 'Premium Polo Shirt',
      code: 'POLO-001',
      color: 'Navy Blue',
      quantity: 50,
      sizes: { S: 10, M: 20, L: 15, XL: 5 },
      unitPrice: 12.50,
      itemTotal: 625.00,
      note: 'Please ensure all sizes are available'
    }
  ],
  customizations: [
    {
      method: 'embroidery',
      type: 'logo',
      position: 'Left Breast',
      hasLogo: true,
      logo: TEST_LOGO_BASE64, // This is the base64 logo to test
      unitPrice: 5.00,
      lineTotal: 250.00,
      quantity: 50
    },
    {
      method: 'print',
      type: 'text',
      position: 'Back',
      hasLogo: false,
      text: 'Company Name',
      unitPrice: 3.50,
      lineTotal: 175.00,
      quantity: 50
    }
  ],
  summary: {
    totalQuantity: 50,
    totalItems: 1,
    garmentCost: 625.00,
    customizationCost: 425.00,
    digitizingFee: 25.00,
    subtotal: 1075.00,
    vatAmount: 215.00,
    displayTotal: 1290.00,
    vatMode: 'inc'
  },
  timestamp: new Date().toISOString()
};

async function runTest() {
  console.log('🧪 Testing email with logo attachment...');
  console.log('📧 Sending to:', process.env.EMAIL_TO);
  console.log('');
  
  try {
    const result = await sendQuoteEmail(testData);
    console.log('');
    console.log('✅ SUCCESS! Email sent.');
    console.log('📬 Email ID:', result.id);
    console.log('');
    console.log('Check your inbox at info@brandeduk.com for the test email.');
    console.log('The email should have:');
    console.log('  - Logo shown as "📎 Logo attached: logo-Left-Breast.png"');
    console.log('  - A PNG attachment with the logo');
    console.log('  - Item notes displayed');
  } catch (error) {
    console.error('');
    console.error('❌ FAILED:', error.message);
    console.error('Details:', error);
  }
}

runTest();
