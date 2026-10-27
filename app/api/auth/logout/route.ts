import { NextRequest, NextResponse } from "next/server";
import { getPublicOrigin, SESSION_COOKIE } from "@/lib/auth/session";
export const runtime = "nodejs";
export function GET() { return NextResponse.json({ error: "Use o botão Sair dentro da sua conta." }, { status: 405, headers: { Allow: "POST", "Cache-Control": "private, no-store" } }); }
export function POST(request: NextRequest) {
  const origin = getPublicOrigin(request);
  if (request.headers.get("origin") !== new URL(origin).origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Origem da solicitação inválida." }, { status: 403 });
  const response = NextResponse.redirect(new URL("/", origin), { status: 303 });
  for (const name of [SESSION_COOKIE, "pdfmaster_session"]) response.cookies.set(name, "", { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", maxAge: 0, path: "/" });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
