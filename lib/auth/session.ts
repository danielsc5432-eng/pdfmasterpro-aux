import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { AppUser } from "@/lib/db/users";

export const SESSION_COOKIE = "webdev_app_session";
type Claims = AppUser & { appId: string; iat: number; exp: number };
function encode(value: string | object) { return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url"); }
function sign(input: string, secret: string) { return createHmac("sha256", secret).update(input).digest("base64url"); }
function sessionSecret() { return process.env.MANUS_JWT_SECRET || process.env.AUTH_SESSION_SECRET; }
function sessionAppId() { return process.env.MANUS_PROJECT_ID || process.env.NEXT_PUBLIC_SITE_URL || "pdfmasterpro"; }
export function createSessionToken(user: AppUser) { const secret = sessionSecret(); const appId = sessionAppId(); if (!secret) throw new Error("A chave de sessão não está configurada no servidor."); const now = Math.floor(Date.now() / 1000); const header = encode({ alg: "HS256", typ: "JWT" }); const payload = encode({ ...user, appId, iat: now, exp: now + 60 * 60 * 24 * 7 }); const input = `${header}.${payload}`; return `${input}.${sign(input, secret)}`; }
export function readSessionToken(token?: string | null): Claims | null { try { if (!token) return null; const [header, encoded, signature] = token.split("."); const secret = sessionSecret(); const appId = sessionAppId(); if (!secret || !header || !encoded || !signature) return null; const expected = sign(`${header}.${encoded}`, secret); if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null; const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Claims; if (claims.appId !== appId || claims.exp <= Math.floor(Date.now() / 1000) || !claims.openId || !claims.email) return null; return claims; } catch { return null; } }
export function getCurrentUser(request: NextRequest) { return readSessionToken(request.cookies.get(SESSION_COOKIE)?.value); }
function canonicalOrigin(origin: string) { return origin.replace(/^(https?):\/\/pdfmasterpro\.com\.br(?=$|\/)/i, "$1://www.pdfmasterpro.com.br"); }
export function getPublicOrigin(request: NextRequest) { const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, ""); if (configured) return canonicalOrigin(configured); const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"; const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host"); if (!host) throw new Error("Não foi possível determinar a origem pública do site."); return canonicalOrigin(`${forwarded}://${host}`); }
export function oauthCookieOptions() { return { httpOnly: true, sameSite: "none" as const, secure: true, maxAge: 600, path: "/" }; }
