import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getPublicOrigin } from "@/lib/auth/session";
import { cancelPreapproval, mercadopagoConfigured } from "@/lib/billing/mercadopago";
import { cancelActiveSubscription, getActiveSubscription } from "@/lib/db/subscriptions";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Entre na sua conta para gerenciar a assinatura." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(getPublicOrigin(request)).origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Origem da solicitação inválida." }, { status: 403 });

  const active = await getActiveSubscription(user.openId);
  if (!active) return NextResponse.json({ error: "Nenhuma assinatura ativa encontrada." }, { status: 404 });

  if (active.provider === "mercadopago-checkout") {
    // Compra avulsa já paga: não há recorrência a cancelar no Mercado Pago.
    // O acesso segue até o fim do período e simplesmente não renova.
    const saved = await cancelActiveSubscription(user.openId);
    if (!saved) return NextResponse.json({ error: "Não foi possível registrar a preferência de renovação. Tente novamente." }, { status: 503 });
    return NextResponse.json({ ok: true, recurring: false });
  }

  if (active.provider !== "mercadopago" || !active.providerSubscriptionId || !mercadopagoConfigured()) return NextResponse.json({ error: "O serviço de cobrança está indisponível. O cancelamento não foi confirmado." }, { status: 503 });
  {
    try {
      const result = await cancelPreapproval(active.providerSubscriptionId);
      if (result.id !== active.providerSubscriptionId || result.status !== "cancelled") throw Error("Cancellation not confirmed");
    } catch {
      return NextResponse.json({ error: "O Mercado Pago não confirmou o cancelamento. Nenhum sucesso foi registrado; tente novamente ou contate o suporte." }, { status: 502 });
    }
  }

  const saved = await cancelActiveSubscription(user.openId);
  if (!saved) return NextResponse.json({ error: "O provedor confirmou o cancelamento, mas a atualização local está pendente. Atualize a página antes de tentar novamente." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
