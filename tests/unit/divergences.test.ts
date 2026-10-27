import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { compareDocuments, fieldsOf } from "../../lib/divergences/compare";
import { semanticReview } from "../../lib/divergences/ai";
import { generateWithOpenCode } from "../../lib/divergences/opencode";
import { divergenceReport } from "../../lib/divergences/report";
import { markDuplicateDocuments, validateAnalysisFiles, analysisOptionsSchema, analyzeFiles } from "../../lib/divergences/analyze";
import { evidenceIsValid, type SourceDocument, type AnalysisResult } from "../../lib/divergences/types";
import { localAiPairs, validatedLocalReview } from "../../lib/divergences/browser-ai";

const options = { modes: ["general" as const], custom: "", useAi: false };
function source(id: string, lines: string[], complete = true): SourceDocument {
  return { id, name: id + ".pdf", size: 100, sha256: id, complete, warnings: [], pages: [{ number: 1, width: 595, height: 842, needsOcr: !complete, lines: lines.map((text, i) => ({ id: `l${i}`, text, box: [10, i * 20, 500, i * 20 + 12] })) }] };
}
function pair(a: string, b: string) { return [source("a", ["Contrato: 123", a]), source("b", ["Contrato: 123", b])]; }
test("compares monetary values exactly, preserves currency and normalizes Brazilian formatting", () => {
  assert.equal(compareDocuments(pair("Total: R$ 1.000,00", "Total: R$ 1000,0"), options).findings.length, 0);
  const docs = pair("Total: R$ 100,00", "Total: US$ 100.00");
  const findings = compareDocuments(docs, options).findings;
  assert.equal(findings.length, 1); assert.equal(findings[0].classification, "objective");
  assert.ok(findings[0].evidence.every(item => evidenceIsValid(item, docs)));
  assert.notEqual(fieldsOf(source("c", ["Total: US$ 1,000"] ))[0].canonical, fieldsOf(source("d", ["Total: US$ 1.00"]))[0].canonical);
  assert.equal(compareDocuments(pair("Total: R$ 100,00", "Total: 100,00"), options).findings[0].classification, "inconclusive");
  assert.equal(compareDocuments(pair("Total: R$ 1.23,45", "Total: R$ 123,45"), options).findings[0].classification, "inconclusive");
});
test("dates, invalid dates, names and leading zeros remain distinct", () => {
  assert.equal(compareDocuments(pair("Vencimento: 24/10/2026", "Vencimento: 2026-10-24"), options).findings.length, 0);
  assert.equal(compareDocuments(pair("Vencimento: 31/02/2026", "Vencimento: 28/02/2026"), options).findings[0].classification, "inconclusive");
  assert.equal(compareDocuments(pair("Nome: Maria", "Nome: Joana"), options).findings[0].category, "name");
  assert.equal(compareDocuments(pair("Matrícula: 0012", "Matrícula: 12"), options).findings.length, 1);
});
test("missing fields require complete extraction; periods and repeated table labels are not equated", () => {
  const docs = [source("a", ["Total: R$ 10"]), source("b", [], false)];
  assert.equal(compareDocuments(docs, options).findings.length, 0);
  assert.equal(compareDocuments([source("a", ["Competência: janeiro", "Total: 10"]), source("b", ["Competência: fevereiro", "Total: 20"])], options).findings.length, 0);
  const repeated = compareDocuments([source("a", ["Total: 10", "Total: 20"]), source("b", ["Total: 30"])], options);
  assert.equal(repeated.findings.length, 0); assert.ok(repeated.warnings.length);
  const missing = compareDocuments([source("a", ["CPF: 123"]), source("b", ["Nome: Joana"])], options).findings;
  assert.ok(missing.every(item => item.classification === "missing" && item.evidence.length === 1));
});
test("duplicates, forged evidence and file/options boundaries", () => {
  const docs = pair("Nome: Maria", "Nome: Maria"); markDuplicateDocuments(docs);
  assert.equal(docs[1].duplicateOf, "a");
  const changed = pair("Nome: Maria", "Nome: Joana");
  const evidence = compareDocuments(changed, options).findings[0].evidence[0];
  assert.equal(evidenceIsValid({ ...evidence, quote: "inventado" }, changed), false);
  assert.throws(() => validateAnalysisFiles([{ name: "x.pdf", size: 2 }]));
  assert.throws(() => validateAnalysisFiles([{ name: "x.pdf", size: 11 * 1024 * 1024 }, { name: "y.pdf", size: 2 }]));
  assert.throws(() => analysisOptionsSchema.parse({ modes: ["custom"], custom: "" }));
});

