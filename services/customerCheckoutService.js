const crypto = require('crypto');
const https = require('https');
const { queryWithTimeout } = require('../config/database');
const { hashPassword, verifyPassword } = require('../utils/auth');

let customerTablesReady = false;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    googleId: row.google_id,
    avatar: row.avatar,
    provider: row.provider,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicAddress(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    userId: row.user_id,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    items: row.items,
    deliveryAddress: row.delivery_address,
    subtotal: Number(row.subtotal || 0),
    deliveryFee: Number(row.delivery_fee || 0),
    discount: Number(row.discount || 0),
    totalAmount: Number(row.total_amount || 0),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    orderStatus: row.order_status,
    transactionId: row.transaction_id,
    paymentIntentId: row.payment_intent_id,
    stripeSessionId: row.stripe_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureCustomerTables() {
  if (customerTablesReady) return;

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS customer_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      avatar TEXT,
      provider VARCHAR(20) NOT NULL DEFAULT 'email',
      role VARCHAR(30) NOT NULL DEFAULT 'customer',
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `, [], 10000);

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address_line1 TEXT NOT NULL,
      address_line2 TEXT,
      city TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `, [], 10000);

  await queryWithTimeout(`
    CREATE TABLE IF NOT EXISTS customer_orders (
      id SERIAL PRIMARY KEY,
      order_number VARCHAR(80) UNIQUE NOT NULL,
      user_id INTEGER REFERENCES customer_users(id) ON DELETE SET NULL,
      guest_email TEXT,
      guest_phone TEXT,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      delivery_address JSONB NOT NULL DEFAULT '{}'::jsonb,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(40) NOT NULL DEFAULT 'stripe',
      payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      order_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      transaction_id TEXT,
      payment_intent_id TEXT,
      stripe_session_id TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `, [], 10000);

  await queryWithTimeout('CREATE INDEX IF NOT EXISTS idx_customer_addresses_user_id ON customer_addresses(user_id)', [], 10000);
  await queryWithTimeout('CREATE INDEX IF NOT EXISTS idx_customer_orders_user_id ON customer_orders(user_id)', [], 10000);
  await queryWithTimeout('CREATE INDEX IF NOT EXISTS idx_customer_orders_guest_email ON customer_orders(guest_email)', [], 10000);
  await queryWithTimeout('CREATE INDEX IF NOT EXISTS idx_customer_orders_order_number ON customer_orders(order_number)', [], 10000);

  customerTablesReady = true;
}

async function findUserByEmail(email) {
  await ensureCustomerTables();
  const result = await queryWithTimeout('SELECT * FROM customer_users WHERE email = $1 LIMIT 1', [normalizeEmail(email)], 10000);
  return result.rows[0] || null;
}

async function findUserById(id) {
  await ensureCustomerTables();
  const result = await queryWithTimeout('SELECT * FROM customer_users WHERE id = $1 LIMIT 1', [id], 10000);
  return result.rows[0] || null;
}

async function registerUser({ name, email, password }) {
  await ensureCustomerTables();

  const normalizedEmail = normalizeEmail(email);
  if (!name || !normalizedEmail || !password) {
    const error = new Error('name, email, and password are required');
    error.status = 400;
    throw error;
  }

  const result = await queryWithTimeout(`
    INSERT INTO customer_users (name, email, password_hash, provider, role)
    VALUES ($1, $2, $3, 'email', 'customer')
    RETURNING *
  `, [name.trim(), normalizedEmail, hashPassword(password)], 10000);

  return publicUser(result.rows[0]);
}

async function loginUser({ email, password }) {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  return publicUser(user);
}

