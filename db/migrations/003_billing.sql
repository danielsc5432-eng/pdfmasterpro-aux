-- Assinaturas (planos mensal/anual) e log de eventos de cobrança.
-- Provider inicial: mercadopago (preapproval / assinatura recorrente).

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY,
  open_id VARCHAR(191) NOT NULL,
  provider VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  plan_id VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'paused', 'cancelled', 'expired', 'rejected')),
  provider_subscription_id VARCHAR(191) NULL,
  provider_payer_email VARCHAR(320) NULL,
  amount_cents INTEGER NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  frequency INTEGER NOT NULL,
  frequency_type VARCHAR(10) NOT NULL DEFAULT 'months',
  external_reference VARCHAR(191) NULL,
  started_at TIMESTAMPTZ(3) NULL,
  current_period_end TIMESTAMPTZ(3) NULL,
  cancelled_at TIMESTAMPTZ(3) NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS subscriptions_open_id_idx ON subscriptions (open_id, status);
CREATE INDEX IF NOT EXISTS subscriptions_provider_idx ON subscriptions (provider, provider_subscription_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY,
  provider VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  topic VARCHAR(60) NULL,
  status VARCHAR(40) NULL,
  provider_resource_id VARCHAR(191) NULL,
  payload JSONB NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS billing_events_created_idx ON billing_events (created_at);
CREATE INDEX IF NOT EXISTS billing_events_resource_idx ON billing_events (provider, provider_resource_id);
