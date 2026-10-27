import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, getPublicOrigin, SESSION_COOKIE } from "@/lib/auth/session";
import { databaseConfigured } from "@/lib/db";
import { allowAuthAttempt, loginLocal, registerLocal, verifyLocal } from "@/lib/auth/local-accounts";
import { emailSchema, passwordSchema, registrationSchema } from "@/lib/auth/password";
import { attachDevice, canonicalEmail, deviceContext, trustedClientIp, type DeviceContext } from "@/lib/security/abuse";
import { registrationAllowed } from "@/lib/security/registration";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });
async function handlePost(request: NextRequest, context: { params: Promise<{ action: string }> }, device: DeviceContext | null) {
  const { action } = await context.params;
  if (!["register", "verify", "login"].includes(action)) return error("Ação não encontrada.", 404);
  const origin = new URL(getPublicOrigin(request)).origin;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return error("Atualize a página e tente novamente.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return error("Formato inválido.", 415);
  if (!databaseConfigured() || !(process.env.MANUS_JWT_SECRET || process.env.AUTH_SESSION_SECRET)) return error("O acesso direto está temporariamente indisponível.", 503);
  if (Number(request.headers.get("content-length") || 0) > 4096) return error("Dados acima do limite.", 413);
  let input;
  try {
    const reader = request.body?.getReader(); if (!reader) return error("Preencha os campos.", 422);
    let data = Buffer.alloc(0);
    while (true) { const item = await reader.read(); if (item.done) break; if (data.length + item.value.length > 4096) { await reader.cancel(); return error("Dados acima do limite.", 413); } data = Buffer.concat([data, item.value]); }
    const schema = action === "register" ? registrationSchema : action === "verify" ? z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) }).strict() : z.object({ email: emailSchema, password: passwordSchema }).strict();
    input = schema.parse(JSON.parse(data.toString("utf8")));
  } catch { return error("Confira os campos. A senha deve ter de 12 a 128 caracteres; o código tem seis dígitos.", 422); }
  try {
    const ip = trustedClientIp(request);
    if ((ip && !await allowAuthAttempt(`ip:${ip}`, 30)) || !await allowAuthAttempt(`${action}:${canonicalEmail(input.email)}`, action === "register" ? 4 : 10)) return error("Muitas tentativas. Aguarde até a próxima hora ou use outra opção de acesso.", 429);
    if (action === "register") {
      if (!process.env.RESEND_API_KEY || !process.env.SUPPORT_FROM_EMAIL) return error("O envio de confirmação está indisponível.", 503);
      if (!device || !await registrationAllowed(request, device)) return error("Limite de cadastros deste navegador ou conexão atingido. Aguarde 24 horas ou fale com o suporte.", 429);
      const data = registrationSchema.parse(input);
      await registerLocal(data.name, data.email, data.password, async (email, code) => {
        const response = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.SUPPORT_FROM_EMAIL, to: [email], subject: "Confirme seu cadastro no PDF Master Pro", text: `Seu código de confirmação é ${code}. Ele expira em 20 minutos. Digite-o somente na página de cadastro do PDF Master Pro. Se você não solicitou este cadastro, ignore esta mensagem.` }) });
        if (!response.ok || !(await response.json()).id) throw new Error("MAIL_FAILED");
      });
      return NextResponse.json({ pending: true, message: "Se o endereço estiver disponível para cadastro, enviamos um código. Confira também o spam. Se já tem conta, use a opção de acesso original." }, { headers });
    }
    const user = action === "verify" ? await verifyLocal(input.email, "code" in input ? input.code : "") : await loginLocal(input.email, "password" in input ? input.password : "");
    if (!user) return error(action === "verify" ? "Código inválido ou expirado. Solicite um novo cadastro se necessário." : "E-mail ou senha inválidos. Se criou a conta com Google, use Entrar com Google.", 401);
    const response = NextResponse.json({ authenticated: true }, { headers });
    const secure = request.nextUrl.protocol === "https:";
    response.cookies.set(SESSION_COOKIE, createSessionToken(user), { httpOnly: true, secure, sameSite: "lax", maxAge: 604800, path: "/" });
    if (!/^[a-f0-9]{64}$/.test(request.cookies.get("pdfmaster_session")?.value || "")) response.cookies.set("pdfmaster_session", randomBytes(32).toString("hex"), { httpOnly: true, secure, sameSite: "lax", maxAge: 2592000, path: "/" });
    return response;
  } catch { return error("Não foi possível concluir agora. Tente novamente em alguns minutos.", 503); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const configured = Boolean(process.env.ANTI_ABUSE_SECRET || process.env.AUTH_SESSION_SECRET || process.env.MANUS_JWT_SECRET || process.env.BILLING_SIGNING_SECRET);
  const device = configured ? deviceContext(request) : null;
  const response = await handlePost(request, context, device);
  return device ? attachDevice(response, device, request) : response;
}
