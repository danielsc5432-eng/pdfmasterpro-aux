import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { preferredName } from "@/lib/account/profile";
import { attachDevice, deviceContext } from "@/lib/security/abuse";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const user = getCurrentUser(request); const headers = { "Cache-Control": "private, no-store" };
  const response = user ? NextResponse.json({ authenticated: true, user: { name: await preferredName(user), email: user.email } }, { headers }) : NextResponse.json({ authenticated: false }, { status: 401, headers });
  const configured = Boolean(process.env.ANTI_ABUSE_SECRET || process.env.AUTH_SESSION_SECRET || process.env.MANUS_JWT_SECRET || process.env.BILLING_SIGNING_SECRET);
  return configured ? attachDevice(response, deviceContext(request), request) : response;
}
