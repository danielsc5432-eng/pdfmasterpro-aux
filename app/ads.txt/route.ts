import { NextResponse } from "next/server";
import { ADSENSE_PUBLISHER_ID } from "@/lib/adsense";

export const runtime = "nodejs";
export function GET() {
  const body = `google.com, ${ADSENSE_PUBLISHER_ID}, DIRECT, f08c47fec0942fa0\n`;
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
