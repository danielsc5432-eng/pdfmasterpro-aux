import { NextRequest, NextResponse } from "next/server";
import { databaseConfigured } from "@/lib/db";
import { getCurrentUser, getPublicOrigin } from "@/lib/auth/session";
import { entitlementsForOpenId } from "@/lib/billing/entitlements";
import { testingTaskLimit } from "@/lib/billing/testing-quota";
import { attachDevice, deviceContext, trustedClientIp } from "@/lib/security/abuse";
import { reserveFreeTask } from "@/lib/security/quotas";

type Dependencies = { configured: typeof databaseConfigured; entitlements: typeof entitlementsForOpenId; reserve: typeof reserveFreeTask };
/** Reserves one shared task for the official local workflow. Receives no document data. */
export function createLocalQuotaHandler(toolName: string, overrides: Partial<Dependencies> = {}) {
  const deps = { configured: databaseConfigured, entitlements: entitlementsForOpenId, reserve: reserveFreeTask, ...overrides };
  return async function authorize(request: NextRequest) {
    const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
    if (process.env.PROCESSING_WORKER_ONLY === "1") return reply({ error: `Use o ${toolName} pelo site principal.` }, 403);
    if (request.headers.get("origin") !== new URL(getPublicOrigin(request)).origin) return reply({ error: "Origem inválida. Inicie o lote pelo site." }, 403);
    if (Number(request.headers.get("content-length") || 0) > 0 || request.headers.has("transfer-encoding")) return reply({ error: "A validação da cota não recebe arquivos ou conteúdo do lote." }, 400);
    try {
      if (!deps.configured()) return reply({ error: "A verificação da cota está indisponível. Tente novamente em instantes." }, 503);
      const user = getCurrentUser(request);
      // Resolve the actual account plan, never a plan supplied by the browser.
      const { plan } = await deps.entitlements(user?.openId, true);
      const limit = testingTaskLimit(user?.email, plan.limits.tasksPerDay);
      const device = deviceContext(request);
      const finish = (response: NextResponse) => attachDevice(response, device, request);
      if (Number.isFinite(limit)) {
        const ip = trustedClientIp(request);
        if (process.env.VERCEL === "1" && !ip) return finish(reply({ error: "Não foi possível validar esta conexão. Tente novamente." }, 503));
        const blocked = await deps.reserve({ email: user?.email, device: device.id, ip, limit });
        if (blocked) return finish(reply({ error: blocked === "network" ? "Há um volume elevado de tarefas gratuitas nesta conexão. Aguarde ou fale com o suporte." : `A cota de ${limit} tarefas gratuitas desta conta ou navegador foi atingida na janela de 24 horas. O ${toolName} compartilha essa cota com as outras ferramentas. Aguarde a renovação ou assine o Premium.` }, 429));
      }
      return finish(reply({ authorized: true, limit: Number.isFinite(limit) ? limit : null }));
    } catch { return reply({ error: "A verificação da cota está temporariamente indisponível. Nenhum lote foi autorizado." }, 503); }
  };
}
export function createCloneQuotaHandler(overrides: Partial<Dependencies> = {}) { return createLocalQuotaHandler("CloneMaster",overrides); }
