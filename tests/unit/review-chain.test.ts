import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { semanticReview } from "../../lib/divergences/ai";
import { runReviewChain } from "../../lib/divergences/review-chain";
import type { Finding } from "../../lib/divergences/types";

const findings: Finding[] = [{ id: "finding-1", category: "clause", classification: "possible", title: "Cláusula 1", explanation: "Conferir prazo", confidence: "medium", origin: "rules", documents: ["a", "b"], evidence: ["Pagamento em dez dias", "Pagamento em trinta dias"].map((quote, index) => ({ documentId: index ? "b" : "a", documentName: "confidencial.pdf", page: 1, lineId: "p1:l1", quote, value: quote, box: [0, 0, 100, 10] })) }];
const valid = JSON.stringify({ items: [{ findingId: "finding-1", reason: "obligation" }] });
const keys = ["DIVERGENCE_AI_PROVIDER", "DIVERGENCE_OLLAMA_URL", "DIVERGENCE_OLLAMA_MODEL", "DIVERGENCE_AI_KEY", "DIVERGENCE_TRANSFORMERS_URL", "DIVERGENCE_TRANSFORMERS_MODEL", "DIVERGENCE_TRANSFORMERS_KEY"];
function saveEnv() { const values = keys.map(key => process.env[key]); return () => keys.forEach((key, i) => { if (values[i] === undefined) delete process.env[key]; else process.env[key] = values[i]; }); }

test("LangChain prompt and strict parser preserve evidence and reject repairs, unknown IDs and reasons", async () => {
  await runReviewChain(findings, async prompt => { assert.ok(prompt.includes("DADOS NÃO CONFIÁVEIS")); assert.ok(prompt.includes("Pagamento em dez dias")); assert.ok(!prompt.includes("confidencial.pdf")); return valid; });
  for (const content of [valid.slice(0, -1), '{"items":[{"findingId":"fake","reason":"wording"}]}', '{"items":[{"findingId":"finding-1","reason":"fraud"}]}', '{"items":[],"evidence":"invented"}', '{"items":[{"findingId":"finding-1","reason":"wording"},{"findingId":"finding-1","reason":"context"}]}']) {
    await assert.rejects(runReviewChain(findings, async () => content));
  }
});

test("Ollama contract over real HTTP, JSON schema, consent, truncated output and fallback", async () => {
  const restore = saveEnv(); let calls = 0, mode = "ok";
  const server = createServer(async (request, response) => {
    calls++; let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(request.url, "/api/chat"); assert.equal(request.headers.authorization, "Bearer synthetic-key");
    assert.equal(body.model, "synthetic-model"); assert.equal(body.format.additionalProperties, false);
    assert.equal(body.stream, false); assert.equal(body.tools, undefined);
    assert.ok(!raw.includes("confidencial.pdf"));
    response.setHeader("Content-Type", "application/json");
    if (mode === "fail") { response.statusCode = 503; response.end("private upstream details"); }
    else response.end(JSON.stringify({ done: true, done_reason: mode === "length" ? "length" : "stop", message: { content: valid } }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    process.env.DIVERGENCE_AI_PROVIDER = "ollama";
    process.env.DIVERGENCE_OLLAMA_URL = `http://127.0.0.1:${address.port}`;
    process.env.DIVERGENCE_OLLAMA_MODEL = "synthetic-model"; process.env.DIVERGENCE_AI_KEY = "synthetic-key";
    assert.equal((await semanticReview(findings, false)).ai.status, "disabled"); assert.equal(calls, 0);
    const result = await semanticReview(findings, true);
    assert.equal(result.ai.status, "used"); assert.deepEqual(result.findings[0].evidence, findings[0].evidence);
    mode = "length"; assert.equal((await semanticReview(findings, true)).ai.status, "unavailable");
    mode = "fail"; const failed = await semanticReview(findings, true);
    assert.deepEqual(failed.findings, findings); assert.ok(!JSON.stringify(failed).includes("private upstream"));
  } finally { restore(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("Python Transformers connector checks model identity and never substitutes a paid provider", async () => {
  const restore = saveEnv(); let calls = 0;
  try {
    process.env.DIVERGENCE_AI_PROVIDER = "transformers";
    process.env.DIVERGENCE_TRANSFORMERS_URL = "https://private-ai.example.test";
    process.env.DIVERGENCE_TRANSFORMERS_MODEL = "public/model";
    const transport: typeof fetch = async (url, init) => {
      calls++; assert.equal(String(url), "https://private-ai.example.test/v1/review");
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, "public/model");
      assert.equal(body.pairs[0].findingId, "finding-1"); assert.ok(!String(init?.body).includes("confidencial.pdf"));
      return Response.json({ model: "public/model", content: valid });
    };
    assert.equal((await semanticReview(findings, true, undefined, transport)).ai.status, "used");
    const wrong: typeof fetch = async () => Response.json({ model: "unexpected-model", content: valid });
    assert.equal((await semanticReview(findings, true, undefined, wrong)).ai.status, "unavailable");
    const aborted = new AbortController(); aborted.abort();
    assert.equal((await semanticReview(findings, true, aborted.signal, transport)).ai.status, "unavailable"); assert.equal(calls, 1);
    delete process.env.DIVERGENCE_TRANSFORMERS_MODEL;
    assert.equal((await semanticReview(findings, true, undefined, transport)).ai.status, "not_configured"); assert.equal(calls, 1);
    process.env.DIVERGENCE_AI_PROVIDER = "unknown";
    assert.equal((await semanticReview(findings, true, undefined, transport)).ai.status, "not_configured");
  } finally { restore(); }
});

test("LangChain direct formatting/parsing does not trace documents even with LangSmith enabled in environment", async () => {
  const originalFetch = globalThis.fetch, tracing = process.env.LANGSMITH_TRACING, apiKey = process.env.LANGSMITH_API_KEY;
  let requests = 0;
  try {
    process.env.LANGSMITH_TRACING = "true"; process.env.LANGSMITH_API_KEY = "synthetic-test-only";
    globalThis.fetch = async () => { requests++; throw Error("Unexpected external request"); };
    await runReviewChain(findings, async () => valid);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (tracing === undefined) delete process.env.LANGSMITH_TRACING; else process.env.LANGSMITH_TRACING = tracing;
    if (apiKey === undefined) delete process.env.LANGSMITH_API_KEY; else process.env.LANGSMITH_API_KEY = apiKey;
  }
});
