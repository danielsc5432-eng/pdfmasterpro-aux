import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getPublicOrigin } from "@/lib/auth/session";
import { query, databaseConfigured } from "@/lib/db";
import { ticketSchema, ticketText } from "@/lib/support-chat";
import { deliverSupport, supportDeliveryConfigured } from "@/lib/support-delivery";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });

export async function POST(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return error("Entre na sua conta para enviar o atendimento.", 401);
  if (request.headers.get("origin") !== new URL(getPublicOrigin(request)).origin || request.headers.get("sec-fetch-site") === "cross-site") return error("Origem do pedido inválida. Atualize a página.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return error("Formato de pedido inválido.", 415);
  if (!supportDeliveryConfigured() || !databaseConfigured()) return error("O envio automático ainda não está disponível. Use o e-mail de suporte abaixo; sua conversa não foi enviada.", 503);
  if (Number(request.headers.get("content-length") || 0) > 16384) return error("O resumo excede o limite permitido.", 413);
  const reader = request.body?.getReader();
  if (!reader) return error("Resumo ausente.", 422);
  let body = Buffer.alloc(0);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (body.length + value.length > 16384) { await reader.cancel(); return error("O resumo excede o limite permitido.", 413); }
      body = Buffer.concat([body, value]);
    }
  } catch { return error("Não foi possível ler o resumo.", 422); }
  let ticket;
  try { ticket = ticketSchema.parse(JSON.parse(body.toString("utf8"))); } catch { return error("Revise os campos e autorize o envio do resumo.", 422); }
  const actor = createHash("sha256").update(user.openId).digest("hex");
  const protocol = createHash("sha256").update(`${actor}:${JSON.stringify(ticket)}`).digest("hex").slice(0, 24).toUpperCase();
  try {
    // Atomic upsert prevents concurrent requests from bypassing the five-attempt limit.
    const rows = await query("INSERT INTO support_daily_limits (actor_hash, day, attempts) VALUES (?, CURRENT_DATE, 1) ON CONFLICT (actor_hash, day) DO UPDATE SET attempts = support_daily_limits.attempts + 1 WHERE support_daily_limits.attempts < 5 RETURNING attempts", [actor]);
    if (!rows.length) return error("Limite de cinco tentativas diárias atingido. Entre em contato pelo e-mail de suporte.", 429);
    await query("DELETE FROM support_daily_limits WHERE day < CURRENT_DATE - 7");
    await deliverSupport(ticketText(ticket, { name: user.name, email: user.email }, protocol), user.email, protocol);
    return NextResponse.json({ sent: true, protocol }, { headers });
  } catch { return error("Não foi possível confirmar o envio. Sua conversa foi mantida nesta página; tente novamente ou use o e-mail de suporte.", 502); }
}
