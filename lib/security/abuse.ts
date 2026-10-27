import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest, NextResponse } from "next/server";

export const DEVICE_COOKIE = "pdfmaster_device";
const DEVICE_SECONDS = 180 * 24 * 60 * 60;
function secret() {
  const key = process.env.ANTI_ABUSE_SECRET || process.env.AUTH_SESSION_SECRET || process.env.MANUS_JWT_SECRET || process.env.BILLING_SIGNING_SECRET;
  if (!key) throw new Error("ABUSE_SECRET_UNCONFIGURED");
  return key;
}
export function abuseHash(scope: string, value: string) { return createHmac("sha256", secret()).update(`${scope}:${value}`).digest("hex"); }
export function canonicalEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const [local, domain] = normalized.split("@");
  if (["gmail.com", "googlemail.com"].includes(domain)) return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
  return normalized; // Dots and tags are not interchangeable on every provider.
}
export function readDeviceToken(token?: string, now = Date.now()): string | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[a-f0-9]{64}$/.test(parts[0]) || !/^\d{10}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return null;
  const expires = Number(parts[1]);
  if (expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + DEVICE_SECONDS + 60) return null;
  const expected = abuseHash("device-signature", `${parts[0]}.${parts[1]}`);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2])) ? parts[0] : null;
}
export type DeviceContext = { id: string; token: string; isNew: boolean };
export function deviceContext(request: NextRequest): DeviceContext {
  const token = request.cookies.get(DEVICE_COOKIE)?.value;
  const id = readDeviceToken(token);
  if (id) return { id, token: token!, isNew: false };
  const fresh = randomBytes(32).toString("hex"); const payload = `${fresh}.${Math.floor(Date.now() / 1000) + DEVICE_SECONDS}`;
  return { id: fresh, token: `${payload}.${abuseHash("device-signature", payload)}`, isNew: true };
}
export function attachDevice<T extends NextResponse>(response: T, context: DeviceContext, request: NextRequest): T {
  if (context.isNew) response.cookies.set(DEVICE_COOKIE, context.token, { httpOnly: true, secure: request.nextUrl.protocol === "https:" || process.env.VERCEL === "1", sameSite: "lax", maxAge: DEVICE_SECONDS, path: "/" });
  return response;
}
export function trustedClientIp(request: NextRequest): string | null {
  // Trust only the header supplied by the actual hosting environment, not an arbitrary proxy header from a client.
  if (process.env.VERCEL !== "1") return null;
  const value = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (!value || !isIP(value)) return null;
  return isIP(value) === 6 ? new URL(`http://[${value}]`).hostname.slice(1, -1) : value;
}
