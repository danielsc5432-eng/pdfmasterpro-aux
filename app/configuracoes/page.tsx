import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { entitlementsForOpenId, latestSubscriptionForOpenId } from "@/lib/billing/entitlements";
import { formatBRL, formatFileSize } from "@/lib/plans";
import { CancelSubscriptionButton } from "@/components/manage-subscription";

import { AccountNavigation } from "@/components/account-navigation";

export const metadata = { title: "Configurações", description: "Preferências e assinatura da sua conta PDF Master Pro." };

const statusLabels: Record<string, string> = {
  pending: "Aguardando confirmação do pagamento",
  authorized: "Ativa",
  paused: "Pausada",
  cancelled: "Cancelada",
  expired: "Expirada",
  rejected: "Recusada",
};

export default async function SettingsPage() {
  const jar = await cookies();
  const user = readSessionToken(jar.get(SESSION_COOKIE)?.value);

  if (!user) {
    return <div className="page-shell"><div className="page-header"><span className="eyebrow"><span className="eyebrow-dot" /> Preferências</span><h1>Entre para gerenciar sua assinatura.</h1><p>O plano, a renovação e os limites de processamento ficam vinculados à sua conta.</p><Link className="button button-primary" href="/entrar">Entrar</Link></div><div className="empty-panel"><Link className="button button-ghost" href="/precos">Ver planos</Link></div></div>;
  }

  const { plan } = await entitlementsForOpenId(user.openId);
  const subscription = await latestSubscriptionForOpenId(user.openId);
  const premium = plan.id !== "free";
  const planLabel = plan.interval === "year" ? "Premium anual" : plan.interval === "month" ? "Premium mensal" : "Grátis";
  const until = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;

  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="eyebrow"><span className="eyebrow-dot" /> Preferências</span>
        <h1>Assinatura e limites.</h1>
        <p>Acompanhe seu plano atual, os limites de processamento e a renovação da assinatura.</p>
      </div>

      <AccountNavigation active="configuracoes" />
      <div className="feature-band" style={{ marginTop: 32 }}>
        <div className="feature-card">
          <h3>Plano atual</h3>
          <p><strong>{planLabel}</strong>{premium ? ` — ${formatBRL(plan.priceCents)}${plan.interval === "year" ? "/ano" : "/mês"}` : " — R$ 0"}</p>
          {subscription ? <p>Status: {statusLabels[subscription.status] ?? subscription.status}{until ? ` · até ${until}` : ""}.</p> : null}
          {subscription?.cancelledAt ? <p>A renovação está cancelada; o acesso segue até {until ?? "o fim do período pago"}.</p> : null}
        </div>
        <div className="feature-card">
          <h3>Limites</h3>
          <p>{formatFileSize(plan.limits.maxFileBytes)} por arquivo</p>
          <p>{plan.limits.maxFilesPerTask} arquivos por tarefa</p>
          <p>{Number.isFinite(plan.limits.tasksPerDay) ? `${plan.limits.tasksPerDay} tarefas por dia` : "Processamento ilimitado"}</p>
          <p>{plan.limits.removeAds ? "Sem anúncios" : "Com anúncios"}</p>
        </div>
        <div className="feature-card">
          <h3>Renovação</h3>
          {premium && subscription?.provider === "mercadopago-checkout"
            ? <p>Esta compra é avulsa, sem renovação automática. O acesso segue até {until ?? "o fim do período pago"}.</p>
            : premium && subscription && !subscription.cancelledAt
            ? <><p>A renovação é automática. Cancele quando quiser{until ? ` — o acesso segue até ${until}` : ""}.</p><CancelSubscriptionButton /></>
            : premium && subscription?.cancelledAt
              ? <p>Renovação cancelada. Aproveite o Premium até {until ?? "o fim do período pago"}.</p>
              : <><p>Você está no plano grátis. Assine para liberar todas as ferramentas e processamento sem limites.</p><Link className="button button-primary" href="/precos">Ver planos Premium</Link></>}
        </div>
      </div>
    </div>
  );
}
