import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedPayment, getPayment, getPreapproval, mapPreapprovalStatus, mercadopagoConfigured, verifyWebhookSignature } from "@/lib/billing/mercadopago";
import { createSubscription, findSubscriptionByProviderId, recordBillingEvent, updateSubscription, type Subscription } from "@/lib/db/subscriptions";
import { getPlan, PLANS } from "@/lib/plans";
import { addBillingMonths } from "@/lib/billing/period";

export const runtime = "nodejs";

class BillingValidationError extends Error {}

function validateAmount(amount: number | undefined, currency: string | undefined, expectedCents: number) {
  if (!Number.isFinite(amount) || Math.round(amount! * 100) !== expectedCents || currency !== "BRL") {
    throw new BillingValidationError("Valor ou moeda não corresponde ao plano contratado.");
  }
}

/**
 * Sincroniza uma compra avulsa (Checkout Pro).
 *
 * O `external_reference` é o openId do comprador. Ao aprovar, a assinatura
 * registrada no checkout é autorizada com validade de um mês ou de um ano.
 */
async function syncPayment(paymentId: string) {
  const payment = await getPayment(paymentId);
  const openId = payment.external_reference;
  if (!openId) return null;
  const amountCents = Math.round((payment.transaction_amount ?? NaN) * 100);
  const paidPlan = PLANS.find((plan) => plan.purchasable && plan.priceCents === amountCents);

  let record: Subscription | null = await findSubscriptionByProviderId("mercadopago-checkout", paymentId);

  if (!record) {
    // O webhook pode chegar pelo id do pagamento, sem a preferência associada:
    // procura a assinatura pendente mais recente desse usuário.
    const { getLatestSubscription } = await import("@/lib/db/subscriptions");
    const latest = await getLatestSubscription(openId);
    if (latest && latest.provider === "mercadopago-checkout" && latest.status === "pending") record = latest;
  }

  if (!record) {
    if (!paidPlan) throw new BillingValidationError("Valor pago não corresponde a um plano disponível.");
    validateAmount(payment.transaction_amount, payment.currency_id, paidPlan.priceCents);
    const plan = paidPlan;
    await createSubscription({
      openId,
      planId: plan.id,
      provider: "mercadopago-checkout",
      providerSubscriptionId: paymentId,
      payerEmail: payment.payer?.email ?? null,
      amountCents: Math.round((payment.transaction_amount ?? plan.priceCents / 100) * 100),
      frequency: plan.interval === "year" ? 12 : 1,
      frequencyType: "months",
    });
    record = await findSubscriptionByProviderId("mercadopago-checkout", paymentId);
  }

  if (!record) throw new Error("Não foi possível persistir a assinatura do pagamento.");
  if (record.openId !== openId) throw new BillingValidationError("O pagamento pertence a outra conta.");

  if (payment.status === "approved") {
    validateAmount(payment.transaction_amount, payment.currency_id, record.amountCents);
    // Mercado Pago retries notifications. One payment grants one fixed period.
    if (record.providerSubscriptionId === paymentId && record.status === "authorized" && record.currentPeriodEnd) return "authorized";
    const months = record.frequencyType === "months" ? record.frequency : 1;
    const approvedAt = payment.date_approved ? new Date(payment.date_approved) : record.startedAt ?? new Date();
    if (!Number.isFinite(approvedAt.getTime())) throw new BillingValidationError("Data de aprovação inválida.");
    const periodEnd = addBillingMonths(approvedAt, months);
    await updateSubscription(record.id, {
      status: "authorized",
      startedAt: record.startedAt ?? approvedAt,
      currentPeriodEnd: periodEnd,
      providerSubscriptionId: paymentId,
    });
    return "authorized";
  }

  if (["rejected", "cancelled", "refunded", "charged_back"].includes(payment.status || "")) {
    await updateSubscription(record.id, { status: payment.status === "rejected" ? "rejected" : "cancelled", cancelledAt: new Date() });
    return payment.status;
  }

  return "pending";
}

