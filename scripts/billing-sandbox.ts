import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { neonConfig } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { POST as checkout } from "../app/api/billing/checkout/route";
import { POST as webhook } from "../app/api/billing/webhook/route";
import { GET as billingStatus } from "../app/api/billing/me/route";
import { createSessionToken, SESSION_COOKIE } from "../lib/auth/session";
import { getPreapproval } from "../lib/billing/mercadopago";

type State = { openId: string; origin?: string; buyerEmail?: string; subscriptionId?: string; checkoutUrl?: string };
const stateFile = ".vercel/billing-sandbox-state.json";
const credentials = parseEnv(readFileSync(".env.billing-test", "utf8"));
const token = credentials.MERCADOPAGO_ACCESS_TOKEN?.trim();
const secret = credentials.MERCADOPAGO_WEBHOOK_SECRET?.trim();
if (!token || !secret) throw new Error("Preencha as credenciais de teste em .env.billing-test.");
// Never inherit a production DB, session or worker from the shell or .env files.
process.env.MERCADOPAGO_ACCESS_TOKEN = token;
process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
process.env.DATABASE_URL = "postgresql://local:local@billing-sandbox.invalid/test";
process.env.AUTH_SESSION_SECRET = randomBytes(32).toString("hex");
delete process.env.MANUS_JWT_SECRET;
delete process.env.MANUS_PROJECT_ID;
delete process.env.PROCESSING_WORKER_URL;
delete process.env.BILLING_SIGNING_SECRET;
mkdirSync(".vercel", { recursive: true });
const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { openId: "sandbox:" + randomUUID() };
if (!state.openId.startsWith("sandbox:")) throw new Error("Identificador de teste inválido.");
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
save();
const database = new DatabaseSync(".vercel/billing-sandbox.sqlite");
database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
database.exec(readFileSync("db/migrations/003_billing.sql", "utf8"));
neonConfig.fetchFunction = async (_url: string, init: RequestInit) => {
  const { query, params } = JSON.parse(String(init.body)) as { query: string; params: SQLInputValue[] };
  const rows = database.prepare(query.replace(/\$\d+/g, "?")).all(...params) as Record<string, unknown>[];
  const names = rows.length ? Object.keys(rows[0]) : [];
  return Response.json({ fields: names.map((name) => ({ name, dataTypeID: name.endsWith("_at") || name === "current_period_end" ? 1184 : 25 })), rows: rows.map((row) => names.map((name) => row[name])), rowCount: rows.length, command: query.split(" ")[0] });
};

