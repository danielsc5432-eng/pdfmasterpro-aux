import { query as dbQuery } from "@/lib/db";
import { abuseHash, canonicalEmail } from "@/lib/security/abuse";

export async function reserveBudget(scope: string, value: string, limit: number, query: typeof dbQuery = dbQuery) {
  const hash = abuseHash(scope, value);
  const rows = await query<{ used: number }>("INSERT INTO abuse_budgets (actor_hash, window_start, used) VALUES (?, CURRENT_TIMESTAMP, 1) ON CONFLICT (actor_hash) DO UPDATE SET used = CASE WHEN abuse_budgets.window_start <= CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 1 ELSE abuse_budgets.used + 1 END, window_start = CASE WHEN abuse_budgets.window_start <= CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN CURRENT_TIMESTAMP ELSE abuse_budgets.window_start END WHERE abuse_budgets.used < ? OR abuse_budgets.window_start <= CURRENT_TIMESTAMP - INTERVAL '24 hours' RETURNING used", [hash, Math.max(1, Math.floor(limit))]);
  return rows.length > 0;
}
export async function reserveFreeTask(input: { email?: string; device: string; ip: string | null; limit: number }, query: typeof dbQuery = dbQuery): Promise<"account" | "device" | "network" | null> {
  await cleanupAbuse(query);
  if (input.email && !await reserveBudget("free-account", canonicalEmail(input.email), input.limit, query)) return "account";
  if (!await reserveBudget("free-device", input.device, input.limit, query)) return "device";
  // A generous secondary ceiling accommodates shared networks. An IP is not a person.
  if (input.ip && !await reserveBudget("free-network", input.ip, Math.max(100, input.limit * 10), query)) return "network";
  return null;
}
export async function freeUsage(email: string, deviceId?: string, query: typeof dbQuery = dbQuery) {
  const hashes = [abuseHash("free-account", canonicalEmail(email)), ...(deviceId ? [abuseHash("free-device", deviceId)] : [])];
  const rows = await query<{ total: number }>("SELECT COALESCE(MAX(used), 0) AS total FROM abuse_budgets WHERE actor_hash IN (?, ?) AND window_start > CURRENT_TIMESTAMP - INTERVAL '24 hours'", [hashes[0], hashes[1] || hashes[0]]);
  return Number(rows[0]?.total || 0);
}
export async function cleanupAbuse(query: typeof dbQuery = dbQuery) { await query("DELETE FROM abuse_budgets WHERE window_start < CURRENT_TIMESTAMP - INTERVAL '7 days'"); }
