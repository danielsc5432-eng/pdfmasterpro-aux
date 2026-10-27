import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, registrationSchema } from "../../lib/auth/password";
import { verificationHash } from "../../lib/auth/local-accounts";
import { POST } from "../../app/api/auth/local/[action]/route";
import { NextRequest } from "next/server";

test("cadastro: senha protegida com sal aleatório e comparação correta", async () => {
  const password = "Uma frase longa e privada 123!";
  const first = await hashPassword(password); const second = await hashPassword(password);
  assert.notEqual(first, second); assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true); assert.equal(await verifyPassword("Outra senha diferente 123", first), false);
  assert.equal(await verifyPassword(password, "hash-inválido"), false);
});
test("cadastro: nome, e-mail normalizado, senha e consentimento são obrigatórios", () => {
  const sample = { name: "Pessoa Teste", email: "PESSOA@example.com", password: "Minha frase de acesso 123", terms: true };
  assert.equal(registrationSchema.parse(sample).email, "pessoa@example.com");
  for (const changes of [{ name: "x" }, { name: "Pessoa\u0000Teste" }, { email: "inválido" }, { password: "curta" }, { password: "x".repeat(129) }, { terms: false }, { role: "admin" }]) assert.equal(registrationSchema.safeParse({ ...sample, ...changes }).success, false);
});
test("cadastro: confirmação é vinculada ao e-mail e não guarda o código em texto", () => {
  const original = process.env.AUTH_SESSION_SECRET; const manus = process.env.MANUS_JWT_SECRET;
  process.env.AUTH_SESSION_SECRET = "isolated-test-secret"; delete process.env.MANUS_JWT_SECRET;
  try { const hash = verificationHash("pessoa@example.com", "123456"); assert.equal(hash.length, 64); assert.notEqual(hash, verificationHash("outra@example.com", "123456")); assert.notEqual(hash, verificationHash("pessoa@example.com", "654321")); }
  finally { if (original === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = original; if (manus !== undefined) process.env.MANUS_JWT_SECRET = manus; }
});
test("cadastro: endpoint recusa origem externa, ação desconhecida e configuração ausente", async () => {
  const env = { ...process.env }; process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3300"; delete process.env.DATABASE_URL;
  try {
    const req = (origin: string) => new NextRequest("http://localhost:3300/api/auth/local/register", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: "{}" });
    assert.equal((await POST(req("https://externo.example"), { params: Promise.resolve({ action: "register" }) })).status, 403);
    assert.equal((await POST(req("http://localhost:3300"), { params: Promise.resolve({ action: "admin" }) })).status, 404);
    assert.equal((await POST(req("http://localhost:3300"), { params: Promise.resolve({ action: "register" }) })).status, 503);
  } finally { process.env = env; }
});
