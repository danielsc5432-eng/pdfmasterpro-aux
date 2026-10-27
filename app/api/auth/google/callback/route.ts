import { randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { upsertUser } from "@/lib/db/users";
import { attachDevice, deviceContext } from "@/lib/security/abuse";
import { registrationAllowed } from "@/lib/security/registration";

export const runtime = "nodejs";

function matchesCsrf(cookieValue: string | undefined, formValue: FormDataEntryValue | null) {
  if (!cookieValue || typeof formValue !== "string") return false;
  const cookieBuffer = Buffer.from(cookieValue);
  const formBuffer = Buffer.from(formValue);
  return cookieBuffer.length === formBuffer.length && timingSafeEqual(cookieBuffer, formBuffer);
}

function authError(request: NextRequest, error: string, mode: string) {
  const path = mode === "signup" ? "/criar-conta" : "/entrar";
  return NextResponse.redirect(new URL(`${path}?authError=${error}`, request.nextUrl.origin), { status: 303 });
}

export async function POST(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") === "signup" ? "signup" : "signin";
  let form: FormData;
  try { form = await request.formData(); } catch { return authError(request, "google_auth_failed", mode); }
  const cookieCsrf = request.cookies.get("g_csrf_token")?.value;
  if (!matchesCsrf(cookieCsrf, form.get("g_csrf_token"))) return authError(request, "google_csrf_failed", mode);

  const credential = form.get("credential");
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const sessionSecret = process.env.MANUS_JWT_SECRET || process.env.AUTH_SESSION_SECRET;
  if (typeof credential !== "string" || !clientId || !sessionSecret) return authError(request, "google_not_configured", mode);

  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    const googleProfile = ticket.getPayload();
    if (!googleProfile?.sub || !googleProfile.email || googleProfile.email_verified !== true) return authError(request, "google_email_unverified", mode);

    const appUser = {
      openId: `google:${googleProfile.sub}`,
      email: googleProfile.email,
      name: googleProfile.name || googleProfile.email.split("@")[0],
    };
    const device = deviceContext(request);
    if (process.env.DATABASE_URL && !await registrationAllowed(request, device, appUser.openId)) return attachDevice(authError(request, "registration_limited", mode), device, request);
    const user = process.env.DATABASE_URL ? await upsertUser(appUser) : appUser;
    const response = NextResponse.redirect(new URL("/painel", request.nextUrl.origin), { status: 303 });
    const secure = request.nextUrl.protocol === "https:";
    response.cookies.set(SESSION_COOKIE, createSessionToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    response.cookies.set("pdfmaster_session", randomBytes(32).toString("hex"), {
      httpOnly: true,
      sameSite: secure ? "none" : "lax",
      secure,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return attachDevice(response, device, request);
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_IDENTITY_EXISTS") return authError(request, "account_identity_exists", mode);
    return authError(request, "google_auth_failed", mode);
  }
}