async function checkTestAccount() {
  const response = await fetch("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const account = await response.json().catch(() => ({})) as { tags?: string[]; site_id?: string; email?: string };
  if (!response.ok) throw new Error(`Credencial recusada pelo Mercado Pago (HTTP ${response.status}).`);
  if (!account.tags?.includes("test_user") || account.site_id !== "MLB") throw new Error("Operação bloqueada: a credencial deve pertencer a uma conta brasileira de teste.");
  return account;
}
function statusRequest() {
  if (!state.buyerEmail) throw new Error("Comprador de teste ainda não definido.");
  const cookie = `${SESSION_COOKIE}=${createSessionToken({ openId: state.openId, email: state.buyerEmail, name: "Comprador sandbox" })}`;
  return new NextRequest("http://127.0.0.1:3101/api/billing/me", { headers: { cookie } });
}
async function main() {
  const [command = "check", argument] = process.argv.slice(2);
  const account = await checkTestAccount();
  if (command === "check") { console.log(JSON.stringify({ credentialAccepted: true, isTestUser: true, country: account.site_id, secretPresent: true })); return; }
  if (command === "origin") {
    const url = new URL(argument);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".trycloudflare.com") || url.pathname !== "/") throw new Error("Informe a origem HTTPS do túnel temporário trycloudflare.com.");
    state.origin = url.origin; save(); console.log("Webhook de teste: " + state.origin + "/api/billing/webhook"); return;
  }
  if (command === "create") {
    if (!state.origin) throw new Error("Configure primeiro a origem HTTPS do receptor de teste.");
    if (!argument || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(argument)) throw new Error("Informe o e-mail do comprador de teste.");
    if (argument.toLowerCase() === account.email?.toLowerCase()) throw new Error("Comprador e vendedor de teste devem ser contas diferentes.");
    if (state.subscriptionId) { console.log(JSON.stringify({ existingCheckout: true, checkoutUrl: state.checkoutUrl, subscriptionId: state.subscriptionId })); return; }
    state.buyerEmail = argument; save();
    process.env.NEXT_PUBLIC_SITE_URL = state.origin;
    const request = statusRequest();
    const response = await checkout(new NextRequest(state.origin + "/api/billing/checkout?plan=premium-monthly", { method: "POST", headers: { cookie: request.headers.get("cookie")! } }));
    const result = await response.json() as { error?: string; initPoint?: string };
    if (!response.ok || !result.initPoint) throw new Error(result.error || "O checkout de teste não foi gerado.");
    const row = database.prepare("SELECT provider_subscription_id FROM subscriptions WHERE open_id = ? ORDER BY created_at DESC LIMIT 1").get(state.openId);
    state.subscriptionId = String(row?.provider_subscription_id || "");
    state.checkoutUrl = result.initPoint; save();
    console.log(JSON.stringify({ checkoutUrl: state.checkoutUrl, subscriptionId: state.subscriptionId, mode: "test-account-only", plan: "premium-monthly" })); return;
  }
  if (command === "status") {
    const provider = state.subscriptionId ? await getPreapproval(state.subscriptionId) : null;
    const local = state.buyerEmail ? await (await billingStatus(statusRequest())).json() as { planId: string; limits: { premiumTools: boolean } } : null;
    const event = database.prepare("SELECT COUNT(*) AS count FROM billing_events").get();
    console.log(JSON.stringify({ providerStatus: provider?.status ?? "not-created", localPlan: local?.planId ?? "not-created", premiumTools: local?.limits.premiumTools ?? false, receivedSignedNotifications: Number(event?.count || 0) })); return;
  }
  if (command !== "serve") throw new Error("Comandos: check, origin <https-url>, serve, create <email>, status.");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1:3101");
    if (request.method === "GET" && url.pathname === "/health") { response.setHeader("content-type", "application/json"); response.end('{"ok":true,"mode":"billing-test"}'); return; }
    if (request.method === "GET" && url.pathname === "/precos/obrigado") { response.setHeader("content-type", "text/html; charset=utf-8"); response.end("<!doctype html><html lang='pt-BR'><title>Retorno do teste</title><h1>Retorno do checkout de teste</h1><p>Volte ao chat para verificarmos a confirmação do Mercado Pago e o acesso Premium no ambiente isolado.</p></html>"); return; }
    if (request.method !== "POST" || url.pathname !== "/api/billing/webhook") { response.statusCode = 404; response.end("Not found"); return; }
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const chunk of request) { size += chunk.length; if (size > 65536) { response.statusCode = 413; response.end("Payload too large"); return; } chunks.push(Buffer.from(chunk)); }
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const result = await webhook(new NextRequest("http://127.0.0.1:3101" + url.pathname + url.search, { method: "POST", headers, body: Buffer.concat(chunks) }));
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
      console.log(JSON.stringify({ webhookStatus: result.status, at: new Date().toISOString() }));
    } catch { response.statusCode = 500; response.end("Sandbox processing failed"); }
  });
  await new Promise<void>((resolve) => server.listen(3101, "127.0.0.1", resolve));
  console.log("Receptor isolado pronto em http://127.0.0.1:3101. Apenas /health, /precos/obrigado e o webhook ficam disponíveis pelo túnel.");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.close(); database.close(); process.exit(0); });
}
main().then(() => { if (process.argv[2] !== "serve") database.close(); }).catch((error) => {
  let message = error instanceof Error ? error.message : "Falha no ambiente de teste.";
  for (const value of [token, secret]) if (value) message = message.split(value).join("[REDACTED]");
  console.error(message); database.close(); process.exitCode = 1;
});
