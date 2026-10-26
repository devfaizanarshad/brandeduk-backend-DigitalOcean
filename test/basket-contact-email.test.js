const test = require('node:test');
const assert = require('node:assert/strict');

process.env.RESEND_API_KEY ||= 're_test_key';

const {
  generateContactEmailHTML,
  generateAdminQuoteEmailHTML,
  generateAdjustedQuoteEmailHTML,
  generateQuoteWithLogosEmailHTML,
} = require('../utils/emailService');

test('quote submissions use the professional basket email layout', () => {
  const quote = {
    quoteId: 'quote_admin_123',
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
    assert.match(rendered, /src="cid:brandeduk-brand-logo"/);
    assert.match(rendered, /Open in Admin/);
    assert.match(rendered, /\/orders\/quote_admin_123/);
    assert.match(rendered, /Customer information/);
    assert.match(rendered, /Ultra Cotton adult t-shirt/);
    assert.match(rendered, /DTF Print/);
    assert.match(rendered, /src="https:\/\/cdn\.example\.com\/customer-logo\.png"/);
    assert.match(rendered, />Download</);
    assert.match(rendered, /&pound;121\.44/);
    assert.match(rendered, /Please confirm production time\./);
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

test('admin quote email shows delivery when the submitted total includes it', () => {
  const html = generateAdminQuoteEmailHTML({
    quoteId: 'quote_delivery_123',
    customer: { fullName: 'Delivery Check', email: 'delivery@example.com' },
    basket: [{
      name: 'Classic hoodie',
      code: 'SS224',
      quantity: 4,
      unitPrice: 13.90,
      itemTotal: 55.60,
    }],
    customizations: [{
      productCode: 'SS224',
      method: 'Print',
      position: 'Large Front',
      quantity: 4,
      unitPrice: 7.70,
      lineTotal: 30.80,
    }],
    summary: {
      garmentCost: 55.60,
      customizationCost: 30.80,
      deliveryExVat: 6.62,
      deliveryIncVat: 7.95,
      deliveryVatAmount: 1.33,
      totalExVat: 93.02,
      vatAmount: 18.61,
      totalIncVat: 111.63,
    },
  });

  assert.match(html, /Delivery/);
  assert.match(html, /&pound;6\.62/);
  assert.match(html, /&pound;7\.95 inc\. VAT/);
  assert.match(html, /&pound;93\.02/);
  assert.match(html, /&pound;111\.63/);
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

test('quote email renders uploaded artwork and garment previews from inline attachments', () => {
  const html = generateAdminQuoteEmailHTML({
    customer: { fullName: 'Inline Images', email: 'inline@example.com' },
    basket: [{
      name: 'Heavy Blend hoodie',
      code: 'GD057',
      quantity: 4,
      unitPrice: 21.31,
      itemTotal: 85.24,
      image: 'https://cdn.example.com/fallback.jpg',
    }],
    customizations: [{
      position: 'Left Chest',
      method: 'Print',
      quantity: 4,
      unitPrice: 7.50,
      lineTotal: 30,
    }],
    previewImages: {
      'item-1-gd057-front': {
        url: 'https://api.example.com/uploads/preview.jpg',
        contentId: 'quote-preview-gd057',
      },
    },
    summary: { totalExVat: 115.24, vatAmount: 23.05, totalIncVat: 138.29 },
  }, {
    'left-chest': {
      url: 'https://api.example.com/uploads/logo.png',
      contentId: 'quote-logo-left-chest',
    },
  });

  assert.match(html, /src="cid:quote-preview-gd057"/);
  assert.match(html, /src="cid:quote-logo-left-chest"/);
  assert.doesNotMatch(html, /src="https:\/\/cdn\.example\.com\/fallback\.jpg"/);
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

test('adjusted customer quote uses the admin basket design and preserves discounts', () => {
  const html = generateAdjustedQuoteEmailHTML({
    customer: {
      name: 'Alex Buyer',
      email: 'alex@example.com',
      phone: '0208 974 2722',
    },
    products: [{
      name: 'The AWDIS 180 T',
      code: 'AT002',
      colour: 'Royal Blue',
      image: 'https://cdn.example.com/at002.png',
      sizes: { M: 10 },
      quantity: 10,
      unitPrice: 6.02,
      originalLineTotal: 60.20,
      adjustedLineTotal: 56.00,
    }],
    customizations: [{
      method: 'Print',
      position: 'Left Chest',
      quantity: 10,
      unitPrice: 5.25,
      originalLineTotal: 52.50,
      adjustedLineTotal: 49.50,
    }],
    logos: {
      'left-chest': { url: 'https://cdn.example.com/logo.png' },
    },
    totals: {
      originalSubtotal: 112.70,
      adjustedSubtotal: 105.50,
      vatRate: 0.2,
      vatAmount: 21.10,
      originalTotalIncVat: 135.24,
      totalIncVat: 126.60,
      discountAmount: 8.64,
      discountPercent: 6.39,
    },
  }, {
    id: 42,
    quote_id: 'quote_abc123',
    created_at: '2026-10-21T13:42:00.000Z',
  });

  assert.match(html, /Your BrandedUK quote/);
  assert.match(html, /QUOTE READY/);
  assert.match(html, /Basket items/);
  assert.match(html, /The AWDIS 180 T/);
  assert.match(html, /Left Chest/);
  assert.match(html, /src="https:\/\/cdn\.example\.com\/logo\.png"/);
  assert.match(html, /&pound;60\.20/);
  assert.match(html, /&pound;56\.00/);
  assert.match(html, /text-decoration:line-through/);
  assert.match(html, /6\.39%/);
  assert.match(html, /&pound;135\.24/);
  assert.match(html, /&pound;126\.60/);
  assert.match(html, /Contact BrandedUK/);
  assert.doesNotMatch(html, /Reply to customer/);
});

test('adjusted quote keeps each decoration with its selected garment', () => {
  const html = generateAdjustedQuoteEmailHTML({
    customer: { name: 'Multi Item', email: 'multi@example.com' },
    products: [
      { name: 'Garment Alpha', code: 'ALPHA', quantity: 3, unitPrice: 10, originalLineTotal: 30, adjustedLineTotal: 27 },
      { name: 'Garment Beta', code: 'BETA', quantity: 3, unitPrice: 20, originalLineTotal: 60, adjustedLineTotal: 51 },
    ],
    customizations: [
      { itemIndex: 1, productCode: 'BETA', method: 'Print', position: 'Large Back', quantity: 3, originalLineTotal: 24, adjustedLineTotal: 21 },
      { itemIndex: 0, productCode: 'ALPHA', method: 'Embroidery', position: 'Left Chest', quantity: 3, originalLineTotal: 18, adjustedLineTotal: 15 },
    ],
    totals: { adjustedSubtotal: 114, vatAmount: 22.8, totalIncVat: 136.8, originalTotalIncVat: 158.4, discountAmount: 18, discountPercent: 13.64 },
  }, { quote_id: 'quote_multi' });

  const alpha = html.indexOf('Garment Alpha');
  const chest = html.indexOf('Left Chest');
  const beta = html.indexOf('Garment Beta');
  const back = html.indexOf('Large Back');
  assert.ok(alpha >= 0 && alpha < chest && chest < beta && beta < back);
  assert.match(html, /&pound;30\.00/);
  assert.match(html, /&pound;27\.00/);
  assert.match(html, /&pound;60\.00/);
  assert.match(html, /&pound;51\.00/);
});
