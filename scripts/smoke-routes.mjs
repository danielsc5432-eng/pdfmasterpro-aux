import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3100";
const catalog = await readFile(new URL("../lib/tools/catalog.ts", import.meta.url), "utf8");
const legalSuite = await readFile(new URL("../lib/legal/suite-config.ts", import.meta.url), "utf8");
const legalSlugs=[...legalSuite.matchAll(/slug:"([^"]+)"/g)].map(match=>match[1]);
const pages = ["/", "/ferramentas", "/juridico", "/painel", "/perfil", "/historico", "/precos", "/precos/obrigado", "/configuracoes", "/entrar", "/criar-conta", "/contato", "/privacidade", "/termos", "/robots.txt", "/sitemap.xml", "/ads.txt", "/api/health", "/api/billing/me", ...[...catalog.matchAll(/slug: "([^"]+)"/g)].map((match) => "/ferramentas/" + match[1])];
let passed = 0;
async function check(route, status, init) {
  const response = await fetch(base + route, { redirect: "manual", ...init });
  assert.equal(response.status, status, route);
  console.log("PASS " + status + " " + route);
  passed++;
  return response;
}
for (const route of [...pages, "/icon", "/apple-icon"]) await check(route, 200);
for(const slug of legalSlugs){await check("/ferramentas/"+slug,200);await check("/api/v1/process?tool="+slug,400,{method:"POST"});}
await check("/api/auth/me", 401);
await check("/api/account/profile", 401);
await check("/api/account/profile", 401, { method: "PATCH" });
await check("/api/auth/logout", 405);
await check("/ferramentas/inexistente", 404);
for (const route of ["/api/billing/checkout", "/api/billing/checkout-once", "/api/billing/cancel"]) await check(route, 401, { method: "POST" });
// Run only against an isolated server without a webhook secret, or with an invalid signature.
await check("/api/billing/webhook", 401, { method: "POST", headers: { "x-signature": "ts=123,v1=invalid" } });
for (const slug of ["ocr-pdf", "redigir-pdf"]) await check("/api/v1/process?tool=" + slug, 402, { method: "POST" });
await check("/api/v1/process?tool=girar-pdf", process.env.SMOKE_NO_DATABASE === "1" ? 503 : 400, { method: "POST", body: new FormData() });
await check("/api/summary/capabilities", 200);
await check("/api/clonemaster/quota", 405);
await check("/api/legal/quota", 405);
await check("/api/legal/ai", 200);
await check("/api/legal/ai", 403, { method:"POST", headers:{origin:"https://invalid.example","content-type":"application/json"},body:"{}" });
await check("/api/v1/process?tool=pdf-timemachine-juridico", 400, { method: "POST" });
await check("/api/legal/quota", 403, { method: "POST", headers: { origin: "https://invalid.example" } });
await check("/api/clonemaster/quota", 403, { method: "POST", headers: { origin: "https://invalid.example" } });
await check("/api/v1/process?tool=resumir-pdf-ia", 401, { method: "POST", body: new FormData() });
await check("/api/v1/process?tool=inexistente", 404, { method: "POST" });
const search = await check("/ferramentas?busca=termo-sem-resultado-12345", 200);
assert.match(await search.text(), /Nenhuma ferramenta encontrada/);
console.log(passed + " route checks passed.");
