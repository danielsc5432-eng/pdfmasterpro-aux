import Link from "next/link";
import { cookies } from "next/headers";
import { CheckCircle2, Clock, Info } from "lucide-react";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { getActiveSubscription, getLatestSubscription } from "@/lib/db/subscriptions";
import { formatBRL, getPlan } from "@/lib/plans";

export const metadata = { title: "Assinatura Premium", description: "Confirmação da sua assinatura do PDF Master Pro." };

function formatDate(value: Date | null) {
  return value ? value.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : null;
}

export default async function CheckoutThanksPage() {
  const jar = await cookies();
  const user = readSessionToken(jar.get(SESSION_COOKIE)?.value);
  const active = user ? await getActiveSubscription(user.openId) : null;
  const latest = active ?? (user ? await getLatestSubscription(user.openId) : null);
  const plan = latest ? getPlan(latest.planId) : null;
  const until = formatDate(latest?.currentPeriodEnd ?? null);

  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="eyebrow"><span className="eyebrow-dot" /> Assinatura</span>
        {active ? (
          <>
            <h1><CheckCircle2 size={28} style={{ verticalAlign: "middle", marginRight: 8, color: "var(--accent)" }} />Premium ativo.</h1>
            <p>Obrigado! Seu plano {plan?.interval === "year" ? "anual" : "mensal"} já está liberado{until ? ` até ${until}` : ""}.</p>
          </>
        ) : latest ? (
          <>
            <h1><Clock size={28} style={{ verticalAlign: "middle", marginRight: 8 }} />Confirmando o pagamento.</h1>
            <p>Assim que o Mercado Pago aprovar a assinatura, o Premium é liberado automaticamente. Isso costuma levar alguns segundos.</p>
          </>
        ) : (
          <>
            <h1><Info size={28} style={{ verticalAlign: "middle", marginRight: 8 }} />Nenhuma assinatura encontrada.</h1>
            <p>Volte para a página de planos para escolher o Premium mensal ou anual.</p>
          </>
        )}
      </div>

      <div className="empty-panel">
        {plan ? (
          <p>Plano <strong>{plan.interval === "year" ? "Premium anual" : "Premium mensal"}</strong> — {formatBRL(plan.priceCents)}{plan.interval === "year" ? "/ano" : "/mês"}.</p>
        ) : null}
        <p>{active ? "Use todas as ferramentas sem limites de tarefas e sem anúncios." : "Atualize esta página em instantes para ver o novo status."}</p>
        <div style={{ marginTop: 18, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link className="button button-primary" href="/ferramentas">Ir para as ferramentas</Link>
          <Link className="button button-ghost" href="/configuracoes">Gerenciar assinatura</Link>
        </div>
      </div>
    </div>
  );
}