test("OpenCode stateless contract, consent, malicious output and fallback", async () => {
  const keys = ["DIVERGENCE_AI_PROVIDER", "DIVERGENCE_OPENCODE_URL", "DIVERGENCE_OPENCODE_PROVIDER", "DIVERGENCE_OPENCODE_MODEL", "DIVERGENCE_OPENCODE_AUTHORIZATION"];
  const saved = keys.map(key => process.env[key]);
  const findings = compareDocuments(pair("Cláusula 1: Pagamento em dez dias", "Cláusula 1: Pagamento em trinta dias"), options).findings;
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://ai.example.test/api/experimental/generate");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body).sort(), ["model", "prompt"]);
    assert.deepEqual(body.model, { providerID: "local", id: "free-model" });
    assert.ok(body.prompt.includes("DADOS NÃO CONFIÁVEIS"));
    assert.equal(init?.redirect, "error");
    return Response.json({ data: { text: JSON.stringify({ items: [{ findingId: findings[0].id, reason: "obligation" }] }) } });
  };
  try {
    process.env.DIVERGENCE_AI_PROVIDER = "opencode";
    process.env.DIVERGENCE_OPENCODE_URL = "https://ai.example.test";
    process.env.DIVERGENCE_OPENCODE_PROVIDER = "local";
    process.env.DIVERGENCE_OPENCODE_MODEL = "free-model";
    const disabled = await semanticReview(findings, false, undefined, transport);
    assert.equal(disabled.ai.status, "disabled"); assert.equal(calls, 0);
    const reviewed = await semanticReview(findings, true, undefined, transport);
    assert.equal(reviewed.ai.status, "used"); assert.equal(reviewed.findings[0].origin, "ai");
    assert.deepEqual(reviewed.findings[0].evidence, findings[0].evidence);
    const forged: typeof fetch = async () => Response.json({ data: { text: '{"items":[{"findingId":"inventado","reason":"wording"}]}' } });
    assert.equal((await semanticReview(findings, true, undefined, forged)).ai.status, "unavailable");
    const unavailable: typeof fetch = async () => new Response("upstream credentials", { status: 503 });
    const failed = await semanticReview(findings, true, undefined, unavailable);
    assert.deepEqual(failed.findings, findings); assert.equal(failed.ai.status, "unavailable");
    assert.ok(!failed.warning?.includes("credentials"));
    const oversized: typeof fetch = async () => new Response("x".repeat(130 * 1024));
    await assert.rejects(generateWithOpenCode("test", undefined, oversized), /too large/);
    process.env.DIVERGENCE_OPENCODE_URL = "http://remote.test";
    await assert.rejects(generateWithOpenCode("test", undefined, transport), /endpoint/);
    delete process.env.DIVERGENCE_OPENCODE_MODEL;
    assert.equal((await semanticReview(findings, true, undefined, transport)).ai.status, "not_configured");
  } finally { keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); }
});

test("report preserves evidence and reviews across multiple pages, rejects unsupported Unicode", async () => {
  const docs = pair("Nome: Maria", "Nome: Joana");
  const finding = compareDocuments(docs, options).findings[0];
  const result: AnalysisResult = { version: 1, id: "test", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString(), options, documents: docs, findings: Array.from({ length: 35 }, (_, i) => ({ ...finding, id: `f-${i}` })), warnings: [], ai: { status: "disabled", considered: 0 }, truncated: false };
  const font = new Uint8Array(await readFile("public/fonts/NotoSans-Regular.ttf"));
  const bytes = await divergenceReport(result, { "f-0": { status: "confirmed", note: "Revisado pelo usuário" } }, font);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 2);
  result.documents[0].name = "文書.pdf";
  await assert.rejects(divergenceReport(result, {}, font), /caracteres não suportados/);
});

test("browser embeddings only reference eligible evidence; reject invented, duplicate or nonfinite scores", () => {
  const findings = compareDocuments(pair("Cláusula 1: Pagamento em dez dias", "Cláusula 1: Pagamento em trinta dias"), options).findings;
  const pairs = localAiPairs(findings);
  assert.equal(pairs.length, 1); assert.ok(pairs[0].texts.every(text => text.length <= 450));
  const data = { model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", revision: "2c4055b12046f11709e9df2c122e59ffbdc2f900", createdAt: new Date().toISOString(), items: [{ findingId: findings[0].id, similarity: .91 }] };
  assert.equal(validatedLocalReview(data, findings).items[0].similarity, .91);
  assert.throws(() => validatedLocalReview({ ...data, items: [{ findingId: "fake", similarity: .9 }] }, findings));
  assert.throws(() => validatedLocalReview({ ...data, items: [{ findingId: findings[0].id, similarity: NaN }] }, findings));
  assert.throws(() => validatedLocalReview({ ...data, items: [...data.items, ...data.items] }, findings));
  assert.throws(() => validatedLocalReview({ ...data, revision: "main" }, findings));
  assert.deepEqual(localAiPairs(compareDocuments(pair("Total: 10", "Total: 20"), options).findings), []);
});

test("real native PDF extraction returns referenced findings and cleans up corrupt input", { skip: !process.env.PDF_TO_WORD_PYTHON }, async () => {
  async function pdf(total: string) {
    const doc = await PDFDocument.create(); const page = doc.addPage();
    ["Contrato: 123", "Nome: Maria Silva", `Total: R$ ${total}`].forEach((text, i) => page.drawText(text, { x: 40, y: 750 - i * 30, size: 12 }));
    return doc.save();
  }
  const result = await analyzeFiles([{ name: "a.pdf", bytes: await pdf("100,00") }, { name: "b.pdf", bytes: await pdf("200,00") }], options);
  assert.equal(result.findings.length, 1); assert.equal(result.findings[0].category, "value");
  assert.ok(result.findings[0].evidence.every(item => evidenceIsValid(item, result.documents)));
  await assert.rejects(analyzeFiles([{ name: "bad.pdf", bytes: new Uint8Array([1,2,3]) }, { name: "b.pdf", bytes: await pdf("200,00") }], options));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(analyzeFiles([{ name: "a.pdf", bytes: await pdf("100,00") }, { name: "b.pdf", bytes: await pdf("200,00") }], options, abort.signal));
});
