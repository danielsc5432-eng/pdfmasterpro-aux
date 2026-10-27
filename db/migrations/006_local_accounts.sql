CREATE TABLE IF NOT EXISTS local_accounts (
  email VARCHAR(254) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL UNIQUE,
  display_name VARCHAR(80) NOT NULL,
  password_hash TEXT NOT NULL,
  verification_hash CHAR(64),
  verification_expires TIMESTAMPTZ,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS local_auth_limits (
  actor_hash CHAR(64) NOT NULL,
  hour TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (actor_hash, hour)
);
