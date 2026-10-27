import { createCloneQuotaHandler } from "@/lib/clonemaster/quota";

export const runtime = "nodejs";
export const POST = createCloneQuotaHandler();
