import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPublicOrigin, oauthCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const portal = process.env.MANUS_OAUTH_PORTAL_URL;
  const appId = process.env.MANUS_PROJECT_ID;
  if (!portal || !appId) return NextResponse.json({ error: "O login ainda não está configurado neste ambiente." }, { status: 503 });
  const origin = getPublicOrigin(request);
  const redirectUri = `${origin}/api/auth/callback`;
  const nonce = randomBytes(24).toString("base64url");
  const state = Buffer.from(JSON.stringify({ redirectUri, nonce, createdAt: Date.now() })).toString("base64url");
  const authorize = new URL(`${portal.replace(/\/$/, "")}/app-auth`);
  authorize.searchParams.set("appId", appId); authorize.searchParams.set("redirectUri", redirectUri); authorize.searchParams.set("state", state); authorize.searchParams.set("responseType", "code");
  const response = NextResponse.redirect(authorize);
  response.cookies.set("pdfmaster_oauth_state", nonce, oauthCookieOptions());
  return response;
}
