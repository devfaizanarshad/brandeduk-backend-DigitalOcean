-- Create quote_requests table to store customer submissions
CREATE TABLE IF NOT EXISTS "quote_requests" (
  "id" SERIAL PRIMARY KEY,
  "quote_id" VARCHAR(100) UNIQUE NOT NULL,
  "customer_name" VARCHAR(200) NOT NULL,
  "customer_email" VARCHAR(200) NOT NULL,
  "customer_phone" VARCHAR(50),
  "customer_company" VARCHAR(200),
  "customer_address" TEXT,
  "total_amount" NUMERIC(15, 2),
  "quote_data" JSONB NOT NULL,
  "status" VARCHAR(50) DEFAULT 'Pending',
  "created_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add index for faster searching
CREATE INDEX IF NOT EXISTS "idx_quote_requests_customer_email" ON "quote_requests" ("customer_email");
CREATE INDEX IF NOT EXISTS "idx_quote_requests_status" ON "quote_requests" ("status");
CREATE INDEX IF NOT EXISTS "idx_quote_requests_created_at" ON "quote_requests" ("created_at" DESC);
