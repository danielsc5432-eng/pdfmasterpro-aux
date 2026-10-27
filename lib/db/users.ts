import { query as dbQuery } from "@/lib/db";
import { canonicalEmail } from "@/lib/security/abuse";

export type AppUser = { openId: string; email: string; name: string };
type UserRow = { open_id: string; email: string; display_name: string };

export async function upsertUser(user: AppUser, query: typeof dbQuery = dbQuery) {
  const rows = await query("WITH claim AS (INSERT INTO account_email_identities (normalized_email, open_id) VALUES (?, ?) ON CONFLICT (normalized_email) DO UPDATE SET open_id = account_email_identities.open_id WHERE account_email_identities.open_id = EXCLUDED.open_id OR EXISTS (SELECT 1 FROM users WHERE users.open_id = EXCLUDED.open_id) RETURNING open_id) INSERT INTO users (open_id, email, display_name) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM claim) ON CONFLICT (open_id) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, last_login_at = CURRENT_TIMESTAMP RETURNING open_id", [canonicalEmail(user.email), user.openId, user.openId, user.email.slice(0, 320), user.name.slice(0, 191)]);
  if (!rows.length) throw new Error("ACCOUNT_IDENTITY_EXISTS");
  return user;
}
export async function findUser(openId: string) {
  const rows = await dbQuery<UserRow>("SELECT open_id, email, display_name FROM users WHERE open_id = ? LIMIT 1", [openId]);
  const row = rows[0];
  return row ? { openId: row.open_id, email: row.email, name: row.display_name } : null;
}
