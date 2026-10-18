const { queryWithTimeout } = require('../config/database');

const EVENT_TYPES = new Set([
  'page_view',
  'product_view',
  'search',
  'basket_updated',
  'checkout_started',
  'order_completed',
]);

const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const DEFAULT_ABANDONED_AFTER_MINUTES = 30;
const DEFAULT_REPORT_DAYS = 30;
const MAX_BASKET_LINES = 100;
let tablesReady = false;

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanString(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanNumber(value, fallback = 0, max = 10000000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function cleanInteger(value, fallback = 0, max = 1000000) {
  return Math.round(cleanNumber(value, fallback, max));
}

function normalizePath(value) {
  const path = cleanString(value, 500).split(/[?#]/)[0];
  return path.startsWith('/') ? path : '';
}

function sanitizeSearchQuery(value) {
  const query = cleanString(value, 200);
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(query)) return '';
  if (query.replace(/\D/g, '').length >= 7) return '';
  return query;
}

function sanitizeBasketItem(item = {}) {
  const quantity = cleanInteger(item.quantity ?? item.qty, 0);
  const unitPrice = cleanNumber(item.unitPrice ?? item.price, 0);
  const lineTotal = cleanNumber(item.lineTotal, unitPrice * quantity);

  return {
    code: cleanString(item.code || item.productCode, 80),
    name: cleanString(item.name || item.productName, 200),
    brand: cleanString(item.brand, 120),
    color: cleanString(item.color || item.colorName || item.selectedColorName, 100),
    size: cleanString(item.size, 50),
    quantity,
    unitPrice,
    lineTotal,
  };
}

function sanitizeBasket(value) {
  const rawItems = Array.isArray(value?.items) ? value.items.slice(0, MAX_BASKET_LINES) : [];
  const items = rawItems
    .map(sanitizeBasketItem)
    .filter((item) => item.code || item.name);
  const calculatedQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const calculatedValue = items.reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    items,
    itemCount: items.length,
    totalQuantity: cleanInteger(value?.totalQuantity, calculatedQuantity) || calculatedQuantity,
    value: cleanNumber(value?.value, calculatedValue) || calculatedValue,
    currency: cleanString(value?.currency || 'GBP', 3).toUpperCase() || 'GBP',
  };
}

function sanitizeMetadata(value) {
  const metadata = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const device = cleanString(metadata.device, 20).toLowerCase();
  return {
    source: cleanString(metadata.source, 50),
    device: ['desktop', 'tablet', 'mobile'].includes(device) ? device : '',
    resultCount: cleanInteger(metadata.resultCount, 0),
    orderNumber: cleanString(metadata.orderNumber, 80),
  };
}

function normalizeEventPayload(body = {}) {
  const visitorId = cleanString(body.visitorId, 80);
  const sessionId = cleanString(body.sessionId, 80);
  const eventType = cleanString(body.eventType, 40).toLowerCase();

  if (!ID_PATTERN.test(visitorId)) throw httpError('A valid visitorId is required');
  if (!ID_PATTERN.test(sessionId)) throw httpError('A valid sessionId is required');
  if (!EVENT_TYPES.has(eventType)) throw httpError('Unsupported analytics event');

  const product = body.product && typeof body.product === 'object' ? body.product : {};
  return {
    visitorId,
    sessionId,
    eventType,
    path: normalizePath(body.path),
    searchQuery: eventType === 'search' ? sanitizeSearchQuery(body.searchQuery) : '',
    productCode: cleanString(product.code || body.productCode, 80),
    productName: cleanString(product.name || body.productName, 200),
    basket: sanitizeBasket(body.basket),
    metadata: sanitizeMetadata(body.metadata),
  };
}

function statusForEvent(event) {
  if (event.eventType === 'order_completed') return 'converted';
  if (event.eventType === 'checkout_started') return 'checkout_started';
  if (event.eventType === 'basket_updated') {
    return event.basket.itemCount > 0 ? 'active' : 'cleared';
  }
  return 'browsing';
}

async function ensureAnalyticsTables() {
  if (tablesReady) return;

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS commerce_journeys (
      session_id VARCHAR(80) PRIMARY KEY,
      visitor_id VARCHAR(80) NOT NULL,
      user_id INTEGER,
      status VARCHAR(30) NOT NULL DEFAULT 'browsing',
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      item_count INTEGER NOT NULL DEFAULT 0,
      total_quantity INTEGER NOT NULL DEFAULT 0,
      basket_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
      entry_path TEXT,
      last_path TEXT,
      last_event_type VARCHAR(40),
      device_type VARCHAR(20),
      checkout_started_at TIMESTAMPTZ,
      converted_at TIMESTAMPTZ,
      order_number VARCHAR(80),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, [], 10000);

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS commerce_journey_events (
      id BIGSERIAL PRIMARY KEY,
      session_id VARCHAR(80) NOT NULL REFERENCES commerce_journeys(session_id) ON DELETE CASCADE,
      visitor_id VARCHAR(80) NOT NULL,
      user_id INTEGER,
      event_type VARCHAR(40) NOT NULL,
      path TEXT,
      product_code VARCHAR(80),
      product_name TEXT,
      search_query TEXT,
      basket_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_quantity INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, [], 10000);

  await queryWithTimeout('CREATE INDEX IF NOT EXISTS idx_commerce_journeys_abandoned ON commerce_journeys(status, last_activity_at) WHERE item_count > 0', [], 10000);
  await queryWithTimeout('CREATE INDEX IF NOT EXISTS idx_commerce_journeys_visitor ON commerce_journeys(visitor_id)', [], 10000);
  await queryWithTimeout('CREATE INDEX IF NOT EXISTS idx_commerce_events_type_created ON commerce_journey_events(event_type, created_at DESC)', [], 10000);
  await queryWithTimeout('CREATE INDEX IF NOT EXISTS idx_commerce_events_product ON commerce_journey_events(product_code) WHERE product_code IS NOT NULL', [], 10000);

  tablesReady = true;
}

async function recordJourneyEvent(body, user = null) {
  const event = normalizeEventPayload(body);
  const incomingStatus = statusForEvent(event);
  const userId = user?.id || null;
  const hasBasketSnapshot = ['basket_updated', 'checkout_started'].includes(event.eventType)
    || (event.eventType === 'order_completed' && event.basket.itemCount > 0);

  await ensureAnalyticsTables();
  await queryWithTimeout(`
    INSERT INTO commerce_journeys (
      session_id, visitor_id, user_id, status, items, item_count, total_quantity,
      basket_value, currency, entry_path, last_path, last_event_type, device_type,
      checkout_started_at, converted_at, order_number
    ) VALUES (
      $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $10, $11, $12,
      CASE WHEN $11 = 'checkout_started' THEN CURRENT_TIMESTAMP END,
      CASE WHEN $11 = 'order_completed' THEN CURRENT_TIMESTAMP END,
      NULLIF($13, '')
    )
    ON CONFLICT (session_id) DO UPDATE SET
      visitor_id = EXCLUDED.visitor_id,
      user_id = COALESCE(EXCLUDED.user_id, commerce_journeys.user_id),
      status = CASE
        WHEN commerce_journeys.status = 'converted' THEN 'converted'
        WHEN EXCLUDED.status = 'browsing' THEN commerce_journeys.status
        ELSE EXCLUDED.status
      END,
      items = CASE WHEN $14 THEN EXCLUDED.items ELSE commerce_journeys.items END,
      item_count = CASE WHEN $14 THEN EXCLUDED.item_count ELSE commerce_journeys.item_count END,
      total_quantity = CASE WHEN $14 THEN EXCLUDED.total_quantity ELSE commerce_journeys.total_quantity END,
      basket_value = CASE WHEN $14 THEN EXCLUDED.basket_value ELSE commerce_journeys.basket_value END,
      currency = CASE WHEN $14 THEN EXCLUDED.currency ELSE commerce_journeys.currency END,
      last_path = EXCLUDED.last_path,
      last_event_type = EXCLUDED.last_event_type,
      device_type = COALESCE(NULLIF(EXCLUDED.device_type, ''), commerce_journeys.device_type),
      checkout_started_at = CASE
        WHEN $11 = 'checkout_started' THEN COALESCE(commerce_journeys.checkout_started_at, CURRENT_TIMESTAMP)
        ELSE commerce_journeys.checkout_started_at
      END,
      converted_at = CASE WHEN $11 = 'order_completed' THEN CURRENT_TIMESTAMP ELSE commerce_journeys.converted_at END,
      order_number = COALESCE(NULLIF(EXCLUDED.order_number, ''), commerce_journeys.order_number),
      last_activity_at = CURRENT_TIMESTAMP
  `, [
    event.sessionId,
    event.visitorId,
    userId,
    incomingStatus,
    JSON.stringify(event.basket.items),
    event.basket.itemCount,
    event.basket.totalQuantity,
    event.basket.value,
    event.basket.currency,
    event.path,
    event.eventType,
    event.metadata.device,
    event.metadata.orderNumber,
    hasBasketSnapshot,
  ], 10000);

  await queryWithTimeout(`
    INSERT INTO commerce_journey_events (
      session_id, visitor_id, user_id, event_type, path, product_code,
      product_name, search_query, basket_value, total_quantity, metadata
    ) VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), $9, $10, $11::jsonb)
  `, [
    event.sessionId,
    event.visitorId,
    userId,
    event.eventType,
    event.path,
    event.productCode,
    event.productName,
    event.searchQuery,
    event.basket.value,
    event.basket.totalQuantity,
    JSON.stringify(event.metadata),
  ], 10000);

  return { accepted: true };
}

function reportOptions(query = {}) {
  const days = Math.min(Math.max(parseInt(query.days, 10) || DEFAULT_REPORT_DAYS, 1), 365);
  const abandonedAfterMinutes = Math.min(
    Math.max(parseInt(query.abandonedAfterMinutes, 10) || DEFAULT_ABANDONED_AFTER_MINUTES, 5),
    10080
  );
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
  return { days, abandonedAfterMinutes, page, limit, offset: (page - 1) * limit };
}

async function getJourneyAnalytics(query = {}) {
  const options = reportOptions(query);
  await ensureAnalyticsTables();

  const params = [options.days, options.abandonedAfterMinutes];
  const abandonedFilter = `
    item_count > 0
    AND status <> 'converted'
    AND last_activity_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
    AND last_activity_at <= CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 minute')
  `;

  const [summaryResult, basketsResult, productResult, searchResult, funnelResult] = await Promise.all([
    queryWithTimeout(`
      SELECT
        COUNT(*) FILTER (WHERE ${abandonedFilter})::int AS abandoned_count,
        COALESCE(SUM(basket_value) FILTER (WHERE ${abandonedFilter}), 0) AS abandoned_value,
        COUNT(*) FILTER (
          WHERE status = 'checkout_started'
            AND last_activity_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
        )::int AS checkout_started_count,
        COUNT(*) FILTER (
          WHERE status = 'converted'
            AND converted_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
        )::int AS converted_count
      FROM commerce_journeys
    `, params, 10000),
    queryWithTimeout(`
      SELECT session_id, status, items, item_count, total_quantity, basket_value,
        currency, last_path, last_event_type, device_type,
        (user_id IS NOT NULL) AS is_registered,
        created_at, last_activity_at, checkout_started_at,
        COUNT(*) OVER()::int AS total_count
      FROM commerce_journeys
      WHERE ${abandonedFilter}
      ORDER BY last_activity_at DESC
      LIMIT $3 OFFSET $4
    `, [...params, options.limit, options.offset], 10000),
    queryWithTimeout(`
      SELECT
        COALESCE(NULLIF(item->>'code', ''), 'Unknown') AS code,
        COALESCE(NULLIF(item->>'name', ''), NULLIF(item->>'code', ''), 'Unknown product') AS name,
        COUNT(DISTINCT journey.session_id)::int AS baskets,
        COALESCE(SUM((item->>'quantity')::numeric), 0)::int AS quantity
      FROM commerce_journeys journey
      CROSS JOIN LATERAL jsonb_array_elements(journey.items) AS item
      WHERE ${abandonedFilter}
      GROUP BY 1, 2
      ORDER BY baskets DESC, quantity DESC
      LIMIT 10
    `, params, 10000),
    queryWithTimeout(`
      SELECT search_query AS query, COUNT(*)::int AS searches,
        COUNT(DISTINCT session_id)::int AS visitors
      FROM commerce_journey_events
      WHERE event_type = 'search'
        AND search_query IS NOT NULL
        AND created_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
      GROUP BY search_query
      ORDER BY searches DESC, visitors DESC
      LIMIT 10
    `, [options.days], 10000),
    queryWithTimeout(`
      SELECT
        COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'product_view')::int AS product_views,
        COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'basket_updated' AND total_quantity > 0)::int AS baskets_created,
        COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'checkout_started')::int AS checkouts_started,
        COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'order_completed')::int AS orders_completed
      FROM commerce_journey_events
      WHERE created_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
    `, [options.days], 10000),
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const funnelRow = funnelResult.rows[0] || {};
  const totalBaskets = basketsResult.rows[0]?.total_count || 0;
  return {
    filters: { days: options.days, abandonedAfterMinutes: options.abandonedAfterMinutes },
    summary: {
      abandonedCount: summaryRow.abandoned_count || 0,
      abandonedValue: Number(summaryRow.abandoned_value || 0),
      checkoutStartedCount: summaryRow.checkout_started_count || 0,
      convertedCount: summaryRow.converted_count || 0,
    },
    funnel: {
      productViews: funnelRow.product_views || 0,
      basketsCreated: funnelRow.baskets_created || 0,
      checkoutsStarted: funnelRow.checkouts_started || 0,
      ordersCompleted: funnelRow.orders_completed || 0,
    },
    topAbandonedProducts: productResult.rows,
    topSearches: searchResult.rows,
    baskets: basketsResult.rows.map(({ total_count, ...row }) => ({
      sessionId: row.session_id,
      status: row.status,
      items: row.items,
      itemCount: row.item_count,
      totalQuantity: row.total_quantity,
      basketValue: Number(row.basket_value || 0),
      currency: row.currency,
      lastPath: row.last_path,
      lastEventType: row.last_event_type,
      deviceType: row.device_type,
      visitorType: row.is_registered ? 'registered' : 'anonymous',
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      checkoutStartedAt: row.checkout_started_at,
    })),
    pagination: {
      page: options.page,
      limit: options.limit,
      total: totalBaskets,
      totalPages: Math.max(1, Math.ceil(totalBaskets / options.limit)),
    },
  };
}

module.exports = {
  getJourneyAnalytics,
  recordJourneyEvent,
  _test: {
    normalizeEventPayload,
    reportOptions,
    sanitizeBasket,
    statusForEvent,
  },
};
