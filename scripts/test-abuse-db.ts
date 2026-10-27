import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { NextRequest } from "next/server";
import { neonConfig } from "@neondatabase/serverless";
import { closeDb, query as dbQuery, toPlaceholders } from "../lib/db";
import { abuseHash } from "../lib/security/abuse";
import { freeUsage, reserveBudget, reserveFreeTask, cleanupAbuse } from "../lib/security/quotas";
import { upsertUser } from "../lib/db/users";
import { registerLocal, verifyLocal } from "../lib/auth/local-accounts";
import { POST as processFile } from "../app/api/v1/process/route";
import { signPlanHeaders } from "../lib/billing/plan-token";

async function main() {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const { PGlite } = require(process.env.PGLITE_MODULE || path.resolve(".vercel/tools/auth-tests/node_modules/@electric-sql/pglite"));
  const db = new PGlite(); const env = { ...process.env }; const oldTransport = neonConfig.fetchFunction;
  Object.assign(process.env, { AUTH_SESSION_SECRET: "abuse-db-only", BILLING_SIGNING_SECRET: "abuse-worker-only", NEXT_PUBLIC_SITE_URL: "https://local.example", DATABASE_URL: "postgresql://test:test@abuse-test.invalid/test", VERCEL: "1", NODE_ENV: "production" });
  delete process.env.MANUS_JWT_SECRET; delete process.env.PROCESSING_WORKER_URL;
  const query: typeof dbQuery = async <T>(sql: string, params: unknown[] = []) => (await db.query(toPlaceholders(sql), params)).rows as T[];
  try {
    for (const file of ["002_users.sql", "003_billing.sql", "006_local_accounts.sql"]) await db.exec(await readFile(`db/migrations/${file}`, "utf8"));
    await query("INSERT INTO users (open_id,email,display_name) VALUES ('old-one','a.li.ce@gmail.com','Old one'),('old-two','alice+old@gmail.com','Old two')");
    await db.exec(await readFile("db/migrations/007_abuse_protection.sql", "utf8"));
    assert.equal((await query<{ n: string }>("SELECT count(*) AS n FROM users"))[0].n, 2);
    await upsertUser({ openId: "old-two", email: "alice+old@gmail.com", name: "Updated" }, query);
    await assert.rejects(upsertUser({ openId: "new-google", email: "a.lice+new@googlemail.com", name: "New" }, query), /ACCOUNT_IDENTITY_EXISTS/);
    await upsertUser({ openId: "work-one", email: "a.b@company.com", name: "Work one" }, query);
    await upsertUser({ openId: "work-two", email: "ab@company.com", name: "Work two" }, query);
    const codes = new Map<string, string>();
    for (const email of ["new.person@gmail.com", "newperson+alias@googlemail.com"]) await registerLocal("New person", email, "A private long password 123", async (address, code) => { codes.set(address, code); }, query);
    const results = await Promise.all([...codes].map(([email, code]) => verifyLocal(email, code, query)));
    assert.equal(results.filter(Boolean).length, 1, "concurrent alias verification must create one identity");
    console.log("PASS aliases: migration preserves existing accounts, new aliases blocked, legitimate company addresses distinct, concurrent verification creates one account");

    assert.equal(await reserveFreeTask({ email: "first@example.com", device: "same-device", ip: null, limit: 2 }, query), null);
    assert.equal(await reserveFreeTask({ email: "first@example.com", device: "same-device", ip: null, limit: 2 }, query), null);
    assert.equal(await reserveFreeTask({ email: "second@example.com", device: "same-device", ip: null, limit: 2 }, query), "device");
    assert.equal(await reserveFreeTask({ email: "first@example.com", device: "new-device", ip: null, limit: 2 }, query), "account");
    assert.equal(await freeUsage("first@example.com", undefined, query), 2);
    assert.equal(await reserveFreeTask({ email: "g.mail+one@gmail.com", device: "gmail-one", ip: null, limit: 1 }, query), null);
    assert.equal(await reserveFreeTask({ email: "gmail+two@googlemail.com", device: "gmail-two", ip: null, limit: 1 }, query), "account");
    const concurrent = await Promise.all(Array.from({ length: 30 }, () => reserveBudget("concurrent", "same", 10, query)));
    assert.equal(concurrent.filter(Boolean).length, 10);
    for (let index = 0; index < 15; index++) assert.equal(await reserveFreeTask({ email: `shared-${index}@example.com`, device: `shared-${index}`, ip: "192.0.2.40", limit: 10 }, query), null);
    const network = await Promise.all(Array.from({ length: 100 }, () => reserveBudget("free-network", "192.0.2.41", 100, query)));
    assert.equal(network.filter(Boolean).length, 100);
    assert.equal(await reserveFreeTask({ email: "network@example.com", device: "network", ip: "192.0.2.41", limit: 10 }, query), "network");
    await query("UPDATE abuse_budgets SET window_start = CURRENT_TIMESTAMP - INTERVAL '25 hours' WHERE actor_hash = ?", [abuseHash("concurrent", "same")]);
    assert.equal(await reserveBudget("concurrent", "same", 10, query), true);
    await query("UPDATE abuse_budgets SET window_start = CURRENT_TIMESTAMP - INTERVAL '8 days'"); await cleanupAbuse(query);
    assert.equal((await query<{ n: number }>("SELECT count(*) AS n FROM abuse_budgets"))[0].n, 0);
    console.log("PASS quotas: swapping accounts/cookies and Gmail aliases does not reset allowance, atomic concurrency, shared networks, backstop, expiry and cleanup");

    neonConfig.fetchFunction = async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      const result = await db.query(payload.query, payload.params);
      const fields = result.fields.map((field: { name: string; dataTypeID: number }) => ({ name: field.name, dataTypeID: field.dataTypeID }));
      return Response.json({ fields, rows: result.rows.map((row: Record<string, unknown>) => fields.map((field: { name: string }) => row[field.name])), rowCount: result.rows.length, command: payload.query.split(" ")[0] });
    };
    await closeDb();
    const guest = () => new NextRequest("https://local.example/api/v1/process?tool=girar-pdf", { method: "POST", headers: { origin: "https://local.example", "x-vercel-forwarded-for": "192.0.2.80", cookie: "pdfmaster_session=" + "a".repeat(64) } });
    // Valid route, deliberately missing multipart body: budget admission is real; no document is processed.
    const admitted = await processFile(guest()); assert.equal(admitted.status, 400);
    await query("UPDATE abuse_budgets SET used = 100 WHERE actor_hash = ?", [abuseHash("free-network", "192.0.2.80")]);
    assert.equal((await processFile(guest())).status, 429);
    neonConfig.fetchFunction = async () => { throw Error("isolated database unavailable"); };
    assert.equal((await processFile(guest())).status, 503, "database failure must not disable quota protection");
    delete process.env.DATABASE_URL; await closeDb();
    assert.equal((await processFile(guest())).status, 503, "unsigned direct worker request must fail closed in production");
    process.env.PROCESSING_WORKER_ONLY = "1";
    assert.equal((await processFile(guest())).status, 403, "worker mode must reject unsigned traffic even before quota lookup");
    const signed = new NextRequest("https://local.example/api/v1/process?tool=girar-pdf", { method: "POST", headers: signPlanHeaders("free")! });
    assert.equal((await processFile(signed)).status, 400, "verified worker request must not consume quota twice");
    console.log("PASS real process route: admission, network block, database failure, unsigned worker rejection and signed worker compatibility");
  } finally { neonConfig.fetchFunction = oldTransport; process.env = env; await closeDb(); await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
