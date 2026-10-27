import { NextRequest, NextResponse } from "next/server";
import { localSummaryCapabilities } from "@/lib/summary/provider";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { readSignedPlan, signPlanHeaders } from "@/lib/billing/plan-token";
import { commandExists } from "@/lib/processing/system";
import type { SummaryCapabilities } from "@/lib/summary/types";
import { processingWorkerUrl } from "@/lib/processing/worker-routing";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (process.env.PROCESSING_WORKER_ONLY === "1" && !readSignedPlan(request.headers)) return NextResponse.json({ error: "Consulte as capacidades pelo site principal." }, { status: 403, headers });
  let worker: string | undefined;
  try { worker = processingWorkerUrl("resumir-pdf-ia"); }
  catch { return NextResponse.json({ error: "A configuração dos processadores está indisponível." }, { status: 503, headers }); }
  let capabilities: SummaryCapabilities;
  if (worker) {
    try {
      const signed = signPlanHeaders("free"); if (!signed) throw Error("No worker signature");
      const response = await fetch(`${worker.replace(/\/$/, "")}/api/summary/capabilities`, { headers: signed, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw Error("Worker unavailable");
      const body = await response.text(); if (body.length > 10000) throw Error("Invalid capabilities");
      capabilities = JSON.parse(body);
      if (typeof capabilities.available !== "boolean" || !capabilities.models || !capabilities.limits) throw Error("Invalid capabilities");
    } catch { capabilities = { ...localSummaryCapabilities(false), available: false, models: { standard: null, advanced: null }, warning: "Não foi possível consultar o processador de IA. Tente novamente em instantes." }; }
  } else capabilities = localSummaryCapabilities(await commandExists(process.env.SUMMARY_TESSERACT || "tesseract"));
  const entitlements = await resolveEntitlements(request);
  return NextResponse.json({ ...capabilities, authenticated: Boolean(getCurrentUser(request)), jobsPerDay: entitlements.plan.id === "free" ? 3 : 10 }, { headers });
}