async function upsertGoogleUser(profile) {
  await ensureCustomerTables();

  const email = normalizeEmail(profile.email);
  if (!email) {
    const error = new Error('Google account email is required');
    error.status = 400;
    throw error;
  }

  const existing = await queryWithTimeout(`
    SELECT * FROM customer_users
    WHERE email = $1 OR google_id = $2
    LIMIT 1
  `, [email, profile.googleId], 10000);

  if (existing.rows[0]) {
    const updated = await queryWithTimeout(`
      UPDATE customer_users
      SET
        name = COALESCE(NULLIF($2, ''), name),
        google_id = COALESCE(google_id, $3),
        avatar = COALESCE(NULLIF($4, ''), avatar),
        provider = CASE WHEN provider = 'email' THEN provider ELSE 'google' END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [existing.rows[0].id, profile.name || '', profile.googleId || null, profile.avatar || ''], 10000);
    return publicUser(updated.rows[0]);
  }

  const created = await queryWithTimeout(`
    INSERT INTO customer_users (name, email, google_id, avatar, provider, role)
    VALUES ($1, $2, $3, $4, 'google', 'customer')
    RETURNING *
  `, [
    normalizeString(profile.name, email),
    email,
    profile.googleId || null,
    profile.avatar || null,
  ], 10000);

  return publicUser(created.rows[0]);
}

function validateAddressPayload(body = {}) {
  const address = {
    fullName: normalizeString(body.fullName || body.full_name),
    phone: normalizeString(body.phone),
    addressLine1: normalizeString(body.addressLine1 || body.address_line1),
    addressLine2: normalizeString(body.addressLine2 || body.address_line2),
    city: normalizeString(body.city),
    postalCode: normalizeString(body.postalCode || body.postal_code || body.postcode),
    country: normalizeString(body.country),
    isDefault: body.isDefault === true || body.is_default === true,
  };

  if (!address.fullName || !address.phone || !address.addressLine1 || !address.city || !address.postalCode || !address.country) {
    const error = new Error('fullName, phone, addressLine1, city, postalCode, and country are required');
    error.status = 400;
    throw error;
  }

  return address;
}

async function listAddresses(userId) {
  await ensureCustomerTables();
  const result = await queryWithTimeout(`
    SELECT * FROM customer_addresses
    WHERE user_id = $1
    ORDER BY is_default DESC, created_at DESC
  `, [userId], 10000);
  return result.rows.map(publicAddress);
}

async function createAddress(userId, body) {
  await ensureCustomerTables();
  const address = validateAddressPayload(body);

  if (address.isDefault) {
    await queryWithTimeout('UPDATE customer_addresses SET is_default = FALSE WHERE user_id = $1', [userId], 10000);
  }

  const result = await queryWithTimeout(`
    INSERT INTO customer_addresses (
      user_id, full_name, phone, address_line1, address_line2, city, postal_code, country, is_default
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    userId,
    address.fullName,
    address.phone,
    address.addressLine1,
    address.addressLine2 || null,
    address.city,
    address.postalCode,
    address.country,
    address.isDefault,
  ], 10000);

  return publicAddress(result.rows[0]);
}

async function updateAddress(userId, addressId, body) {
  await ensureCustomerTables();
  const address = validateAddressPayload(body);

  if (address.isDefault) {
    await queryWithTimeout('UPDATE customer_addresses SET is_default = FALSE WHERE user_id = $1', [userId], 10000);
  }

  const result = await queryWithTimeout(`
    UPDATE customer_addresses
    SET
      full_name = $3,
      phone = $4,
      address_line1 = $5,
      address_line2 = $6,
      city = $7,
      postal_code = $8,
      country = $9,
      is_default = $10,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND id = $2
    RETURNING *
  `, [
    userId,
    addressId,
    address.fullName,
    address.phone,
    address.addressLine1,
    address.addressLine2 || null,
    address.city,
    address.postalCode,
    address.country,
    address.isDefault,
  ], 10000);

  if (!result.rows[0]) {
    const error = new Error('Address not found');
    error.status = 404;
    throw error;
  }

  return publicAddress(result.rows[0]);
}

async function deleteAddress(userId, addressId) {
  await ensureCustomerTables();
  const result = await queryWithTimeout(`
    DELETE FROM customer_addresses
    WHERE user_id = $1 AND id = $2
    RETURNING id
  `, [userId, addressId], 10000);

  if (!result.rows[0]) {
    const error = new Error('Address not found');
    error.status = 404;
    throw error;
  }
}

async function setDefaultAddress(userId, addressId) {
  await ensureCustomerTables();
  const exists = await queryWithTimeout('SELECT id FROM customer_addresses WHERE user_id = $1 AND id = $2', [userId, addressId], 10000);
  if (!exists.rows[0]) {
    const error = new Error('Address not found');
    error.status = 404;
    throw error;
  }

  await queryWithTimeout('UPDATE customer_addresses SET is_default = FALSE WHERE user_id = $1', [userId], 10000);
  const result = await queryWithTimeout(`
    UPDATE customer_addresses
    SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND id = $2
    RETURNING *
  `, [userId, addressId], 10000);
  return publicAddress(result.rows[0]);
}

async function updateProfile(userId, body = {}) {
  await ensureCustomerTables();
  const name = normalizeString(body.name || body.fullName);
  const avatar = normalizeString(body.avatar);

  const result = await queryWithTimeout(`
    UPDATE customer_users
    SET
      name = COALESCE(NULLIF($2, ''), name),
      avatar = COALESCE(NULLIF($3, ''), avatar),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [userId, name, avatar], 10000);

  return publicUser(result.rows[0]);
}

function createOrderNumber() {
  return `BUK-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function getAddressSnapshot(userId, addressId) {
  const result = await queryWithTimeout(`
    SELECT * FROM customer_addresses
    WHERE user_id = $1 AND id = $2
    LIMIT 1
  `, [userId, addressId], 10000);

  const address = publicAddress(result.rows[0]);
  if (!address) {
    const error = new Error('Address not found');
    error.status = 404;
    throw error;
  }

  return {
    fullName: address.fullName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
  };
}

async function resolveDeliveryAddress(userId, body = {}) {
  if (userId && body.addressId) {
    return getAddressSnapshot(userId, body.addressId);
  }

  return validateAddressPayload(body.deliveryAddress || body.address || {});
}

async function createOrder(body = {}, user = null) {
  await ensureCustomerTables();

  const items = Array.isArray(body.items) ? body.items : Array.isArray(body.cart) ? body.cart : [];
  if (!items.length) {
    const error = new Error('Order items are required');
    error.status = 400;
    throw error;
  }

  const userId = user?.id || null;
  const guestEmail = userId ? null : normalizeEmail(body.guestEmail || body.email);
  const guestPhone = userId ? null : normalizeString(body.guestPhone || body.phone);

  if (!userId && (!guestEmail || !guestPhone)) {
    const error = new Error('guestEmail and guestPhone are required for guest checkout');
    error.status = 400;
    throw error;
  }

  const deliveryAddress = await resolveDeliveryAddress(userId, body);
  const subtotal = normalizeNumber(body.subtotal);
  const deliveryFee = normalizeNumber(body.deliveryFee);
  const discount = normalizeNumber(body.discount);
  const totalAmount = normalizeNumber(body.totalAmount, subtotal + deliveryFee - discount);

  if (totalAmount <= 0) {
    const error = new Error('totalAmount must be greater than 0');
    error.status = 400;
    throw error;
  }

  const result = await queryWithTimeout(`
    INSERT INTO customer_orders (
      order_number, user_id, guest_email, guest_phone, items, delivery_address,
      subtotal, delivery_fee, discount, total_amount, payment_method, payment_status, order_status
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, 'pending', 'pending')
    RETURNING *
  `, [
    createOrderNumber(),
    userId,
    guestEmail,
    guestPhone,
    JSON.stringify(items),
    JSON.stringify(deliveryAddress),
    subtotal,
    deliveryFee,
    discount,
    totalAmount,
    normalizeString(body.paymentMethod, 'stripe') || 'stripe',
  ], 10000);

  return publicOrder(result.rows[0]);
}

async function listOrdersForUser(userId) {
  await ensureCustomerTables();
  const result = await queryWithTimeout(`
    SELECT * FROM customer_orders
    WHERE user_id = $1
    ORDER BY created_at DESC
  `, [userId], 10000);
  return result.rows.map(publicOrder);
}

async function findOrder(identifier) {
  await ensureCustomerTables();
  const isNumericId = /^\d+$/.test(String(identifier || ''));
  const result = await queryWithTimeout(`
    SELECT * FROM customer_orders
    WHERE ${isNumericId ? 'id = $1' : 'order_number = $1'}
    LIMIT 1
  `, [identifier], 10000);
  return result.rows[0] || null;
}

function assertOrderAccess(order, user, guest = {}) {
  if (!order) {
    const error = new Error('Order not found');
    error.status = 404;
    throw error;
  }

  if (user?.id && order.user_id === user.id) return;

  const guestEmail = normalizeEmail(guest.email || guest.guestEmail);
  const guestPhone = normalizeString(guest.phone || guest.guestPhone);
  if (order.guest_email && guestEmail && order.guest_email === guestEmail) return;
  if (order.guest_phone && guestPhone && order.guest_phone === guestPhone) return;

  const error = new Error('Order access denied');
  error.status = 403;
  throw error;
}

async function getOrderForViewer(identifier, user = null, guest = {}) {
  const order = await findOrder(identifier);
  assertOrderAccess(order, user, guest);
  return publicOrder(order);
}

async function trackGuestOrder({ orderId, orderNumber, email, phone }) {
  const identifier = orderId || orderNumber;
  if (!identifier || (!email && !phone)) {
    const error = new Error('orderId/orderNumber and email or phone are required');
    error.status = 400;
    throw error;
  }

  return getOrderForViewer(identifier, null, { email, phone });
}

function getStripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_PRIVATE_KEY;
  if (!key) {
    const error = new Error('Stripe secret key is not configured');
    error.status = 500;
    throw error;
  }
  return key;
}

function parseJsonResponse(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function sendStripeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || '';
    const request = https.request({
      hostname: 'api.stripe.com',
      path: `/v1${path}`,
      method: options.method || 'POST',
      headers: {
        Authorization: `Bearer ${getStripeSecretKey()}`,
        ...(body ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        const data = parseJsonResponse(responseBody);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(data?.error?.message || 'Stripe request failed');
          error.status = response.statusCode >= 500 ? 502 : response.statusCode;
          error.stripeError = data.error || data;
          reject(error);
          return;
        }
        resolve(data);
      });
    });

    request.on('error', (error) => {
      const wrapped = new Error(`Stripe network request failed: ${error.message}`);
      wrapped.status = 502;
      reject(wrapped);
    });

    if (body) request.write(body);
    request.end();
  });
}

