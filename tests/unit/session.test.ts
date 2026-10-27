import test from "node:test";
import assert from "node:assert/strict";
import { getPublicOrigin } from "../../lib/auth/session";

/**
 * O apex responde 308 para o www, e tanto o Mercado Pago (webhook) quanto o
 * Google (callback OAuth) recusam redirecionamento: o webhook exige 200/201 e o
 * redirect_uri precisa bater exatamente. Por isso a origem pública é sempre o www.
 */

function requestWith(headers: Record<string, string>) {
  return { headers: new Headers(headers) } as Parameters<typeof getPublicOrigin>[0];
}

test("normaliza o apex configurado para o domínio canônico www", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://pdfmasterpro.com.br";
  try {
    assert.equal(getPublicOrigin(requestWith({})), "https://www.pdfmasterpro.com.br");
  } finally {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  }
});

test("preserva o www e remove a barra final", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.pdfmasterpro.com.br/";
  try {
    assert.equal(getPublicOrigin(requestWith({})), "https://www.pdfmasterpro.com.br");
  } finally {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  }
});

test("não confunde domínios que apenas começam com o nome do site", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://pdfmasterpro.com.br.evil.test";
  try {
    assert.equal(getPublicOrigin(requestWith({})), "https://pdfmasterpro.com.br.evil.test");
  } finally {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  }
});

test("normaliza a origem derivada dos cabeçalhos de proxy", () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  const origin = getPublicOrigin(requestWith({ "x-forwarded-proto": "https", "x-forwarded-host": "pdfmasterpro.com.br" }));
  assert.equal(origin, "https://www.pdfmasterpro.com.br");
  assert.equal(`${origin}/api/billing/webhook`, "https://www.pdfmasterpro.com.br/api/billing/webhook");
});

test("a origem de desenvolvimento permanece intacta", () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  const origin = getPublicOrigin(requestWith({ "x-forwarded-proto": "http", host: "localhost:3000" }));
  assert.equal(origin, "http://localhost:3000");
});
