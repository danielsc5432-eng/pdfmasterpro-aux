import { createHmac, timingSafeEqual } from "node:crypto";
import { type Plan } from "@/lib/plans";
import type { SubscriptionStatus } from "@/lib/db/subscriptions";

/**
 * Integração com o Mercado Pago (assinaturas recorrentes via "preapproval").
 * Só é acionada quando MERCADOPAGO_ACCESS_TOKEN estiver configurado.
 */

const API_BASE = "https://api.mercadopago.com";

export type Preapproval = {
  id: string;
  status: string;
  init_point?: string;
  external_reference?: string;
  payer_email?: string;
  auto_recurring?: { transaction_amount?: number; currency_id?: string; frequency?: number; frequency_type?: string; next_payment_date?: string; end_date?: string };
};

export function mercadopagoConfigured() { return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN?.trim()); }

async function mpRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("O pagamento ainda não foi configurado neste ambiente.");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const raw = await response.text();
  let data: unknown = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : `O Mercado Pago respondeu ${response.status}.`;
    throw new Error(message);
  }
  return data as T;
}

export function preapprovalSchedule(plan: Plan) {
  return plan.interval === "year" ? { frequency: 12, frequencyType: "months" as const } : { frequency: 1, frequencyType: "months" as const };
}

export async function createPreapproval(input: { plan: Plan; payerEmail: string; externalReference: string; backUrl: string; notificationUrl: string }) {
  const { frequency, frequencyType } = preapprovalSchedule(input.plan);
  return mpRequest<Preapproval>("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `PDF Master Pro Premium (${input.plan.interval === "year" ? "anual" : "mensal"})`,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      notification_url: input.notificationUrl,
      status: "pending",
      auto_recurring: { frequency, frequency_type: frequencyType, transaction_amount: input.plan.priceCents / 100, currency_id: "BRL" },
    }),
  });
}

/**
 * Pagamento único via Checkout Pro ("preference").
 *
 * Alternativa à assinatura recorrente: cobra o período de uma vez (mensal ou
 * anual) e libera o Premium até `current_period_end`. Útil quando o antifraude
 * bloqueia a recorrência ou quando o cliente prefere não assinar.
 */
export type Preference = {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
  external_reference?: string;
};

export type PreferencePayment = {
  id: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string;
  payer?: { id?: number; email?: string };
};

/**
 * Meios de pagamento aceitos na compra avulsa.
 *
 * `all` deixa o Mercado Pago mostrar tudo (cartão, Pix, boleto).
 * `pix` restringe a tela ao Pix, para o botão dedicado.
 */
export type CheckoutMethod = "all" | "pix";

/** Restrições de `payment_methods` para cada meio escolhido. */
export function paymentMethodsFor(method: CheckoutMethod) {
  if (method !== "pix") return undefined;
  // O Pix é um meio por conta (não aparece em /v1/payment_methods como
  // bandeira), então a forma de isolá-lo é excluir cartão e boleto.
  return { excluded_payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "ticket" }] };
}

export async function createPreference(input: {
  plan: Plan;
  externalReference: string;
  backUrl: string;
  notificationUrl: string;
  payerEmail?: string | null;
  method?: CheckoutMethod;
}) {
  return mpRequest<Preference>("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [
        {
          id: input.plan.id,
          title: `PDF Master Pro Premium (${input.plan.interval === "year" ? "anual" : "mensal"})`,
          description: `Acesso Premium por ${input.plan.interval === "year" ? "12 meses" : "1 mês"}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: input.plan.priceCents / 100,
        },
      ],
      external_reference: input.externalReference,
      back_urls: { success: input.backUrl, pending: input.backUrl, failure: input.backUrl },
      auto_return: "approved",
      notification_url: input.notificationUrl,
      statement_descriptor: "PDFMASTERPRO",
      ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
      ...(paymentMethodsFor(input.method ?? "all") ? { payment_methods: paymentMethodsFor(input.method ?? "all") } : {}),
    }),
  });
}

export function getPayment(id: string) { return mpRequest<PreferencePayment>(`/v1/payments/${encodeURIComponent(id)}`); }

/** Payment aprovado de uma compra avulsa? */
export function paymentApproved(payment: PreferencePayment | null | undefined): boolean {
  return payment?.status === "approved";
}

export function getPreapproval(id: string) { return mpRequest<Preapproval>(`/preapproval/${encodeURIComponent(id)}`); }

export function cancelPreapproval(id: string) { return mpRequest<Preapproval>(`/preapproval/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) }); }

export type AuthorizedPayment = { id: string; preapproval_id?: string; status?: string; transaction_amount?: number };

export function getAuthorizedPayment(id: string) { return mpRequest<AuthorizedPayment>(`/authorized_payments/${encodeURIComponent(id)}`); }

export function mapPreapprovalStatus(status: string | null | undefined): SubscriptionStatus {
  switch (status) {
    case "authorized": return "authorized";
    case "paused": return "paused";
    case "cancelled": return "cancelled";
    case "finished": return "expired";
    case "pending": return "pending";
    default: return "pending";
  }
}

/** Valida a assinatura `x-signature` enviada pelo webhook do Mercado Pago. */
export function verifyWebhookSignature(input: { signatureHeader: string | null; requestId: string | null; dataId: string | null; secret: string }): boolean {
  if (!input.secret) return false; // Fail closed when webhook authentication is unavailable.
  const parts = Object.fromEntries((input.signatureHeader ?? "").split(",").map((piece) => piece.split("=").map((value) => value.trim()) as [string, string]).filter(([key]) => key));
  const ts = parts.ts; const v1 = parts.v1;
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  const manifest = `id:${(input.dataId ?? "").toLowerCase()};request-id:${input.requestId ?? ""};ts:${ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  return expected.length === v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
