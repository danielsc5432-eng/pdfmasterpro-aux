import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { neonConfig } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { GET, PATCH } from "../../app/api/account/profile/route";
import { GET as me } from "../../app/api/auth/me/route";
import { GET as logoutGet, POST as logout } from "../../app/api/auth/logout/route";
import { POST as cancel } from "../../app/api/billing/cancel/route";
import { createSessionToken, readSessionToken, SESSION_COOKIE } from "../../lib/auth/session";
import { closeDb } from "../../lib/db";
import { getSessionContext, sessionHash } from "../../lib/db/tasks";
import { abuseHash } from "../../lib/security/abuse";

// Real handlers, SQL, validation and signatures. Only the PostgreSQL HTTP
// transport and billing provider boundary are replaced; no external requests.
test("conta: preferências privadas, sessão e cancelamento confirmado", async t => {
  const db = new DatabaseSync(":memory:");
  for (const migration of ["001_processing_history", "002_users", "003_billing", "004_user_preferences"]) db.exec(readFileSync(`db/migrations/${migration}.sql`, "utf8"));
  const env = { ...process.env }, oldFetch = globalThis.fetch, oldNeon = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://test:test@account-test.invalid/test";
  process.env.AUTH_SESSION_SECRET = "isolated-account-test";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost";
  process.env.MERCADOPAGO_ACCESS_TOKEN = "isolated-provider";
  delete process.env.MANUS_JWT_SECRET; delete process.env.MANUS_PROJECT_ID;
  db.exec("CREATE TABLE abuse_budgets (actor_hash CHAR(64) PRIMARY KEY, window_start TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, used INTEGER)");
  db.prepare("INSERT INTO abuse_budgets (actor_hash, used) VALUES (?, 1)").run(abuseHash("free-account", "account@example.invalid"));
  db.prepare("INSERT INTO abuse_budgets (actor_hash, used) VALUES (?, 99)").run(abuseHash("free-account", "other@example.invalid"));
  await closeDb();
  const user = { openId: "google:account-test", email: "account@example.invalid", name: "Original name" };
  const cookie = `${SESSION_COOKIE}=${createSessionToken(user)}; pdfmaster_session=${"a".repeat(64)}`;
  db.prepare("INSERT INTO users (open_id, email, display_name) VALUES (?, ?, ?)").run(user.openId, user.email, user.name);
  db.prepare("INSERT INTO users (open_id, email, display_name) VALUES (?, ?, ?)").run("other", "other@example.invalid", "Other person");
  db.prepare("INSERT INTO processing_tasks (id,session_hash,tool_slug,status,file_count,input_bytes) VALUES (?,?,?,'completed',1,100)").run("own-task", sessionHash("a".repeat(64)), "girar-pdf");
  db.prepare("INSERT INTO processing_tasks (id,session_hash,tool_slug,status,file_count,input_bytes) VALUES (?,?,?,'completed',1,100)").run("other-task", sessionHash("b".repeat(64)), "juntar-pdf");
  let failWrites = false, failBillingReads = false, providerCalls = 0, providerStatus = 200;
  let providerResult = { id: "test-subscription", status: "cancelled" };
  neonConfig.fetchFunction = async (_url: string, init: RequestInit) => {
    const { query, params } = JSON.parse(String(init.body)) as { query: string; params: SQLInputValue[] };
    if (failWrites && /^(INSERT INTO user_preferences|UPDATE subscriptions)/i.test(query)) throw Error("Simulated persistence failure");
    if (failBillingReads && /FROM subscriptions/i.test(query)) throw Error("Simulated billing read failure");
    const sql = query.replace(/\$\d+/g, "?").replace(/CURRENT_TIMESTAMP - INTERVAL '24 hours'/g, "datetime('now','-24 hours')").replace(/CURRENT_TIMESTAMP \+ make_interval\(months => frequency\)/g, "datetime('now', '+' || frequency || ' months')");
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    const names = rows.length ? Object.keys(rows[0]) : [];
    return Response.json({ fields: names.map(name => ({ name, dataTypeID: name.endsWith("_at") || name === "current_period_end" ? 1184 : 25 })), rows: rows.map(row => names.map(name => row[name])), rowCount: rows.length, command: query.split(" ")[0] });
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.mercadopago.com/preapproval/test-subscription");
    assert.equal(init?.method, "PUT");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer isolated-provider");
    assert.deepEqual(JSON.parse(String(init?.body)), { status: "cancelled" });
    providerCalls++;
    return Response.json(providerResult, { status: providerStatus });
  }) as typeof fetch;
  const request = (method = "GET", body?: unknown, origin = "http://localhost") => new NextRequest("http://localhost/api/account/profile", { method, headers: { cookie, origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const prefs = { displayName: "Meu nome", preferredTool: "pdf-para-word" };
  const snapshot = async () => (await GET(request())).json();
  const seedSubscription = (provider = "mercadopago") => {
    db.exec("DELETE FROM subscriptions"); providerCalls = 0; failWrites = false; providerStatus = 200; providerResult = { id: "test-subscription", status: "cancelled" };
    db.prepare("INSERT INTO subscriptions (id,open_id,provider,plan_id,status,provider_subscription_id,amount_cents,frequency,frequency_type,current_period_end) VALUES ('local',?,?,'premium-monthly','authorized','test-subscription',1990,1,'months',datetime('now','+1 month'))").run(user.openId, provider);
  };
  const cancelled = () => db.prepare("SELECT cancelled_at FROM subscriptions WHERE id='local'").get()?.cancelled_at;
  try {
    await t.test("autenticação obrigatória e resposta privada", async () => {
      assert.equal((await GET(new NextRequest("http://localhost/api/account/profile"))).status, 401);
      assert.equal((await PATCH(new NextRequest("http://localhost/api/account/profile", { method: "PATCH" }))).status, 401);
      assert.equal((await GET(request())).headers.get("cache-control"), "private, no-store");
    });
    await t.test("histórico fica na sessão e uso gratuito pertence à conta", async () => {
      const data = await snapshot(); assert.equal(data.usage, 1); assert.equal(data.storageAvailable, true);
      assert.deepEqual(data.recent.map((item: { id: string }) => item.id), ["own-task"]);
      assert.equal(data.user.email, user.email); assert.equal(data.user.provider, "Google");
      assert.equal(JSON.stringify(data).includes("other@example.invalid"), false);
    });
    await t.test("rejeita alteração de identidade, plano, ferramenta inexistente e controle", async () => {
      for (const body of [{ ...prefs, email: "other@example.invalid" }, { ...prefs, openId: "other" }, { ...prefs, plan: "premium" }, { ...prefs, preferredTool: "missing" }, { ...prefs, displayName: "a\nb" }]) assert.equal((await PATCH(request("PATCH", body))).status, 422);
      assert.equal((await PATCH(request("PATCH", prefs, "https://evil.invalid"))).status, 403);
      assert.equal((await PATCH(request("PATCH", { ...prefs, displayName: "x".repeat(5000) }))).status, 413);
    });
    await t.test("salva preferências, renova sessão e mantém e-mail e outra conta", async () => {
      const response = await PATCH(request("PATCH", prefs)); assert.equal(response.status, 200);
      const token = response.cookies.get(SESSION_COOKIE)?.value; assert.ok(token);
      const claims = readSessionToken(token); assert.equal(claims?.name, prefs.displayName); assert.equal(claims?.email, user.email); assert.equal(claims?.openId, user.openId);
      assert.equal((await snapshot()).preferences.displayName, prefs.displayName);
      assert.equal((await (await me(request())).json()).user.name, prefs.displayName);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_preferences WHERE open_id='other'").get()?.n, 0);
    });
    await t.test("falha de banco não anuncia gravação e preserva o nome anterior", async () => {
      failWrites = true; assert.equal((await PATCH(request("PATCH", { ...prefs, displayName: "Não gravar" }))).status, 503); failWrites = false;
      assert.equal((await snapshot()).preferences.displayName, prefs.displayName);
    });
    await t.test("cookie de tarefas inválido é substituído e sinalizado como novo", () => {
      const context = getSessionContext(new NextRequest("http://localhost", { headers: { cookie: "pdfmaster_session=bad" } }));
      assert.equal(context.isNew, true); assert.match(context.token, /^[a-f0-9]{64}$/);
      assert.equal(getSessionContext(request()).isNew, false);
    });
    await t.test("consulta de cobrança indisponível não inventa plano grátis", async () => {
      failBillingReads = true; assert.equal((await snapshot()).plan, null); failBillingReads = false;
    });
    await t.test("logout por POST valida origem e apaga ambas as sessões", () => {
      assert.equal(logoutGet().status, 405);
      assert.equal(logout(request("POST", undefined, "https://evil.invalid")).status, 403);
      const response = logout(request("POST")); assert.equal(response.status, 303);
      for (const name of [SESSION_COOKIE, "pdfmaster_session"]) assert.equal(response.cookies.get(name)?.maxAge, 0);
    });
    for (const failure of ["unavailable", "unconfirmed", "wrong-id"]) await t.test(`cancelamento ${failure}: não grava falso sucesso`, async () => {
      seedSubscription(); if (failure === "unavailable") providerStatus = 503;
      if (failure === "unconfirmed") providerResult.status = "authorized";
      if (failure === "wrong-id") providerResult.id = "another-id";
      assert.equal((await cancel(request("POST"))).status, 502); assert.equal(cancelled(), null); assert.equal(providerCalls, 1);
    });
    await t.test("cancelamento confirmado preserva período pago", async () => {
      seedSubscription(); assert.equal((await cancel(request("POST"))).status, 200); assert.ok(cancelled());
      assert.equal(db.prepare("SELECT status FROM subscriptions WHERE id='local'").get()?.status, "authorized");
    });
    await t.test("compra avulsa não chama provedor; origem inválida não cancela", async () => {
      seedSubscription("mercadopago-checkout"); assert.equal((await cancel(request("POST", undefined, "https://evil.invalid"))).status, 403); assert.equal(cancelled(), null);
      assert.equal((await cancel(request("POST"))).status, 200); assert.equal(providerCalls, 0);
    });
    await t.test("erro local após confirmação não retorna sucesso", async () => {
      seedSubscription(); failWrites = true; assert.equal((await cancel(request("POST"))).status, 503); assert.equal(cancelled(), null); failWrites = false;
    });
    await t.test("sem armazenamento não inventa plano, uso ou confirmação de gravação", async () => {
      delete process.env.DATABASE_URL; await closeDb(); const data = await snapshot();
      assert.equal(data.storageAvailable, false); assert.equal(data.plan, null); assert.equal(data.usage, null);
      assert.equal((await PATCH(request("PATCH", prefs))).status, 503);
    });
  } finally {
    globalThis.fetch = oldFetch; neonConfig.fetchFunction = oldNeon;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env);
    await closeDb(); db.close();
  }
});
