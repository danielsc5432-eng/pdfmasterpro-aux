import test from "node:test";
import assert from "node:assert/strict";
import { ticketSchema, ticketText, supportGuidance, supportTopics } from "../../lib/support-chat";
import { deliverSupport } from "../../lib/support-delivery";
import { POST } from "../../app/api/support/ticket/route";
import { NextRequest } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "../../lib/auth/session";

const sample = { requestId: "b7e0bc3a-051e-4eb0-98f5-33273f143601", topic: "CloneMaster AI", tool: "CloneMaster AI", description: "A coluna de salário não foi encontrada na planilha.", environment: "Chrome no Windows, XLSX de 20 KB", attempted: "Conferi a aba e o cabeçalho.", consent: true };

test("atendimento: valida revisão, limites e consentimento sem permitir destinatário arbitrário", () => {
  assert.ok(ticketSchema.safeParse(sample).success);
  for (const changes of [{ consent: false }, { description: "curto" }, { tool: "x" }, { description: "x".repeat(3001) }, { to: "outro@example.com" }, { requestId: "inválido" }]) assert.equal(ticketSchema.safeParse({ ...sample, ...changes }).success, false);
});
test("atendimento: orientações especializadas e resumo preservam os dados sem executar conteúdo", () => {
  for (const topic of supportTopics) assert.ok(supportGuidance(topic).length > 50);
  const ticket = ticketSchema.parse({ ...sample, description: "<script>alert('teste')</script>" });
  const text = ticketText(ticket, { name: "Pessoa Teste", email: "pessoa@example.com" }, "PROTOCOLO");
  assert.ok(text.includes(ticket.description)); assert.ok(text.includes("PROTOCOLO")); assert.ok(text.includes("pessoa@example.com"));
});
test("atendimento: transporte real usa destino fixo, reply_to e idempotência; falha não vira sucesso", async () => {
  const saved = { ...process.env };
  try {
    process.env.SUPPORT_EMAIL = "suporte@example.com"; process.env.SUPPORT_FROM_EMAIL = "atendimento@example.com"; process.env.RESEND_API_KEY = "test-not-real";
    let count = 0;
    const transport: typeof fetch = async (url, options) => {
      count++; assert.equal(url, "https://api.resend.com/emails");
      const body = JSON.parse(options!.body as string); assert.deepEqual(body.to, ["suporte@example.com"]); assert.equal(body.reply_to, "pessoa@example.com"); assert.equal(body.text, "Resumo");
      assert.equal(new Headers(options!.headers).get("Idempotency-Key"), "support/PROTOCOLO");
      return Response.json({ id: "provider-test-id" });
    };
    assert.equal(await deliverSupport("Resumo", "pessoa@example.com", "PROTOCOLO", transport), "provider-test-id"); assert.equal(count, 1);
    await assert.rejects(deliverSupport("Resumo", "pessoa@example.com", "PROTOCOLO", async () => Response.json({ error: "bad" }, { status: 429 })));
    await assert.rejects(deliverSupport("Resumo", "pessoa@example.com", "PROTOCOLO", async () => Response.json({})));
    delete process.env.RESEND_API_KEY;
    await assert.rejects(deliverSupport("Resumo", "pessoa@example.com", "PROTOCOLO", transport)); assert.equal(count, 1);
  } finally { process.env = saved; }
});
test("atendimento: endpoint bloqueia visitante, origem externa e configuração ausente", async () => {
  const saved = { ...process.env };
  try {
    process.env.AUTH_SESSION_SECRET = "support-tests-isolated-secret"; delete process.env.MANUS_JWT_SECRET; delete process.env.MANUS_PROJECT_ID;
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3100"; delete process.env.RESEND_API_KEY;
    const token = createSessionToken({ openId: "google:support-test", email: "pessoa@example.com", name: "Pessoa Teste" });
    const request = (origin: string, auth = true) => new NextRequest("http://localhost:3100/api/support/ticket", { method: "POST", headers: { origin, "Content-Type": "application/json", ...(auth ? { Cookie: `${SESSION_COOKIE}=${token}` } : {}) }, body: JSON.stringify(sample) });
    assert.equal((await POST(request("http://localhost:3100", false))).status, 401);
    assert.equal((await POST(request("https://externo.example"))).status, 403);
    const unavailable = await POST(request("http://localhost:3100")); assert.equal(unavailable.status, 503); assert.ok(!(await unavailable.json()).sent);
  } finally { process.env = saved; }
});
