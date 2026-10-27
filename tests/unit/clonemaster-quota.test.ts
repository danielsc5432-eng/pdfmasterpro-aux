import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { NextRequest } from "next/server";
import { createCloneQuotaHandler } from "../../lib/clonemaster/quota";
import { FREE_PLAN, PLANS } from "../../lib/plans";
import { createSessionToken, SESSION_COOKIE } from "../../lib/auth/session";
import { deviceContext, DEVICE_COOKIE } from "../../lib/security/abuse";
import { reserveFreeTask } from "../../lib/security/quotas";
import type { query as Query } from "../../lib/db";

test("CloneMaster: cota compartilhada persistente de 24 horas", async t => {
  const saved = { ...process.env };
  Object.assign(process.env, { AUTH_SESSION_SECRET: "isolated-clone-quota-test", NEXT_PUBLIC_SITE_URL: "http://localhost" });
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "ANTI_ABUSE_SECRET", "VERCEL", "PROCESSING_WORKER_ONLY", "TESTING_QUOTA_EMAIL"]) delete process.env[key];
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE abuse_budgets (actor_hash TEXT PRIMARY KEY, window_start TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, used INTEGER NOT NULL)");
  const query: typeof Query = async <T>(text: string, params: unknown[] = []) => db.prepare(text.replace(/CURRENT_TIMESTAMP - INTERVAL '24 hours'/g, "datetime('now','-24 hours')").replace(/CURRENT_TIMESTAMP - INTERVAL '7 days'/g, "datetime('now','-7 days')")).all(...params as SQLInputValue[]) as T[];
  const request = (cookie = "", headers: Record<string,string> = {}, body?: string) => new NextRequest("http://localhost/api/clonemaster/quota", { method: "POST", headers: { origin: "http://localhost", cookie, ...headers }, ...(body ? { body } : {}) });
  const token = (email = "user@example.invalid") => `${SESSION_COOKIE}=${createSessionToken({ openId: email, name: "Test user", email })}`;
  const device = deviceContext(request());
  const cookie = token() + `; ${DEVICE_COOKIE}=${device.token}`;
  let reserveCalls = 0;
  const reserve: typeof reserveFreeTask = async input => { reserveCalls++; return reserveFreeTask(input, query); };
  const handler = createCloneQuotaHandler({ configured: () => true, entitlements: async () => ({ plan: FREE_PLAN, source: "free", subscription: null }), reserve });
  t.beforeEach(() => { db.exec("DELETE FROM abuse_budgets"); reserveCalls = 0; });
  try {
    await t.test("permite dez lotes e bloqueia o décimo primeiro sem enviar documentos", async () => {
      for (let i = 0; i < 10; i++) { const response = await handler(request(cookie)); assert.equal(response.status, 200); assert.equal((await response.json()).limit, 10); }
      const denied = await handler(request(cookie)); assert.equal(denied.status, 429); assert.match((await denied.json()).error, /compartilha/);
    });
    await t.test("consome o mesmo orçamento das demais ferramentas", async () => {
      for (let i = 0; i < 9; i++) assert.equal(await reserveFreeTask({ email: "user@example.invalid", device: device.id, ip: null, limit: 10 }, query), null);
      assert.equal((await handler(request(cookie))).status, 200);
      assert.equal(await reserveFreeTask({ email: "user@example.invalid", device: device.id, ip: null, limit: 10 }, query), "account");
    });
    await t.test("trocar de conta não renova a cota do mesmo navegador", async () => {
      for (let i = 0; i < 10; i++) assert.equal((await handler(request(cookie))).status, 200);
      const other = token("other@example.invalid") + `; ${DEVICE_COOKIE}=${device.token}`;
      assert.equal((await handler(request(other))).status, 429);
    });
    await t.test("visitante recebe cookie assinado e continua limitado", async () => {
      const first = await handler(request()); const issued = first.cookies.get(DEVICE_COOKIE); assert.ok(issued?.httpOnly);
      const anonymous = `${DEVICE_COOKIE}=${issued!.value}`;
      for (let i = 1; i < 10; i++) assert.equal((await handler(request(anonymous))).status, 200);
      assert.equal((await handler(request(anonymous))).status, 429);
    });
    await t.test("renova orçamento depois da janela de 24 horas", async () => {
      for (let i = 0; i < 10; i++) await handler(request(cookie));
      db.exec("UPDATE abuse_budgets SET window_start=datetime('now','-25 hours')");
      assert.equal((await handler(request(cookie))).status, 200);
      assert.equal(db.prepare("SELECT MAX(used) AS used FROM abuse_budgets").get()?.used, 1);
    });
    await t.test("Premium verificado no servidor não reserva cota gratuita", async () => {
      const premium = createCloneQuotaHandler({ configured: () => true, entitlements: async (id, strict) => { assert.equal(id, "user@example.invalid"); assert.equal(strict, true); return { plan: PLANS[1], source: "subscription", subscription: null }; }, reserve });
      const response = await premium(request(cookie)); assert.equal(response.status, 200); assert.equal((await response.json()).limit, null); assert.equal(reserveCalls, 0);
    });
    await t.test("plano enviado pelo cliente não libera uso ilimitado", async () => {
      const response = await handler(request(cookie, { "x-pdfmaster-plan": "premium-monthly" })); assert.equal((await response.json()).limit, 10); assert.equal(reserveCalls, 1);
    });
    await t.test("origem inválida, upload e chamada no worker não consomem cota", async () => {
      assert.equal((await handler(request(cookie, { origin: "https://other.invalid" }))).status, 403);
      assert.equal((await handler(request(cookie, { origin: "" }))).status, 403);
      assert.equal((await handler(request(cookie, { "content-length": "10" }, "file-data"))).status, 400);
      process.env.PROCESSING_WORKER_ONLY = "1"; assert.equal((await handler(request(cookie))).status, 403); delete process.env.PROCESSING_WORKER_ONLY;
      assert.equal(reserveCalls, 0);
    });
    await t.test("falha de banco ou assinatura não autoriza geração", async () => {
      const missing = createCloneQuotaHandler({ configured: () => false }); assert.equal((await missing(request(cookie))).status, 503);
      const failed = createCloneQuotaHandler({ configured: () => true, entitlements: async () => { throw Error("database failure"); }, reserve }); assert.equal((await failed(request(cookie))).status, 503); assert.equal(reserveCalls, 0);
    });
    await t.test("produção exige IP fornecido pela Vercel", async () => {
      process.env.VERCEL = "1";
      assert.equal((await handler(request(cookie, { "x-forwarded-for": "192.0.2.1" }))).status, 503);
      assert.equal((await handler(request(cookie, { "x-vercel-forwarded-for": "192.0.2.1" }))).status, 200);
      delete process.env.VERCEL;
    });
  } finally { db.close(); process.env = saved; }
});
