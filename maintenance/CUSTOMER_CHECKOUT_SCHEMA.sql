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
);

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_user_id ON customer_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_user_id ON customer_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_guest_email ON customer_orders(guest_email);
CREATE INDEX IF NOT EXISTS idx_customer_orders_order_number ON customer_orders(order_number);
