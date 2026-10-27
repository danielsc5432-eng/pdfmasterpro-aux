import test from "node:test";
import assert from "node:assert/strict";
import { FREE_PLAN, PLANS, annualSavingsPercent, formatBRL, getPlan, isPremiumPlanId, planForInterval } from "../../lib/plans";
import { planForSubscription } from "../../lib/billing/entitlements";
import { paymentMethodsFor } from "../../lib/billing/mercadopago";
import { PLAN_HEADER, PLAN_SIGNATURE_HEADER, readSignedPlan, signPlanHeaders } from "../../lib/billing/plan-token";
import { validateFile } from "../../lib/processing/validate";

test("catálogo tem plano grátis, mensal e anual", () => {
  assert.deepEqual(PLANS.map((plan) => plan.id), ["free", "premium-monthly", "premium-annual"]);
  assert.equal(getPlan("inexistente").id, "free");
  assert.equal(isPremiumPlanId("premium-annual"), true);
  assert.equal(isPremiumPlanId("free"), false);
});

test("preços do Premium ficam abaixo do iLovePDF e o anual tem desconto", () => {
  assert.equal(planForInterval("month").priceCents, 1990);
  assert.equal(planForInterval("year").priceCents, 14990);
  assert.match(formatBRL(1990), /19,90/);
  assert.match(formatBRL(14990), /149,90/);
  assert.equal(annualSavingsPercent(), 37);
  assert.equal(planForInterval("year").monthlyEquivalentCents, 1249);
});

test("Premium relaxa os limites do plano grátis", () => {
  const premium = planForInterval("year").limits;
  assert.ok(premium.maxFileBytes > FREE_PLAN.limits.maxFileBytes);
  assert.ok(premium.maxFilesPerTask > FREE_PLAN.limits.maxFilesPerTask);
  assert.equal(FREE_PLAN.limits.tasksPerDay, 10);
  assert.equal(Number.isFinite(premium.tasksPerDay), false);
  assert.equal(premium.premiumTools, true);
  assert.equal(premium.removeAds, true);
  assert.equal(FREE_PLAN.limits.premiumTools, false);
});

test("apenas assinatura autorizada concede Premium", () => {
  const base = { id: "s", openId: "o", provider: "mercadopago", planId: "premium-annual", providerSubscriptionId: null, payerEmail: null, amountCents: 14990, currency: "BRL", frequency: 12, frequencyType: "months", startedAt: null, currentPeriodEnd: null, cancelledAt: null, createdAt: new Date() };
  assert.equal(planForSubscription({ ...base, status: "authorized" }).id, "premium-annual");
  for (const status of ["pending", "paused", "cancelled", "expired", "rejected"] as const) {
    assert.equal(planForSubscription({ ...base, status }).id, "free");
  }
  assert.equal(planForSubscription(null).id, "free");
});

test("limite por arquivo respeita o plano informado", () => {
  const bytes = new Uint8Array(30 * 1024 * 1024);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"), 0);
  assert.equal(validateFile("grande.pdf", bytes, ["pdf"], "application/pdf").ok, false);
  assert.equal(validateFile("grande.pdf", bytes, ["pdf"], "application/pdf", { maxFileBytes: 100 * 1024 * 1024, planLabel: "plano Premium" }).ok, true);
});

test("botão do Pix restringe o checkout a Pix, sem cartão nem boleto", () => {
  // Sem restrição: o Mercado Pago mostra todos os meios disponíveis.
  assert.equal(paymentMethodsFor("all"), undefined);

  // Com Pix: exclui cartão de crédito, débito e boleto. O Pix não aparece em
  // /v1/payment_methods (é um meio por conta), então isolar só é possível
  // removendo os demais tipos.
  const pix = paymentMethodsFor("pix");
  assert.ok(pix);
  assert.deepEqual(pix!.excluded_payment_types.map((type) => type.id), ["credit_card", "debit_card", "ticket"]);
  assert.equal(pix!.excluded_payment_types.some((type) => type.id === "bank_transfer"), false);
});

test("cabeçalho de plano só é aceito com assinatura HMAC válida", () => {
  delete process.env.BILLING_SIGNING_SECRET;
  delete process.env.AUTH_SESSION_SECRET;
  delete process.env.MANUS_JWT_SECRET;
  assert.equal(signPlanHeaders("premium-monthly"), null);
  assert.equal(readSignedPlan(new Headers()), null);

  process.env.AUTH_SESSION_SECRET = "segredo-de-teste";
  const signed = signPlanHeaders("premium-monthly");
  assert.ok(signed);
  assert.equal(readSignedPlan(new Headers(signed!))?.id, "premium-monthly");

  const tampered = new Headers({ ...signed!, [PLAN_HEADER]: "premium-annual.9999999999" });
  assert.equal(readSignedPlan(tampered), null);
  const forged = new Headers({ [PLAN_HEADER]: "premium-annual.9999999999", [PLAN_SIGNATURE_HEADER]: "assinatura-falsa" });
  assert.equal(readSignedPlan(forged), null);
  const unicodeSignature = new Headers({ [PLAN_HEADER]: "premium-annual.9999999999", [PLAN_SIGNATURE_HEADER]: "é".repeat(43) });
  assert.equal(readSignedPlan(unicodeSignature), null);
  const expired = new Headers(signPlanHeaders("premium-annual", -10)!);
  assert.equal(readSignedPlan(expired), null);

  delete process.env.AUTH_SESSION_SECRET;
});
