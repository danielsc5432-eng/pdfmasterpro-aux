CREATE TABLE IF NOT EXISTS user_preferences (
  open_id VARCHAR(191) PRIMARY KEY REFERENCES users(open_id) ON DELETE CASCADE,
  display_name VARCHAR(80) NOT NULL,
  preferred_tool VARCHAR(80) NOT NULL DEFAULT 'detector-divergencias',
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
