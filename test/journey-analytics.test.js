const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../services/journeyAnalyticsService');

test('normalizes analytics payload without accepting personal fields', () => {
  const event = _test.normalizeEventPayload({
    visitorId: 'visitor_12345678',
    sessionId: 'session_12345678',
    eventType: 'basket_updated',
    path: '/basket?email=private@example.com',
    email: 'private@example.com',
    basket: {
      items: [{ code: 'GD001', name: 'T-shirt', quantity: 2, unitPrice: 5.5, email: 'private@example.com' }],
    },
    metadata: { device: 'mobile', email: 'private@example.com' },
  });

  assert.equal(event.path, '/basket');
  assert.equal(event.basket.totalQuantity, 2);
  assert.equal(event.basket.value, 11);
  assert.deepEqual(Object.keys(event.metadata), ['source', 'device', 'resultCount', 'orderNumber']);
  assert.equal(JSON.stringify(event).includes('private@example.com'), false);
});

test('rejects unknown event types and invalid identifiers', () => {
  assert.throws(() => _test.normalizeEventPayload({
    visitorId: 'short',
    sessionId: 'session_12345678',
    eventType: 'basket_updated',
  }), /visitorId/);

  assert.throws(() => _test.normalizeEventPayload({
    visitorId: 'visitor_12345678',
    sessionId: 'session_12345678',
    eventType: 'email_captured',
  }), /Unsupported/);
});

test('redacts personal details accidentally entered as searches', () => {
  const base = {
    visitorId: 'visitor_12345678',
    sessionId: 'session_12345678',
    eventType: 'search',
  };
  assert.equal(_test.normalizeEventPayload({ ...base, searchQuery: 'person@example.com' }).searchQuery, '');
  assert.equal(_test.normalizeEventPayload({ ...base, searchQuery: '0208 974 2722' }).searchQuery, '');
  assert.equal(_test.normalizeEventPayload({ ...base, searchQuery: 'navy polo shirt' }).searchQuery, 'navy polo shirt');
});

test('uses expected journey statuses', () => {
  assert.equal(_test.statusForEvent({ eventType: 'page_view', basket: { itemCount: 0 } }), 'browsing');
  assert.equal(_test.statusForEvent({ eventType: 'basket_updated', basket: { itemCount: 2 } }), 'active');
  assert.equal(_test.statusForEvent({ eventType: 'basket_updated', basket: { itemCount: 0 } }), 'cleared');
  assert.equal(_test.statusForEvent({ eventType: 'checkout_started', basket: { itemCount: 2 } }), 'checkout_started');
  assert.equal(_test.statusForEvent({ eventType: 'order_completed', basket: { itemCount: 2 } }), 'converted');
});

test('caps report ranges and pagination', () => {
  assert.deepEqual(_test.reportOptions({ days: 999, abandonedAfterMinutes: 1, page: -4, limit: 999 }), {
    days: 365,
    abandonedAfterMinutes: 5,
    page: 1,
    limit: 100,
    offset: 0,
  });
});
