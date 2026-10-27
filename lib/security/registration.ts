import type { NextRequest } from "next/server";
import { findUser } from "@/lib/db/users";
import { trustedClientIp, type DeviceContext } from "@/lib/security/abuse";
import { reserveBudget, cleanupAbuse } from "@/lib/security/quotas";

export async function registrationAllowed(request: NextRequest, device: DeviceContext, existingOpenId?: string) {
  if (existingOpenId && await findUser(existingOpenId)) return true;
  if (!await reserveBudget("signup-device", device.id, 3)) return false;
  const ip = trustedClientIp(request);
  if (process.env.VERCEL === "1" && !ip) return false;
  if (ip && !await reserveBudget("signup-network", ip, 20)) return false;
  await cleanupAbuse();
  return true;
}
