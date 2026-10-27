import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ ok: true, service: "pdf-master-pro" }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
