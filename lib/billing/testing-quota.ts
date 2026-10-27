/** Temporary, account-scoped test allowance. It never grants a paid plan. */
export function testingTaskLimit(email: string | null | undefined, normalLimit: number, now = Date.now()): number {
  const allowed = process.env.TESTING_QUOTA_EMAIL?.trim().toLowerCase();
  const expires = Date.parse(process.env.TESTING_QUOTA_EXPIRES_AT || "");
  if (!allowed || !email || email.trim().toLowerCase() !== allowed || !Number.isFinite(expires) || expires <= now) return normalLimit;
  return Math.max(normalLimit, 100);
}
