"use client";

import { Check, Loader2, QrCode, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { annualSavingsPercent, formatBRL, PLANS, type Plan, type PlanId } from "@/lib/plans";

const freePlan = PLANS.find((plan) => plan.interval === "free")!;
const monthlyPlan = PLANS.find((plan) => plan.interval === "month")!;
const annualPlan = PLANS.find((plan) => plan.interval === "year")!;

const businessFeatures = [
  "Tudo do Premium para a equipe",
  "Múltiplos usuários e assentos",
  "Faturamento e nota fiscal",
  "Suporte dedicado e SLA",
];

type Props = {
  isLoggedIn: boolean;
  currentPlanId: PlanId;
  paymentReady: boolean;
};

export function PricingPlans({ isLoggedIn, currentPlanId, paymentReady }: Props) {
  const [annualBilling, setAnnualBilling] = useState(true);
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const premium = annualBilling ? annualPlan : monthlyPlan;
  const savings = annualSavingsPercent();
  const alreadyPremium = currentPlanId !== "free";
  const currentPlan = PLANS.find((plan) => plan.id === currentPlanId) ?? freePlan;

  async function startCheckout(plan: Plan, method: "recurring" | "once" | "pix" = "recurring") {
    setError(null);
    setLoading(plan.id);
    try {
      const recurring = method === "recurring";
      const body = new URLSearchParams({ plan: plan.id });
      if (method === "pix") body.set("method", "pix");
      const response = await fetch(recurring ? "/api/billing/checkout" : "/api/billing/checkout-once", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = (await response.json().catch(() => ({}))) as { initPoint?: string; error?: string };
      if (!response.ok || !data.initPoint) throw new Error(data.error || "Não foi possível iniciar o checkout.");
      window.location.href = data.initPoint;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Não foi possível iniciar o checkout.");
      setLoading(null);
    }
  }

  return (
    <div>
      <div className="billing-toggle" role="group" aria-label="Periodicidade da cobrança">
        <button type="button" className={annualBilling ? "" : "active"} onClick={() => setAnnualBilling(false)}>Mensal</button>
        <button type="button" className={annualBilling ? "active" : ""} onClick={() => setAnnualBilling(true)}>Anual</button>
        <span className="billing-badge">Economize {savings}%</span>
      </div>

      <div className="plan-grid">
        <article className="plan-card">
          <h2>{freePlan.name}</h2>
          <p className="plan-price">{freePlan.priceCents === 0 ? "R$ 0" : formatBRL(freePlan.priceCents)}<small> / sempre</small></p>
          <p>{freePlan.tagline}</p>
          <ul>{freePlan.features.map((feature) => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
          {currentPlanId === "free"
            ? <span className="plan-badge">Seu plano atual</span>
            : <Link className="button button-ghost" href="/ferramentas">Começar agora</Link>}
        </article>

        <article className="plan-card featured">
          <h2><Sparkles size={16} /> {premium.name}</h2>
          <p className="plan-price">
            {formatBRL(premium.priceCents)}
            <small>{premium.interval === "year" ? " / ano" : " / mês"}</small>
          </p>
          {annualBilling
            ? <p className="plan-note">Equivale a {formatBRL(annualPlan.monthlyEquivalentCents ?? 0)}/mês — ou {formatBRL(monthlyPlan.priceCents)}/mês na cobrança mensal.</p>
            : <p className="plan-note">Ou {formatBRL(annualPlan.priceCents)}/ano e economize {savings}%.</p>}
          <ul>{premium.features.map((feature) => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
          {alreadyPremium ? (
            <Link className="button button-primary" href="/configuracoes">Gerenciar assinatura</Link>
          ) : !isLoggedIn ? (
            <Link className="button button-primary" href="/entrar">Entrar e assinar</Link>
          ) : !paymentReady ? (
            <Link className="button button-primary" href="/contato">Falar com o suporte</Link>
          ) : (
            <>
              <button type="button" className="button button-primary" disabled={loading !== null} onClick={() => startCheckout(premium)}>
                {loading === premium.id ? <Loader2 className="spinner" size={16} /> : <Sparkles size={16} />} Assinar agora
              </button>
              <button type="button" className="button button-ghost" disabled={loading !== null} onClick={() => startCheckout(premium, "pix")}>
                {loading === premium.id ? <Loader2 className="spinner" size={16} /> : <QrCode size={16} />} Pagar com Pix
              </button>
              <button type="button" className="button button-ghost" disabled={loading !== null} onClick={() => startCheckout(premium, "once")}>
                {loading === premium.id ? <Loader2 className="spinner" size={16} /> : null} Pagar uma vez (cartão)
              </button>
            </>
          )}
          <p className="plan-note">Cancele quando quiser. Sem fidelidade.</p>
          {!alreadyPremium && isLoggedIn && paymentReady ? (
            <p className="plan-note">Assinar renova automaticamente. <strong>Pagar com Pix</strong> ou <strong>Pagar uma vez</strong> libera o Premium por {premium.interval === "year" ? "12 meses" : "1 mês"}, sem renovação.</p>
          ) : null}
        </article>

        <article className="plan-card">
          <h2>Empresarial</h2>
          <p className="plan-price">Sob consulta</p>
          <p>Para equipes que precisam de controle e escala.</p>
          <ul>{businessFeatures.map((feature) => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
          <Link className="button button-ghost" href="/contato">Falar com vendas</Link>
        </article>
      </div>

      {error ? <p className="plan-error">{error}</p> : null}
      {alreadyPremium ? <p className="plan-note" style={{ textAlign: "center" }}>Seu plano atual é o {currentPlan.interval === "year" ? "Premium anual" : "Premium mensal"}.</p> : null}
    </div>
  );
}
