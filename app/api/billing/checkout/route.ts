import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getPublicOrigin } from "@/lib/auth/session";
import { getPlan } from "@/lib/plans";
import { createPreapproval, mercadopagoConfigured } from "@/lib/billing/mercadopago";
import { createSubscription } from "@/lib/db/subscriptions";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Entre na sua conta para assinar o Premium." }, { status: 401 });

  let planId = request.nextUrl.searchParams.get("plan") || "";
  try {
    const form = await request.formData();
    planId = String(form.get("plan") || planId);
  } catch {
    // Aceita também chamadas sem corpo, apenas com ?plan=.
  }

  const plan = getPlan(planId);
  if (!plan.purchasable) return NextResponse.json({ error: "Escolha o plano Premium mensal ou anual para continuar." }, { status: 400 });
  if (!mercadopagoConfigured()) return NextResponse.json({ error: "O pagamento ainda não está disponível neste ambiente.", code: "billing_unconfigured" }, { status: 503 });

  let origin: string;
  try {
    origin = getPublicOrigin(request);
  } catch {
    return NextResponse.json({ error: "Não foi possível determinar o endereço público do site." }, { status: 500 });
  }

  try {
    const preapproval = await createPreapproval({
      plan,
      payerEmail: user.email,
      externalReference: user.openId,
      backUrl: `${origin}/precos/obrigado`,
      notificationUrl: `${origin}/api/billing/webhook`,
    });
    if (!preapproval.init_point) return NextResponse.json({ error: "O Mercado Pago não retornou a página de pagamento." }, { status: 502 });
    await createSubscription({
      openId: user.openId,
      planId: plan.id,
      provider: "mercadopago",
      providerSubscriptionId: preapproval.id ?? null,
      payerEmail: user.email,
      amountCents: plan.priceCents,
      frequency: plan.interval === "year" ? 12 : 1,
      frequencyType: "months",
    });
    return NextResponse.json({ plan: plan.id, initPoint: preapproval.init_point });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível iniciar o checkout.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
