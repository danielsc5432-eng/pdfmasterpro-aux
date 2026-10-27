import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";

export type SubscriptionStatus = "pending" | "authorized" | "paused" | "cancelled" | "expired" | "rejected";

export type Subscription = {
  id: string;
  openId: string;
  provider: string;
  planId: string;
  status: SubscriptionStatus;
  providerSubscriptionId: string | null;
  payerEmail: string | null;
  amountCents: number;
  currency: string;
  frequency: number;
  frequencyType: string;
  startedAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
};

type SubscriptionRow = {
  id: string; open_id: string; provider: string; plan_id: string; status: SubscriptionStatus;
  provider_subscription_id: string | null; provider_payer_email: string | null; amount_cents: number | string;
  currency: string; frequency: number | string; frequency_type: string; started_at: Date | null;
  current_period_end: Date | null; cancelled_at: Date | null; created_at: Date;
};

const COLUMNS = "id, open_id, provider, plan_id, status, provider_subscription_id, provider_payer_email, amount_cents, currency, frequency, frequency_type, started_at, current_period_end, cancelled_at, created_at";

function mapSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    openId: row.open_id,
    provider: row.provider,
    planId: row.plan_id,
    status: row.status,
    providerSubscriptionId: row.provider_subscription_id,
    payerEmail: row.provider_payer_email,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    frequency: Number(row.frequency),
    frequencyType: row.frequency_type,
    startedAt: row.started_at,
    currentPeriodEnd: row.current_period_end,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  };
}

function warn(action: string, error: unknown) {
  console.warn(`[pdfmaster] cobrança: falha em ${action}:`, error instanceof Error ? error.message : error);
}

/** Assinatura que concede Premium agora (autorizada e dentro do período). */
export async function getActiveSubscription(openId: string, strict = false): Promise<Subscription | null> {
  try {
    const rows = await query<SubscriptionRow>(
      `SELECT ${COLUMNS} FROM subscriptions WHERE open_id = ? AND status = 'authorized' AND (current_period_end IS NULL OR current_period_end > CURRENT_TIMESTAMP) ORDER BY created_at DESC LIMIT 1`,
      [openId],
    );
    return rows[0] ? mapSubscription(rows[0]) : null;
  } catch (error) { if (strict) throw error; warn("getActiveSubscription", error); return null; }
}

/** Última assinatura registrada, seja qual for o status (para exibição no painel). */
export async function getLatestSubscription(openId: string, strict = false): Promise<Subscription | null> {
  try {
    const rows = await query<SubscriptionRow>(`SELECT ${COLUMNS} FROM subscriptions WHERE open_id = ? ORDER BY created_at DESC LIMIT 1`, [openId]);
    return rows[0] ? mapSubscription(rows[0]) : null;
  } catch (error) { if (strict) throw error; warn("getLatestSubscription", error); return null; }
}

export async function findSubscriptionByProviderId(provider: string, providerSubscriptionId: string): Promise<Subscription | null> {
  try {
    const rows = await query<SubscriptionRow>(`SELECT ${COLUMNS} FROM subscriptions WHERE provider = ? AND provider_subscription_id = ? LIMIT 1`, [provider, providerSubscriptionId]);
    return rows[0] ? mapSubscription(rows[0]) : null;
  } catch (error) { warn("findSubscriptionByProviderId", error); return null; }
}

export async function createSubscription(input: {
  openId: string; planId: string; provider: string; providerSubscriptionId: string | null;
  payerEmail: string | null; amountCents: number; frequency: number; frequencyType: string;
}): Promise<string | null> {
  const id = randomUUID();
  try {
    await query(
      "INSERT INTO subscriptions (id, open_id, provider, plan_id, status, provider_subscription_id, provider_payer_email, amount_cents, currency, frequency, frequency_type) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 'BRL', ?, ?)",
      [id, input.openId, input.provider, input.planId, input.providerSubscriptionId, input.payerEmail?.slice(0, 320) ?? null, input.amountCents, input.frequency, input.frequencyType],
    );
    return id;
  } catch (error) { warn("createSubscription", error); throw error; }
}

export async function updateSubscription(id: string, patch: {
  status?: SubscriptionStatus; currentPeriodEnd?: Date | null; startedAt?: Date | null; cancelledAt?: Date | null; providerSubscriptionId?: string | null;
}) {
  const sets: string[] = []; const params: (string | number | Date | null)[] = [];
  if (patch.status) { sets.push("status = ?"); params.push(patch.status); }
  if (patch.currentPeriodEnd !== undefined) { sets.push("current_period_end = ?"); params.push(patch.currentPeriodEnd); }
  if (patch.startedAt !== undefined) { sets.push("started_at = ?"); params.push(patch.startedAt); }
  if (patch.cancelledAt !== undefined) { sets.push("cancelled_at = ?"); params.push(patch.cancelledAt); }
  if (patch.providerSubscriptionId !== undefined) { sets.push("provider_subscription_id = ?"); params.push(patch.providerSubscriptionId); }
  if (!sets.length) return;
  try {
    await query(`UPDATE subscriptions SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  } catch (error) { warn("updateSubscription", error); throw error; }
}

/** Cancela a assinatura ativa do usuário mantendo o acesso até o fim do período pago. */
export async function cancelActiveSubscription(openId: string): Promise<Subscription | null> {
  try {
    const active = await getActiveSubscription(openId);
    if (!active) return null;
    // Sem período registrado, o acesso segue até o fim do ciclo vigente da cobrança.
    await query("UPDATE subscriptions SET cancelled_at = CURRENT_TIMESTAMP, current_period_end = COALESCE(current_period_end, CURRENT_TIMESTAMP + make_interval(months => frequency)) WHERE id = ?", [active.id]);
    return { ...active, cancelledAt: new Date() };
  } catch (error) { warn("cancelActiveSubscription", error); return null; }
}

export async function recordBillingEvent(input: { provider: string; topic: string | null; status: string | null; providerResourceId: string | null; payload: unknown }) {
  try {
    await query(
      "INSERT INTO billing_events (id, provider, topic, status, provider_resource_id, payload) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), input.provider, input.topic?.slice(0, 60) ?? null, input.status?.slice(0, 40) ?? null, input.providerResourceId?.slice(0, 191) ?? null, JSON.stringify(input.payload ?? null)],
    );
  } catch (error) { warn("recordBillingEvent", error); }
}
