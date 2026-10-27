import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { legalAICapabilities } from "@/lib/legal/ai-service";
import { createLegalAIHandler } from "@/lib/legal/ai-route";
export const runtime="nodejs";
export const maxDuration=60;
export function GET(request:NextRequest){if(process.env.PROCESSING_WORKER_ONLY==="1")return NextResponse.json({error:"Use o site principal."},{status:403});return NextResponse.json(legalAICapabilities(!!getCurrentUser(request)),{headers:{"Cache-Control":"private, no-store"}});}
export const POST=createLegalAIHandler();
