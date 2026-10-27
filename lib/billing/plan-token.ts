import { createHmac, timingSafeEqual } from "node:crypto";
import { getPlan, type Plan, type PlanId } from "@/lib/plans";

/**
 * O front-end resolve o plano do usuário e o encaminha ao worker assinado com
 * HMAC. Assim o worker aplica os limites corretos sem precisar de acesso ao
 * banco, e um cliente não consegue forjar o cabeçalho.
 *
 * `BILLING_SIGNING_SECRET` é o segredo dedicado; na ausência dele reutilizamos
 * os segredos já compartilhados entre Vercel e worker.
 */

export const PLAN_HEADER = "x-pdfmaster-plan";
export const PLAN_SIGNATURE_HEADER = "x-pdfmaster-plan-sig";
const DEFAULT_TTL_SECONDS = 300;

function signingSecret() {
  return process.env.BILLING_SIGNING_SECRET?.trim() || process.env.AUTH_SESSION_SECRET?.trim() || process.env.MANUS_JWT_SECRET?.trim();
}

function sign(payload: string, secret: string) { return createHmac("sha256", secret).update(payload).digest("base64url"); }

export function signPlanHeaders(planId: PlanId, ttlSeconds = DEFAULT_TTL_SECONDS): Record<string, string> | null {
  const secret = signingSecret();
  if (!secret) return null;
  const payload = `${planId}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  return { [PLAN_HEADER]: payload, [PLAN_SIGNATURE_HEADER]: sign(payload, secret) };
}

export function readSignedPlan(headers: Headers): Plan | null {
  const secret = signingSecret();
  if (!secret) return null;
  const payload = headers.get(PLAN_HEADER);
  const signature = headers.get(PLAN_SIGNATURE_HEADER);
  if (!payload || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = sign(payload, secret);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  const [planId, expRaw] = payload.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return getPlan(planId);
}
