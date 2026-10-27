import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { neonConfig } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { POST as webhook } from "../../app/api/billing/webhook/route";
import { GET as billingStatus } from "../../app/api/billing/me/route";
import { POST as processFile } from "../../app/api/v1/process/route";
import { createSessionToken, SESSION_COOKIE } from "../../lib/auth/session";
import { closeDb } from "../../lib/db";
import { createSubscription } from "../../lib/db/subscriptions";
import { getPlan, type PlanId } from "../../lib/plans";

// Real route handlers, session signatures, SQL queries and access checks.
// Only external boundaries are replaced: Mercado Pago responses and PostgreSQL
// HTTP transport. SQLite is disposable and no network request is permitted.
test("assinatura: webhook → persistência isolada → plano da conta → acesso Premium", async (t) => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("db/migrations/003_billing.sql", "utf8"));
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalNeonFetch = neonConfig.fetchFunction;
  const fixtures = new Map<string, Record<string, unknown>>();
  const providerRequests: string[] = [];
  let failWrites = false;
  process.env.DATABASE_URL = "postgresql://local:local@billing-test.invalid/test";
  process.env.MERCADOPAGO_ACCESS_TOKEN = "local-test-provider";
  process.env.MERCADOPAGO_WEBHOOK_SECRET = "local-test-webhook";
  process.env.AUTH_SESSION_SECRET = "local-test-session";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost";
  delete process.env.MANUS_JWT_SECRET;
  delete process.env.MANUS_PROJECT_ID;
  delete process.env.PROCESSING_WORKER_URL;
  await closeDb();
  const user = { openId: "local-billing-user", email: "billing@example.invalid", name: "Local billing test" };
  const cookie = `${SESSION_COOKIE}=${createSessionToken(user)}`;

  neonConfig.fetchFunction = async (_url: string, init: RequestInit) => {
    const { query, params } = JSON.parse(String(init.body)) as { query: string; params: SQLInputValue[] };
    if (failWrites && /^UPDATE subscriptions/i.test(query)) throw new Error("Simulated persistence outage");
    const statement = database.prepare(query.replace(/\$\d+/g, "?"));
    const rows = statement.all(...params) as Record<string, unknown>[];
    const names = rows.length ? Object.keys(rows[0]) : [];
    return Response.json({ fields: names.map((name) => ({ name, dataTypeID: name.endsWith("_at") || name === "current_period_end" ? 1184 : 25 })), rows: rows.map((row) => names.map((name) => row[name])), rowCount: rows.length, command: query.split(" ")[0] });
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://api.mercadopago.com", "Unexpected network attempt blocked");
    assert.equal(init?.method ?? "GET", "GET", "Provider mutations are not permitted in this test");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer local-test-provider");
    providerRequests.push(url.pathname);
    const fixture = fixtures.get(url.pathname);
    return fixture ? Response.json(fixture) : Response.json({ message: "Test resource unavailable" }, { status: 503 });
  }) as typeof fetch;

  const reset = () => { database.exec("DELETE FROM subscriptions; DELETE FROM billing_events;"); fixtures.clear(); providerRequests.length = 0; failWrites = false; };
  const seed = async (provider = "mercadopago", providerId = "sub-local-1", planId: PlanId = "premium-monthly") => {
    const selected = getPlan(planId);
    assert.ok(await createSubscription({ openId: user.openId, payerEmail: user.email, planId, provider, providerSubscriptionId: providerId, amountCents: selected.priceCents, frequency: selected.interval === "year" ? 12 : 1, frequencyType: "months" }));
  };
  const plan = async () => (await (await billingStatus(new NextRequest("http://localhost/api/billing/me", { headers: { cookie } }))).json()) as { planId: string; limits: { premiumTools: boolean } };
  const notify = async (type: string, id: string, valid = true, queryType = type) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = "local-webhook-request";
    const signature = createHmac("sha256", process.env.MERCADOPAGO_WEBHOOK_SECRET!).update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
    return webhook(new NextRequest(`http://localhost/api/billing/webhook?type=${queryType}&data.id=${id}`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${valid ? signature : "0".repeat(64)}` }, body: JSON.stringify({ type, data: { id } }) }));
  };
  const subscription = (status: string) => ({ id: "sub-local-1", status, external_reference: user.openId, auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 19.9, currency_id: "BRL", next_payment_date: new Date(Date.now() + 30 * 86400000).toISOString() } });

  try {
    await t.test("simulador com tipo divergente na URL usa o recurso do corpo e valida assinatura", async () => {
      reset(); await seed(); fixtures.set("/preapproval/sub-local-1", subscription("authorized"));
      assert.equal((await notify("subscription_preapproval", "sub-local-1", false, "subscription_authorized_payment")).status, 401);
      assert.equal(providerRequests.length, 0);
      assert.equal((await notify("subscription_preapproval", "sub-local-1", true, "subscription_authorized_payment")).status, 200);
      assert.deepEqual(providerRequests, ["/preapproval/sub-local-1"]);
      assert.equal((await plan()).planId, "premium-monthly");
    });
    await t.test("pendente não libera Premium", async () => { reset(); await seed(); fixtures.set("/preapproval/sub-local-1", subscription("pending")); assert.equal((await notify("subscription_preapproval", "sub-local-1")).status, 200); assert.equal((await plan()).planId, "free"); });
    await t.test("aprovação persistida libera Premium e atravessa o bloqueio de ferramenta", async () => {
      reset(); await seed();
      const before = await processFile(new NextRequest("http://localhost/api/v1/process?tool=ocr-pdf", { method: "POST", headers: { cookie } }));
      assert.equal(before.status, 402);
      fixtures.set("/preapproval/sub-local-1", subscription("authorized"));
      assert.equal((await notify("subscription_preapproval", "sub-local-1")).status, 200);
      const status = await plan(); assert.equal(status.planId, "premium-monthly"); assert.equal(status.limits.premiumTools, true);
      const after = await processFile(new NextRequest("http://localhost/api/v1/process?tool=ocr-pdf", { method: "POST", headers: { cookie } }));
      assert.equal(after.status, 400, "Premium passes access gate and reaches missing-file validation");
    });
    await t.test("assinatura inválida não consulta provedor nem altera a conta", async () => { reset(); await seed(); fixtures.set("/preapproval/sub-local-1", subscription("authorized")); assert.equal((await notify("subscription_preapproval", "sub-local-1", false)).status, 401); assert.equal(providerRequests.length, 0); assert.equal((await plan()).planId, "free"); });
    await t.test("plano anual aprovado libera o plano anual correto", async () => {
      reset(); await seed("mercadopago", "sub-local-1", "premium-annual");
      const annual = subscription("authorized"); annual.auto_recurring.frequency = 12; annual.auto_recurring.transaction_amount = 149.9;
      annual.auto_recurring.next_payment_date = new Date(Date.now() + 365 * 86400000).toISOString();
      fixtures.set("/preapproval/sub-local-1", annual);
      assert.equal((await notify("subscription_preapproval", "sub-local-1")).status, 200);
      assert.equal((await plan()).planId, "premium-annual");
    });
    await t.test("benefício aprovado fica restrito à conta compradora", async () => {
      reset(); await seed(); fixtures.set("/preapproval/sub-local-1", subscription("authorized")); await notify("subscription_preapproval", "sub-local-1");
      const anotherCookie = `${SESSION_COOKIE}=${createSessionToken({ ...user, openId: "another-test-user", email: "another@example.invalid" })}`;
      const another = await (await billingStatus(new NextRequest("http://localhost/api/billing/me", { headers: { cookie: anotherCookie } }))).json();
      assert.equal(another.planId, "free"); assert.equal((await plan()).planId, "premium-monthly");
    });
    for (const status of ["paused", "cancelled", "finished"]) await t.test(`${status} remove o acesso`, async () => { reset(); await seed(); fixtures.set("/preapproval/sub-local-1", subscription("authorized")); await notify("subscription_preapproval", "sub-local-1"); fixtures.set("/preapproval/sub-local-1", subscription(status)); await notify("subscription_preapproval", "sub-local-1"); assert.equal((await plan()).planId, "free"); });
    await t.test("pagamento aprovado libera plano, e reenvio não estende o período pago", async () => {
      reset(); await seed("mercadopago-checkout", "preference-local-1");
      const approved = new Date(Date.now() - 2 * 3600000); const expectedEnd = new Date(approved); expectedEnd.setMonth(expectedEnd.getMonth() + 1);
      fixtures.set("/v1/payments/pay-local-1", { id: "pay-local-1", status: "approved", external_reference: user.openId, transaction_amount: 19.9, currency_id: "BRL", date_approved: approved.toISOString() });
      assert.equal((await notify("payment", "pay-local-1")).status, 200); assert.equal((await plan()).planId, "premium-monthly");
      const readEnd = () => String(database.prepare("SELECT current_period_end FROM subscriptions").get()!.current_period_end);
      assert.equal(new Date(readEnd()).toISOString(), expectedEnd.toISOString());
      const first = readEnd(); await notify("payment", "pay-local-1"); assert.equal(readEnd(), first);
    });
    await t.test("pagamento recusado não libera Premium", async () => { reset(); await seed("mercadopago-checkout", "preference-local-1"); fixtures.set("/v1/payments/pay-local-1", { id: "pay-local-1", status: "rejected", external_reference: user.openId, transaction_amount: 19.9, currency_id: "BRL" }); assert.equal((await notify("payment", "pay-local-1")).status, 200); assert.equal((await plan()).planId, "free"); });
    await t.test("valor pago incorreto não libera Premium", async () => { reset(); await seed("mercadopago-checkout", "preference-local-1"); fixtures.set("/v1/payments/pay-local-1", { id: "pay-local-1", status: "approved", external_reference: user.openId, transaction_amount: 0.01, currency_id: "BRL", date_approved: new Date().toISOString() }); await notify("payment", "pay-local-1"); assert.equal((await plan()).planId, "free"); });
    await t.test("moeda incorreta não libera Premium", async () => { reset(); await seed("mercadopago-checkout", "preference-local-1"); fixtures.set("/v1/payments/pay-local-1", { id: "pay-local-1", status: "approved", external_reference: user.openId, transaction_amount: 19.9, currency_id: "USD", date_approved: new Date().toISOString() }); assert.equal((await notify("payment", "pay-local-1")).status, 422); assert.equal((await plan()).planId, "free"); });
    await t.test("falha no provedor pede reenvio em vez de confirmar processamento", async () => { reset(); await seed(); assert.equal((await notify("subscription_preapproval", "sub-local-1")).status, 503); assert.equal((await plan()).planId, "free"); });
    await t.test("falha na gravação não confirma a ativação", async () => { reset(); await seed(); fixtures.set("/preapproval/sub-local-1", subscription("authorized")); failWrites = true; assert.equal((await notify("subscription_preapproval", "sub-local-1")).status, 503); assert.equal((await plan()).planId, "free"); });
  } finally {
    globalThis.fetch = originalFetch; neonConfig.fetchFunction = originalNeonFetch; database.close(); await closeDb();
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
