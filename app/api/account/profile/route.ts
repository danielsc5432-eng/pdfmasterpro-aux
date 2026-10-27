import { NextRequest, NextResponse } from "next/server";
import { accountData, preferencesSchema, savePreferences } from "@/lib/account/profile";
import { createSessionToken, getCurrentUser, getPublicOrigin, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers }); }

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return error("Entre na sua conta para acessar o perfil.", 401);
  return NextResponse.json(await accountData(user, request.cookies.get("pdfmaster_session")?.value, request.cookies.get("pdfmaster_device")?.value), { headers });
}

export async function PATCH(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return error("Sua sessão expirou. Entre novamente.", 401);
  if (request.headers.get("origin") !== new URL(getPublicOrigin(request)).origin || request.headers.get("sec-fetch-site") === "cross-site") return error("Não foi possível validar a origem da alteração.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return error("Envie os dados como JSON.", 415);
  if (Number(request.headers.get("content-length") || 0) > 4096) return error("Os dados do perfil excedem o limite.", 413);
  let input;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > 4096) return error("Os dados do perfil excedem o limite.", 413);
    input = preferencesSchema.parse(JSON.parse(body));
  } catch { return error("Informe um nome de 2 a 80 caracteres e escolha uma ferramenta disponível.", 422); }
  try {
    const saved = await savePreferences(user.openId, input);
    const response = NextResponse.json({ saved: true, preferences: saved }, { headers });
    response.cookies.set(SESSION_COOKIE, createSessionToken({ openId: user.openId, email: user.email, name: saved.displayName }), { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", maxAge: 7 * 24 * 60 * 60, path: "/" });
    return response;
  } catch { return error("Não foi possível salvar agora. Seus dados anteriores foram mantidos; tente novamente.", 503); }
}
