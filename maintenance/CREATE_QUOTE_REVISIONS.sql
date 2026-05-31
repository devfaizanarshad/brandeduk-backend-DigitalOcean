CREATE TABLE IF NOT EXISTS quote_revisions (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL,
  snapshot_json JSONB NOT NULL,
  original_total NUMERIC(10,2),
  adjusted_total NUMERIC(10,2),
  discount_amount NUMERIC(10,2),
  discount_percent NUMERIC(5,2),
  sent_to_email TEXT NOT NULL,
  email_status TEXT DEFAULT 'sent',
  email_html TEXT,
  sent_at TIMESTAMP,
  sent_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quote_revisions_quote_id
  ON quote_revisions (quote_id, created_at DESC);
