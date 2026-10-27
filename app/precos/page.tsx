import { cookies } from "next/headers";
import { PricingPlans } from "@/components/pricing-plans";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { entitlementsForOpenId } from "@/lib/billing/entitlements";
import { mercadopagoConfigured } from "@/lib/billing/mercadopago";

export const metadata = { title: "Planos e preços", description: "Compare o plano grátis com o Premium mensal e anual do PDF Master Pro." };

export default async function PricingPage() {
  const jar = await cookies();
  const user = readSessionToken(jar.get(SESSION_COOKIE)?.value);
  const { plan } = await entitlementsForOpenId(user?.openId);

  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="eyebrow"><span className="eyebrow-dot" /> Planos simples</span>
        <h1>Escolha o ritmo do seu trabalho.</h1>
        <p>Comece de graça e evolua para o Premium quando precisar de arquivos maiores, ferramentas avançadas e processamento sem limites. Premium por R$ 19,90/mês ou R$ 149,90/ano.</p>
      </div>
      <PricingPlans isLoggedIn={Boolean(user)} currentPlanId={plan.id} paymentReady={mercadopagoConfigured()} />
    </div>
  );
}
