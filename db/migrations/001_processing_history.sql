-- Histórico de tarefas processadas (metadados apenas, sem conteúdo).
-- Postgres: identificadores e timestamps com fuso explícito.

CREATE TABLE IF NOT EXISTS processing_tasks (
  id UUID PRIMARY KEY,
  session_hash CHAR(64) NOT NULL,
  tool_slug VARCHAR(80) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  file_count INTEGER NOT NULL,
  input_bytes BIGINT NOT NULL,
  output_bytes BIGINT NULL,
  output_type VARCHAR(100) NULL,
  error_code VARCHAR(80) NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3) NULL,
  expires_at TIMESTAMPTZ(3) NULL
);

CREATE INDEX IF NOT EXISTS idx_processing_tasks_session_created ON processing_tasks (session_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_processing_tasks_expires ON processing_tasks (expires_at);