async function stripeRequest(path, params, options = {}) {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    body.append(key, String(value));
  }

  return sendStripeRequest(path, {
    method: options.method || 'POST',
    body: body.toString(),
    idempotencyKey: options.idempotencyKey,
  });
}

function checkoutUrls(order) {
  const successUrl = process.env.STRIPE_ORDER_CHECKOUT_SUCCESS_URL
    || process.env.STRIPE_CHECKOUT_SUCCESS_URL
    || process.env.CHECKOUT_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_ORDER_CHECKOUT_CANCEL_URL
    || process.env.STRIPE_CHECKOUT_CANCEL_URL
    || process.env.CHECKOUT_CANCEL_URL;

  if (!successUrl || !cancelUrl) {
    const error = new Error('Stripe Checkout success/cancel URLs are not configured');
    error.status = 500;
    throw error;
  }

  return {
    successUrl: successUrl.replace('{ORDER_ID}', order.orderNumber).replace('{CHECKOUT_SESSION_ID}', '{CHECKOUT_SESSION_ID}'),
    cancelUrl: cancelUrl.replace('{ORDER_ID}', order.orderNumber).replace('{CHECKOUT_SESSION_ID}', '{CHECKOUT_SESSION_ID}'),
  };
}

async function createOrderPaymentSession({ orderId, orderNumber, email, phone }, user = null, idempotencyKey = null) {
  const order = await findOrder(orderId || orderNumber);
  assertOrderAccess(order, user, { email, phone });

  if (order.payment_status === 'paid') {
    const error = new Error('Order is already paid');
    error.status = 400;
    throw error;
  }

  const publicOrderData = publicOrder(order);
  const { successUrl, cancelUrl } = checkoutUrls(publicOrderData);
  const amount = Math.round(Number(order.total_amount || 0) * 100);
  const customerEmail = order.user_id
    ? (await findUserById(order.user_id))?.email
    : order.guest_email;

  const session = await stripeRequest('/checkout/sessions', {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail,
    'payment_method_types[0]': 'card',
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': (process.env.STRIPE_CURRENCY || 'gbp').toLowerCase(),
    'line_items[0][price_data][unit_amount]': amount,
    'line_items[0][price_data][product_data][name]': `Branded UK Order ${order.order_number}`,
    'payment_intent_data[metadata][order_id]': order.id,
    'payment_intent_data[metadata][order_number]': order.order_number,
    'payment_intent_data[metadata][source]': 'brandeduk_ecommerce_order',
  }, {
    idempotencyKey: idempotencyKey || order.order_number,
  });

  const updated = await queryWithTimeout(`
    UPDATE customer_orders
    SET
      stripe_session_id = $2,
      payment_intent_id = COALESCE($3, payment_intent_id),
      payment_method = 'stripe',
      payment_status = 'pending',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [order.id, session.id, session.payment_intent || null], 10000);

  return {
    order: publicOrder(updated.rows[0]),
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
  };
}

async function createOrderPaymentIntent({ orderId, orderNumber, email, phone }, user = null, idempotencyKey = null) {
  const order = await findOrder(orderId || orderNumber);
  assertOrderAccess(order, user, { email, phone });

  if (order.payment_status === 'paid') {
    const error = new Error('Order is already paid');
    error.status = 400;
    throw error;
  }

  const amount = Math.round(Number(order.total_amount || 0) * 100);
  const customerEmail = order.user_id
    ? (await findUserById(order.user_id))?.email
    : order.guest_email;

  const paymentIntent = await stripeRequest('/payment_intents', {
    amount,
    currency: (process.env.STRIPE_CURRENCY || 'gbp').toLowerCase(),
    receipt_email: customerEmail,
    description: `Branded UK order ${order.order_number}`,
    'payment_method_types[0]': 'card',
    'metadata[order_id]': order.id,
    'metadata[order_number]': order.order_number,
    'metadata[source]': 'brandeduk_ecommerce_order',
  }, {
    idempotencyKey: idempotencyKey || order.order_number,
  });

  const updated = await queryWithTimeout(`
    UPDATE customer_orders
    SET
      payment_intent_id = $2,
      transaction_id = $2,
      payment_method = 'stripe',
      payment_status = 'pending',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [order.id, paymentIntent.id], 10000);

  return {
    order: publicOrder(updated.rows[0]),
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status: paymentIntent.status,
  };
}

