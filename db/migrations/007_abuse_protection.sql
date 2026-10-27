CREATE TABLE IF NOT EXISTS abuse_budgets (
  actor_hash CHAR(64) PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS abuse_budgets_expiry_idx ON abuse_budgets (window_start);
CREATE TABLE IF NOT EXISTS account_email_identities (
  normalized_email VARCHAR(320) PRIMARY KEY,
  open_id VARCHAR(191) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO account_email_identities (normalized_email, open_id)
SELECT DISTINCT ON (normalized_email) normalized_email, open_id FROM (
  SELECT CASE WHEN split_part(lower(email), '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(split_part(lower(email), '@', 1), '+', 1), '.', '') || '@gmail.com'
    ELSE lower(email) END AS normalized_email, open_id, created_at FROM users
) identities ORDER BY normalized_email, created_at, open_id
ON CONFLICT (normalized_email) DO NOTHING;
