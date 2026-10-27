import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, getPublicOrigin, SESSION_COOKIE, oauthCookieOptions } from "@/lib/auth/session";
import { upsertUser } from "@/lib/db/users";
import { attachDevice, deviceContext } from "@/lib/security/abuse";
import { registrationAllowed } from "@/lib/security/registration";

export const runtime = "nodejs";
function fail(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code"); const state = request.nextUrl.searchParams.get("state"); const expectedNonce = request.cookies.get("pdfmaster_oauth_state")?.value;
  if (!code || !state || !expectedNonce) return fail("A sessão de login expirou. Inicie o login novamente.");
  let parsed: { redirectUri?: string; nonce?: string; createdAt?: number };
  try { parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")); } catch { return fail("Estado de login inválido."); }
  const origin = getPublicOrigin(request); const redirectUri = `${origin}/api/auth/callback`;
  if (parsed.nonce !== expectedNonce || parsed.redirectUri !== redirectUri || !parsed.createdAt || Date.now() - parsed.createdAt > 10 * 60 * 1000) return fail("Não foi possível validar o estado do login.");
  const api = process.env.MANUS_OAUTH_API_URL; const clientId = process.env.MANUS_PROJECT_ID; if (!api || !clientId) return fail("A autenticação Manus não está configurada no servidor.", 503);
  try {
    const exchange = await fetch(`${api.replace(/\/$/, "")}/webdev.v1.WebDevAuthPublicService/ExchangeToken`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, grantType: "authorization_code", code, redirectUri }), cache: "no-store" });
    if (!exchange.ok) return fail("O provedor de login recusou o código. Tente novamente.", 401);
    const exchanged = await exchange.json() as { accessToken?: string };
    if (!exchanged.accessToken) return fail("O provedor de login não retornou uma sessão válida.", 401);
    const identity = await fetch(`${api.replace(/\/$/, "")}/webdev.v1.WebDevAuthPublicService/GetUserInfo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: exchanged.accessToken }), cache: "no-store" });
    if (!identity.ok) return fail("Não foi possível consultar a identidade da conta.", 401);
    const info = await identity.json() as { openId?: string; name?: string; email?: string };
    if (!info.openId || !info.email) return fail("A conta não retornou os dados mínimos para criar o perfil.", 422);
    const device = deviceContext(request);
    if (!await registrationAllowed(request, device, info.openId)) return attachDevice(fail("Limite de novos cadastros atingido. Aguarde 24 horas ou fale com o suporte.", 429), device, request);
    const user = await upsertUser({ openId: info.openId, email: info.email, name: info.name || info.email.split("@")[0] });
    const response = NextResponse.redirect(new URL("/painel", origin));
    response.cookies.set(SESSION_COOKIE, createSessionToken(user), { ...oauthCookieOptions(), maxAge: 60 * 60 * 24 * 7 });
    response.cookies.delete("pdfmaster_oauth_state");
    return attachDevice(response, device, request);
  } catch { return fail("Não foi possível concluir o login agora. Tente novamente.", 502); }
}