async function updateOrderPaymentFromStripe(event) {
  await ensureCustomerTables();

  const object = event?.data?.object;
  if (!object) return;

  if (event.type === 'checkout.session.completed') {
    await queryWithTimeout(`
      UPDATE customer_orders
      SET
        payment_status = 'paid',
        order_status = 'confirmed',
        stripe_session_id = $1,
        payment_intent_id = COALESCE($2, payment_intent_id),
        transaction_id = COALESCE($2, transaction_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE stripe_session_id = $1
    `, [object.id, object.payment_intent || null], 10000);
    return;
  }

  if (object.object !== 'payment_intent') return;

  const orderId = object.metadata?.order_id;
  const orderNumber = object.metadata?.order_number;
  if (!orderId && !orderNumber) return;

  const paymentStatus = object.status === 'succeeded'
    ? 'paid'
    : ['payment_failed', 'canceled', 'requires_payment_method'].includes(object.status)
      ? 'failed'
      : 'pending';
  const orderStatus = paymentStatus === 'paid' ? 'confirmed' : paymentStatus === 'failed' ? 'failed' : 'pending';

  await queryWithTimeout(`
    UPDATE customer_orders
    SET
      payment_status = $1,
      order_status = $2,
      payment_intent_id = $3,
      transaction_id = $3,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $4::integer OR order_number = $5
  `, [paymentStatus, orderStatus, object.id, orderId || 0, orderNumber || ''], 10000);
}

module.exports = {
  createAddress,
  createOrder,
  createOrderPaymentIntent,
  createOrderPaymentSession,
  deleteAddress,
  ensureCustomerTables,
  findUserByEmail,
  getOrderForViewer,
  listAddresses,
  listOrdersForUser,
  loginUser,
  publicUser,
  registerUser,
  setDefaultAddress,
  trackGuestOrder,
  updateAddress,
  updateOrderPaymentFromStripe,
  updateProfile,
  upsertGoogleUser,
};
