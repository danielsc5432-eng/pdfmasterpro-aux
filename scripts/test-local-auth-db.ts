import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { toPlaceholders, query as dbQuery } from "../lib/db";
import { allowAuthAttempt, registerLocal, verifyLocal, loginLocal } from "../lib/auth/local-accounts";

async function main() {
  // Optional isolated test dependency, never loaded by the production application.
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const { PGlite } = require(process.env.PGLITE_MODULE || path.resolve(".vercel/tools/auth-tests/node_modules/@electric-sql/pglite"));
  const db = new PGlite();
  process.env.AUTH_SESSION_SECRET = "local-auth-database-test-only"; delete process.env.MANUS_JWT_SECRET;
  const query: typeof dbQuery = async <T>(sql: string, params: unknown[] = []) => (await db.query(toPlaceholders(sql), params)).rows as T[];
  try {
    for (const file of ["002_users.sql", "006_local_accounts.sql", "007_abuse_protection.sql"]) await db.exec(await readFile(`db/migrations/${file}`, "utf8"));
    let code = ""; let sends = 0;
    const send = async (_email: string, value: string) => { code = value; sends++; };
    await registerLocal("Pessoa Teste", "person@example.com", "Minha frase secreta 123", send, query);
    assert.equal(sends, 1); assert.match(code, /^\d{6}$/);
    assert.equal(await loginLocal("person@example.com", "Minha frase secreta 123", query), null);
    assert.equal(await verifyLocal("person@example.com", "000000", query), null);
    const account = await verifyLocal("person@example.com", code, query); assert.ok(account?.openId.startsWith("local:"));
    assert.equal(await verifyLocal("person@example.com", code, query), null, "code is single use");
    assert.equal((await loginLocal("person@example.com", "Minha frase secreta 123", query))?.openId, account?.openId);
    assert.equal(await loginLocal("person@example.com", "Senha errada longa 123", query), null);
    await registerLocal("Intruso", "person@example.com", "Outra senha invasora 123", send, query); assert.equal(sends, 1);
    assert.equal((await loginLocal("person@example.com", "Minha frase secreta 123", query))?.openId, account?.openId);
    await query("INSERT INTO users (open_id,email,display_name) VALUES (?,?,?)", ["google:existing", "google@example.com", "Google Test"]);
    await registerLocal("Intruso", "google@example.com", "Outra senha invasora 123", send, query); assert.equal(sends, 1);
    assert.equal(await loginLocal("google@example.com", "Outra senha invasora 123", query), null);
    await registerLocal("Expirada", "expired@example.com", "Minha frase secreta 123", send, query);
    await query("UPDATE local_accounts SET verification_expires = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE email = ?", ["expired@example.com"]);
    assert.equal(await verifyLocal("expired@example.com", code, query), null);
    await registerLocal("Tentativas", "attempts@example.com", "Minha frase secreta 123", send, query);
    for (let index = 0; index < 10; index++) assert.equal(await verifyLocal("attempts@example.com", "000000", query), null);
    assert.equal(await verifyLocal("attempts@example.com", code, query), null, "ten failed codes lock challenge");
    const limits = await Promise.all(Array.from({ length: 12 }, () => allowAuthAttempt("test@example.com", 4, query)));
    assert.equal(limits.filter(Boolean).length, 4);
    console.log("PASS isolated PostgreSQL: migration, pending account, verification, login, wrong password, one-use and expired codes, duplicate registration, Google isolation, ten-code limit and concurrent rate limit");
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
