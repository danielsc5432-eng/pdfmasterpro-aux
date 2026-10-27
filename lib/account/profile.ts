import { z } from "zod";
import { query, databaseConfigured } from "@/lib/db";
import type { AppUser } from "@/lib/db/users";
import { listProcessingTasks, sessionHash } from "@/lib/db/tasks";
import { entitlementsForOpenId, latestSubscriptionForOpenId } from "@/lib/billing/entitlements";
import { getTool } from "@/lib/tools/catalog";
import { testingTaskLimit } from "@/lib/billing/testing-quota";
import { readDeviceToken } from "@/lib/security/abuse";
import { freeUsage } from "@/lib/security/quotas";

export const preferencesSchema = z.object({
  displayName: z.string().trim().min(2).max(80).refine(value => !/\p{C}/u.test(value), "Use um nome sem caracteres de controle."),
  preferredTool: z.string().max(80).refine(value => Boolean(getTool(value)), "Escolha uma ferramenta disponível."),
}).strict();

export async function accountData(user: AppUser, taskToken?: string, deviceToken?: string) {
  const fallback = { user: { name: user.name, email: user.email, provider: user.openId.startsWith("google:") ? "Google" : user.openId.startsWith("local:") ? "E-mail e senha" : "Manus" }, preferences: { displayName: user.name, preferredTool: "detector-divergencias" }, memberSince: null as string | null, storageAvailable: false, plan: null as null | { name: string; premium: boolean; maxFileBytes: number; maxFiles: number; dailyLimit: number | null; until: string | null }, usage: null as number | null, recent: null as null | { id: string; tool: string; status: string; createdAt: string }[] };
  if (!databaseConfigured()) return fallback;
  const details = await query<{ display_name: string; preferred_name: string | null; preferred_tool: string | null; created_at: Date }>("SELECT u.display_name, u.created_at, p.display_name AS preferred_name, p.preferred_tool FROM users u LEFT JOIN user_preferences p ON p.open_id = u.open_id WHERE u.open_id = ? LIMIT 1", [user.openId]).catch(() => null);
  if (!details?.[0]) return fallback;
  const row = details[0];
  const name = row.preferred_name || row.display_name || user.name;
  fallback.user.name = name;
  fallback.preferences = { displayName: name, preferredTool: getTool(row.preferred_tool ?? "")?.slug ?? "detector-divergencias" };
  fallback.memberSince = new Date(row.created_at).toISOString();
  fallback.storageAvailable = true;
  const validToken = taskToken && /^[a-f0-9]{64}$/i.test(taskToken) ? taskToken : null;
  const hash = validToken ? sessionHash(validToken) : null;
  const [entitlements, subscription, usage, recent] = await Promise.allSettled([
    entitlementsForOpenId(user.openId, true), latestSubscriptionForOpenId(user.openId, true),
    freeUsage(user.email, readDeviceToken(deviceToken) ?? undefined).then(total => [{ total }]),
    hash ? listProcessingTasks(hash) : Promise.resolve([]),
  ]);
  if (entitlements.status === "fulfilled") {
    const plan = entitlements.value.plan;
    const limit = testingTaskLimit(user.email, plan.limits.tasksPerDay);
    fallback.plan = { name: plan.interval === "year" ? "Premium anual" : plan.interval === "month" ? "Premium mensal" : "Grátis", premium: plan.id !== "free", maxFileBytes: plan.limits.maxFileBytes, maxFiles: plan.limits.maxFilesPerTask, dailyLimit: Number.isFinite(limit) ? limit : null, until: subscription.status === "fulfilled" ? subscription.value?.currentPeriodEnd?.toISOString() ?? null : null };
  }
  if (usage.status === "fulfilled") fallback.usage = Number(usage.value[0]?.total ?? 0);
  if (recent.status === "fulfilled") fallback.recent = recent.value.slice(0, 4).map(task => ({ id: task.id, tool: getTool(task.tool_slug)?.name ?? task.tool_slug, status: task.status, createdAt: new Date(task.created_at).toISOString() }));
  return fallback;
}

export async function savePreferences(openId: string, preferences: z.infer<typeof preferencesSchema>) {
  const checked = preferencesSchema.parse(preferences);
  await query("INSERT INTO user_preferences (open_id, display_name, preferred_tool) VALUES (?, ?, ?) ON CONFLICT (open_id) DO UPDATE SET display_name = EXCLUDED.display_name, preferred_tool = EXCLUDED.preferred_tool, updated_at = CURRENT_TIMESTAMP", [openId, checked.displayName, checked.preferredTool]);
  return checked;
}

export async function preferredName(user: AppUser) {
  if (!databaseConfigured()) return user.name;
  const rows = await query<{ display_name: string }>("SELECT display_name FROM user_preferences WHERE open_id = ? LIMIT 1", [user.openId]).catch(() => []);
  return rows[0]?.display_name || user.name;
}

export type AccountData = Awaited<ReturnType<typeof accountData>>;
