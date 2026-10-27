import { createHmac, randomInt, randomUUID } from "node:crypto";
import { query as dbQuery } from "@/lib/db";
import { dummyPasswordHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import type { AppUser } from "@/lib/db/users";
import { canonicalEmail } from "@/lib/security/abuse";

function secret() { const key = process.env.MANUS_JWT_SECRET || process.env.AUTH_SESSION_SECRET; if (!key) throw new Error("AUTH_UNCONFIGURED"); return key; }
export function verificationHash(email: string, code: string) { return createHmac("sha256", secret()).update(`${email}:${code}`).digest("hex"); }
export async function allowAuthAttempt(actor: string, limit: number, query: typeof dbQuery = dbQuery) {
  const digest = createHmac("sha256", secret()).update(actor).digest("hex");
  const rows = await query("INSERT INTO local_auth_limits (actor_hash, hour, attempts) VALUES (?, date_trunc('hour', CURRENT_TIMESTAMP), 1) ON CONFLICT (actor_hash, hour) DO UPDATE SET attempts = local_auth_limits.attempts + 1 WHERE local_auth_limits.attempts < ? RETURNING attempts", [digest, limit]);
  return rows.length > 0;
}
export async function registerLocal(name: string, email: string, password: string, sendCode: (email: string, code: string) => Promise<void>, query: typeof dbQuery = dbQuery) {
  const existing = await query("SELECT open_id FROM account_email_identities WHERE normalized_email = ? UNION SELECT open_id FROM users WHERE lower(email) = ? LIMIT 1", [canonicalEmail(email), email]);
  if (existing.length) return; // Never attach a password to a Google/Manus account on email alone.
  const code = String(randomInt(100000, 1000000));
  const rows = await query("INSERT INTO local_accounts (email, user_id, display_name, password_hash, verification_hash, verification_expires) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP + INTERVAL '20 minutes') ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, verification_hash = EXCLUDED.verification_hash, verification_expires = EXCLUDED.verification_expires, verification_attempts = 0, created_at = CURRENT_TIMESTAMP WHERE local_accounts.verified_at IS NULL RETURNING email", [email, `local:${randomUUID()}`, name, await hashPassword(password), verificationHash(email, code)]);
  if (rows.length) await sendCode(email, code);
  await query("DELETE FROM local_accounts WHERE verified_at IS NULL AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'");
  await query("DELETE FROM local_auth_limits WHERE hour < CURRENT_TIMESTAMP - INTERVAL '2 days'");
}
export async function verifyLocal(email: string, code: string, query: typeof dbQuery = dbQuery): Promise<AppUser | null> {
  // Count wrong and correct attempts atomically before testing the code; no concurrent bypass.
  const attempts = await query("UPDATE local_accounts SET verification_attempts = verification_attempts + 1 WHERE email = ? AND verified_at IS NULL AND verification_expires > CURRENT_TIMESTAMP AND verification_attempts < 10 RETURNING email", [email]);
  if (!attempts.length) return null;
  const rows = await query<{ open_id: string; email: string; display_name: string }>("WITH candidate AS (SELECT user_id, email, display_name FROM local_accounts WHERE email = ? AND verification_hash = ? AND verified_at IS NULL AND verification_expires > CURRENT_TIMESTAMP), claim AS (INSERT INTO account_email_identities (normalized_email, open_id) SELECT ?, user_id FROM candidate ON CONFLICT DO NOTHING RETURNING open_id), created AS (INSERT INTO users (open_id, email, display_name) SELECT c.user_id, c.email, c.display_name FROM candidate c JOIN claim i ON i.open_id = c.user_id ON CONFLICT DO NOTHING RETURNING open_id, email, display_name), consumed AS (UPDATE local_accounts SET verified_at = CURRENT_TIMESTAMP, verification_hash = NULL, verification_expires = NULL WHERE user_id IN (SELECT open_id FROM created)) SELECT open_id, email, display_name FROM created", [email, verificationHash(email, code), canonicalEmail(email)]);
  const row = rows[0]; return row ? { openId: row.open_id, email: row.email, name: row.display_name } : null;
}
export async function loginLocal(email: string, password: string, query: typeof dbQuery = dbQuery): Promise<AppUser | null> {
  const rows = await query<{ open_id: string; email: string; display_name: string; password_hash: string }>("SELECT u.open_id, u.email, u.display_name, a.password_hash FROM local_accounts a JOIN users u ON u.open_id = a.user_id WHERE a.email = ? AND a.verified_at IS NOT NULL LIMIT 1", [email]);
  const row = rows[0];
  const valid = await verifyPassword(password, row?.password_hash || dummyPasswordHash);
  if (!row || !valid) return null;
  await query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE open_id = ?", [row.open_id]);
  return { openId: row.open_id, email: row.email, name: row.display_name };
}
