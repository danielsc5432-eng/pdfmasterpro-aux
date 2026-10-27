CREATE TABLE IF NOT EXISTS support_daily_limits (
  actor_hash CHAR(64) NOT NULL,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  attempts INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (actor_hash, day)
);