async function syncPreapproval(preapprovalId: string) {
  const preapproval = await getPreapproval(preapprovalId);
  let record: Subscription | null = await findSubscriptionByProviderId("mercadopago", preapprovalId);

  if (!record && preapproval.external_reference) {
    const annual = preapproval.auto_recurring?.frequency === 12;
    const plan = getPlan(annual ? "premium-annual" : "premium-monthly");
    const amount = Math.round((preapproval.auto_recurring?.transaction_amount ?? plan.priceCents / 100) * 100);
    validateAmount(preapproval.auto_recurring?.transaction_amount, preapproval.auto_recurring?.currency_id, plan.priceCents);
    await createSubscription({
      openId: preapproval.external_reference,
      planId: plan.id,
      provider: "mercadopago",
      providerSubscriptionId: preapproval.id ?? preapprovalId,
      payerEmail: preapproval.payer_email ?? null,
      amountCents: amount,
      frequency: preapproval.auto_recurring?.frequency ?? (annual ? 12 : 1),
      frequencyType: preapproval.auto_recurring?.frequency_type ?? "months",
    });
    record = await findSubscriptionByProviderId("mercadopago", preapprovalId);
  }

  if (!record) throw new Error("Não foi possível localizar ou persistir a assinatura.");
  const status = mapPreapprovalStatus(preapproval.status);
  if (preapproval.external_reference && preapproval.external_reference !== record.openId) throw new BillingValidationError("A assinatura pertence a outra conta.");
  if (status === "authorized") validateAmount(preapproval.auto_recurring?.transaction_amount, preapproval.auto_recurring?.currency_id, record.amountCents);
  const nextPayment = preapproval.auto_recurring?.next_payment_date;
  const periodEnd = nextPayment ? new Date(nextPayment) : record.currentPeriodEnd ?? addBillingMonths(record.startedAt ?? new Date(), record.frequency);
  if (!Number.isFinite(periodEnd.getTime())) throw new BillingValidationError("Período de assinatura inválido.");
  const revoked = status === "cancelled" || status === "expired" || status === "rejected";
  await updateSubscription(record.id, {
    status,
    currentPeriodEnd: status === "authorized" ? periodEnd : record.currentPeriodEnd,
    startedAt: status === "authorized" ? record.startedAt ?? new Date() : record.startedAt,
    cancelledAt: revoked ? record.cancelledAt ?? new Date() : record.cancelledAt,
    providerSubscriptionId: preapproval.id ?? record.providerSubscriptionId,
  });
  return status;
}

export async function POST(request: NextRequest) {
  const signatureHeader = request.headers.get("x-signature");
  const requestId = request.headers.get("x-request-id");
  const raw = await request.text();
  let payload: Record<string, unknown> | null = null;
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : null; } catch { payload = null; }

  const params = request.nextUrl.searchParams;
  const dataFromBody = (payload?.data as Record<string, unknown> | undefined)?.id;
  // Webhook JSON identifies the resource; legacy IPN uses query parameters.
  // The simulator can send a stale query type alongside a preapproval body.
  // Resource signatures and provider-side ownership/amount checks still apply.
  const topic = String(payload?.type || payload?.topic || params.get("type") || params.get("topic") || "").trim();
  const resourceId = String(params.get("data.id") || params.get("id") || dataFromBody || "") || null;

  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() ?? "";
  if (!verifyWebhookSignature({ signatureHeader, requestId, dataId: resourceId, secret })) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  await recordBillingEvent({ provider: "mercadopago", topic: topic || null, status: null, providerResourceId: resourceId, payload });

  if (!mercadopagoConfigured()) return NextResponse.json({ ok: true, skipped: "provider-not-configured" });

  try {
    if ((topic === "preapproval" || topic === "subscription_preapproval") && resourceId) {
      await syncPreapproval(resourceId);
    } else if ((topic === "authorized_payment" || topic === "subscription_authorized_payment") && resourceId) {
      const payment = await getAuthorizedPayment(resourceId);
      if (payment.preapproval_id) await syncPreapproval(payment.preapproval_id);
    } else if (topic === "payment" && resourceId) {
      await syncPayment(resourceId);
    }
  } catch (error) {
    console.warn("[pdfmaster] webhook do Mercado Pago:", error instanceof Error ? error.message : error);
    // Do not acknowledge a failed write/provider lookup: the notification must
    // remain eligible for retry rather than silently losing Premium activation.
    if (error instanceof BillingValidationError) return NextResponse.json({ error: "Dados da cobrança não correspondem à assinatura." }, { status: 422 });
    return NextResponse.json({ error: "Não foi possível sincronizar a assinatura. Tente novamente." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
