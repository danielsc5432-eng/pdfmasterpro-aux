-- Usuários autenticados (Google OAuth).

CREATE TABLE IF NOT EXISTS users (
  open_id VARCHAR(191) PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);
CREATE INDEX IF NOT EXISTS users_last_login_idx ON users (last_login_at);
