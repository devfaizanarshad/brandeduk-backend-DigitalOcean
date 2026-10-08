const test = require('node:test');
const assert = require('node:assert/strict');

process.env.RESEND_API_KEY ||= 're_test_key';

const {
  generateContactEmailHTML,
  generateAdminQuoteEmailHTML,
  generateQuoteWithLogosEmailHTML,
} = require('../utils/emailService');

test('quote submissions use the professional basket email layout', () => {
  const quote = {
    customer: {
      fullName: 'Alex Buyer',
      email: 'alex@example.com',
      phone: '0208 974 2722',
    },
    basket: [{
      name: 'Ultra Cotton adult t-shirt',
      code: 'GD002',
      color: 'Cherry Red',
      size: 'M',
      quantity: 11,
      unitPrice: 5.25,
      itemTotal: 57.75,
      image: 'https://cdn.example.com/product.png',
    }],
    customizations: [{
      position: 'Front',
      method: 'DTF Print',
      hasLogo: true,
      quantity: 11,
      unitPrice: 3.95,
      lineTotal: 43.45,
    }],
    summary: {
      garmentCost: 57.75,
      customizationCost: 43.45,
      totalExVat: 101.20,
      vatAmount: 20.24,
      totalIncVat: 121.44,
    },
    notes: 'Please confirm production time.',
    timestamp: '2026-10-08T10:00:00.000Z',
  };
  const logoAssets = {
    front: { url: 'https://cdn.example.com/customer-logo.png' },
  };

  const html = generateAdminQuoteEmailHTML(quote, logoAssets);
  const attachmentHtml = generateQuoteWithLogosEmailHTML(quote, logoAssets);

  for (const rendered of [html, attachmentHtml]) {
    assert.match(rendered, /Basket quote request/);
    assert.match(rendered, /Customer information/);
    assert.match(rendered, /Ultra Cotton adult t-shirt/);
    assert.match(rendered, /DTF Print/);
    assert.match(rendered, /src="https:\/\/cdn\.example\.com\/customer-logo\.png"/);
    assert.match(rendered, />Download</);
    assert.match(rendered, /&pound;121\.44/);
    assert.match(rendered, /Please confirm production time\./);
    assert.doesNotMatch(rendered, /Open This Quote/);
  }
});

test('basket contact email renders customer, product, decoration and summary details', () => {
  const html = generateContactEmailHTML({
    name: 'Alex Buyer',
    email: 'alex@example.com',
    interest: 'printing',
    phone: '0208 974 2722',
    postCode: 'KT6 7QD',
    message: 'Please confirm delivery timing.',
    submittedAt: '2026-10-03T10:00:00.000Z',
    basketSnapshot: {
      orderNotes: 'Pack sizes separately.',
      items: [{
        name: 'Anthem unisex hoodie',
        code: 'AM006',
        color: 'Navy',
        size: 'XS',
        quantity: 10,
        unitPrice: 30.31,
        itemTotal: 303.10,
        imageUrl: 'https://cdn.example.com/hoodie.jpg',
        decorations: [{
          type: 'logo',
          method: 'Print',
          position: 'Large Front',
          logoUrl: 'https://cdn.example.com/logo.png',
          previewUrl: 'https://cdn.example.com/preview.png',
          unitPrice: 5.25,
          lineTotal: 52.50
        }]
      }],
      summary: {
        productCosts: 303.10,
        customizationCosts: 52.50,
        subtotalExVat: 355.60,
        vatAmount: 71.12,
        totalIncVat: 426.72
      }
    }
  });

  assert.match(html, /Customer information/);
  assert.match(html, /Alex Buyer/);
  assert.match(html, /Anthem unisex hoodie/);
  assert.match(html, /AM006/);
  assert.match(html, /Navy/);
  assert.match(html, /Large Front/);
  assert.match(html, /href="https:\/\/cdn\.example\.com\/preview\.png"/);
  assert.match(html, /src="https:\/\/cdn\.example\.com\/logo\.png"/);
  assert.match(html, />Download</);
  assert.match(html, /shop-pc\?product=AM006/);
  assert.match(html, /&pound;426\.72/);
  assert.match(html, /Pack sizes separately\./);
});

test('basket contact email escapes content and rejects unsafe artwork links', () => {
  const html = generateContactEmailHTML({
    name: '<script>alert(1)</script>',
    email: 'safe@example.com',
    interest: 'other',
    message: '<img src=x onerror=alert(1)>',
    basketSnapshot: {
      items: [{
        name: '<b>Product</b>',
        quantity: 1,
        decorations: [{
          method: 'Print',
          position: 'Front',
          logoUrl: 'javascript:alert(1)'
        }]
      }]
    }
  });

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.match(html, /&lt;b&gt;Product&lt;\/b&gt;/);
});

test('ordinary contact submissions retain the standard contact email', () => {
  const html = generateContactEmailHTML({
    name: 'Normal Contact',
    email: 'normal@example.com',
    interest: 'workwear',
    message: 'General question'
  });

  assert.match(html, /New Contact Form Submission/);
  assert.doesNotMatch(html, /Basket items/);
});
