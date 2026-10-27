import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { FREE_PLAN, getPlan, type Plan } from "@/lib/plans";
import { getActiveSubscription, getLatestSubscription, type Subscription } from "@/lib/db/subscriptions";
import { readSignedPlan } from "@/lib/billing/plan-token";

export type Entitlements = {
  plan: Plan;
  source: "signed" | "subscription" | "free";
  subscription: Subscription | null;
};

const FREE: Entitlements = { plan: FREE_PLAN, source: "free", subscription: null };

/** Plano efetivo a partir de uma assinatura persistida. */
export function planForSubscription(subscription: Subscription | null | undefined): Plan {
  return subscription && subscription.status === "authorized" ? getPlan(subscription.planId) : FREE_PLAN;
}

/** Resolve o plano do usuário consultando o banco (usado no front-end). */
export async function entitlementsForOpenId(openId: string | null | undefined, strict = false): Promise<Entitlements> {
  if (!openId) return FREE;
  const subscription = await getActiveSubscription(openId, strict);
  if (subscription) return { plan: getPlan(subscription.planId), source: "subscription", subscription };
  return FREE;
}

/**
 * Resolve o plano de uma requisição: primeiro tenta o cabeçalho assinado
 * enviado pelo front-end (caso do worker), depois a sessão + banco.
 */
export async function resolveEntitlements(request: NextRequest): Promise<Entitlements> {
  const signed = readSignedPlan(request.headers);
  if (signed) return { plan: signed, source: "signed", subscription: null };
  return entitlementsForOpenId(getCurrentUser(request)?.openId);
}

/** Última assinatura registrada, para exibir no painel/configurações. */
export async function latestSubscriptionForOpenId(openId: string | null | undefined, strict = false): Promise<Subscription | null> {
  if (!openId) return null;
  return getLatestSubscription(openId, strict);
}
