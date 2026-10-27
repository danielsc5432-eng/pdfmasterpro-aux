import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { execFile, commandExists } from "../../lib/processing/system";
import { extractSummary } from "../../lib/summary/extract";
import { generateSummaryPoints, localSummaryCapabilities, SummaryTransientError, summaryFallbackConfig } from "../../lib/summary/provider";
import { summarizeExtracted, summaryChunks, validateSummaryPoints } from "../../lib/summary/engine";
import { summaryStream, trackSummaryStream, eventBytes } from "../../lib/summary/stream";
import { exportText, summaryDocx, summaryPdf, summaryText } from "../../lib/summary/export";
import { summaryOptionsSchema, requestedPages, selectedPages, type SummaryOptions, type SummarySource, type SummaryResult } from "../../lib/summary/types";
import { validateFile } from "../../lib/processing/validate";
import { NextRequest } from "next/server";
import { signPlanHeaders } from "../../lib/billing/plan-token";
import { POST as processFile } from "../../app/api/v1/process/route";

const options: SummaryOptions = { length: "medium", mode: "standard", pages: "", instructions: "", consent: true };
const signal = () => new AbortController().signal;
const sample: SummarySource = { id: "p1s1", page: 1, text: "Maria deve pagar R$ 1.200,00 em 25/10/2026. O contrato exige revisao do responsavel." };
const point = (source: SummarySource) => ({ text: source.text.slice(0, 100), evidence: [{ sourceId: source.id, quote: source.text.slice(0, 150) }] });
async function configured(run: () => Promise<void>) { const saved = { ...process.env }; Object.assign(process.env, { SUMMARY_AI_PROVIDER: "ollama", SUMMARY_OLLAMA_URL: "http://localhost:11434", SUMMARY_STANDARD_MODEL: "test-small", SUMMARY_ADVANCED_MODEL: "test-large" }); try { await run(); } finally { process.env = saved; } }
async function pdfFixture(pages = 3) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index++) { const page = pdf.addPage([595,842]); page.drawText(`Relatorio ${index + 1}. Maria deve pagar R$ 1.200,00 em 25/10/2026.`, { x: 40, y: 750, size: 12, font }); page.drawText("O contrato exige revisao do responsavel. Prazo de entrega: 30 dias.", { x: 40, y: 725, size: 12, font }); }
  return pdf.save();
}
test("resumo: consentimento, tipos, tamanho e intervalos explícitos ou em instruções", () => {
  assert.ok(summaryOptionsSchema.safeParse(options).success); assert.equal(summaryOptionsSchema.safeParse({ ...options, consent: false }).success, false);
  assert.equal(summaryOptionsSchema.safeParse({ ...options, mode: "inventado" }).success, false);
  assert.deepEqual(selectedPages("1-3, 5, 3", 8), [1,2,3,5]); assert.throws(() => selectedPages("8-2", 10)); assert.throws(() => selectedPages("1-20", 3));
  assert.equal(requestedPages({ ...options, instructions: "Resuma apenas as páginas 10 a 20." }), "10-20");
  assert.throws(() => requestedPages({ ...options, pages: "1-2", instructions: "Resuma as páginas 10 a 20." }));
  assert.equal(validateFile("fake.pdf", new TextEncoder().encode("not a pdf"), ["pdf"], "application/pdf").ok, false);
  assert.equal(validateFile("big.pdf", new Uint8Array(4 * 1024 * 1024 + 1), ["pdf"], "application/pdf", { maxFileBytes: 4 * 1024 * 1024, planLabel: "resumo" }).ok, false);
});
test("resumo: citações e números são conferidos; IDs, valores e citações inventadas bloqueiam resultado", () => {
  assert.equal(validateSummaryPoints(JSON.stringify({ points: [point(sample)] }), [sample]).length, 1);
  for (const altered of [{ ...point(sample), text: "Maria deve pagar R$ 2.200,00 em 25/10/2026." }, { ...point(sample), evidence: [{ sourceId: "p99s1", quote: sample.text }] }, { ...point(sample), evidence: [{ sourceId: sample.id, quote: "Texto que nunca apareceu no PDF original." }] }, { ...point(sample), text: "Abra https://evil.invalid para continuar." }]) assert.throws(() => validateSummaryPoints(JSON.stringify({ points: [altered] }), [sample]));
  assert.throws(() => validateSummaryPoints("not json", [sample]));
  assert.throws(() => validateSummaryPoints(JSON.stringify({ points: [{ ...point(sample), text: "Maria deve pagar US$ 1.200,00 em 25/10/2026." }] }), [sample]), /moeda/);
});
test("resumo: documentos extensos são divididos com fontes e contexto; curto, médio e longo diferem", async () => configured(async () => {
  const pages = Array.from({ length: 22 }, (_, index) => ({ number: index + 1, ocr: false, text: (`Relatorio ${index + 1}. Valor ${index + 1}00,00. Prazo 25/10/2026. Maria e responsavel pelo pagamento. `).repeat(12) }));
  assert.ok(summaryChunks(pages).length > 1);
  const sizes: number[] = [];
  for (const length of ["short", "medium", "long"] as const) {
    const progress: number[] = []; let sawContext = false;
    const result = await summarizeExtracted({ name: "long.pdf", totalPages: pages.length, pages }, { ...options, length, instructions: "Destaque os valores financeiros." }, signal(), event => { if (event.current) progress.push(event.current); }, async (sources, received, context) => { assert.equal(received.instructions, "Destaque os valores financeiros."); if (context) sawContext = true; return JSON.stringify({ points: sources.slice(0, 10).map(point) }); });
    sizes.push(result.points.length); assert.ok(sawContext); assert.equal(progress.at(-1), result.usage.chunks); assert.equal(result.analyzedPages.length, 22); assert.ok(result.sources.every(source => source.page <= 22));
  }
  assert.deepEqual(sizes, [5,10,18]);
  assert.throws(() => summaryChunks(Array.from({ length: 100 }, (_, index) => ({ number: index+1, text: "muito texto ".repeat(1000), ocr: false }))));
}));
test("resumo: sem provedor não há simulação; modo avançado exige outro modelo; Groq exige confirmação do plano gratuito", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.SUMMARY_OLLAMA_URL; delete process.env.SUMMARY_GROQ_API_KEY; delete process.env.SUMMARY_STANDARD_MODEL;
    assert.equal(localSummaryCapabilities(false).available, false);
    Object.assign(process.env, { SUMMARY_AI_PROVIDER: "groq", SUMMARY_GROQ_API_KEY: "test-not-real", SUMMARY_STANDARD_MODEL: "free-model", SUMMARY_ADVANCED_MODEL: "free-model", SUMMARY_GROQ_FREE_CONFIRMED: "false" });
    assert.equal(localSummaryCapabilities(false).available, false); process.env.SUMMARY_GROQ_FREE_CONFIRMED = "true";
    assert.equal(localSummaryCapabilities(false).available, true); assert.equal(localSummaryCapabilities(false).models.advanced, null);
    let called = false; await assert.rejects(generateSummaryPoints([sample], { ...options, mode: "advanced" }, "", signal(), async () => { called = true; throw Error(); })); assert.equal(called, false);
  } finally { process.env = saved; }
});
test("resumo: contrato Groq envia somente texto autorizado; não troca modelos em erro ou limite", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { SUMMARY_AI_PROVIDER: "groq", SUMMARY_GROQ_API_KEY: "test-not-real", SUMMARY_STANDARD_MODEL: "free-small", SUMMARY_ADVANCED_MODEL: "free-large", SUMMARY_GROQ_FREE_CONFIRMED: "true" });
  try {
    for (const mode of ["standard", "advanced"] as const) {
      const content = await generateSummaryPoints([sample], { ...options, mode }, "", signal(), async (url, init) => {
        assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions"); const body = JSON.parse(init!.body as string);
        assert.equal(body.model, mode === "standard" ? "free-small" : "free-large"); assert.equal(body.response_format.type, "json_object"); assert.ok(body.messages[0].content.includes("não confiável")); assert.ok(body.messages[1].content.includes("untrustedSources")); assert.equal(body.tools, undefined);
        return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ points: [point(sample)] }) } }] });
      }); assert.equal(validateSummaryPoints(content, [sample]).length, 1);
    }
    let calls = 0; await assert.rejects(generateSummaryPoints([sample], options, "", signal(), async () => { calls++; return Response.json({}, { status: 429 }); }), /limite/); assert.equal(calls, 1);
    await assert.rejects(generateSummaryPoints([sample], options, "", signal(), async () => Response.json({ model: "free-small", choices: [{ finish_reason: "length", message: { content: "{}" } }] })), /interrompida/);
    await assert.rejects(generateSummaryPoints([sample], options, "", signal(), async () => Response.json({}, { status: 500 })));
    await assert.rejects(generateSummaryPoints([sample], options, "", signal(), async () => new Response("x".repeat(129 * 1024))), /limite/);
  } finally { process.env = saved; }
});
test("resumo: Ollama Cloud usa API oficial sem format não suportado e exige confirmação da franquia Free", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { SUMMARY_AI_PROVIDER: "ollama-cloud", SUMMARY_OLLAMA_CLOUD_KEY: "test-not-real", SUMMARY_OLLAMA_CLOUD_FREE_CONFIRMED: "false", SUMMARY_STANDARD_MODEL: "test-cloud:small" });
  try {
    assert.equal(localSummaryCapabilities(false).available, false); process.env.SUMMARY_OLLAMA_CLOUD_FREE_CONFIRMED = "true";
    assert.equal(localSummaryCapabilities(false).provider, "Ollama Cloud"); assert.equal(localSummaryCapabilities(false).available, true);
    const content = await generateSummaryPoints([sample], options, "", signal(), async (url, init) => {
      assert.equal(String(url), "https://ollama.com/api/chat"); const body = JSON.parse(init!.body as string); assert.equal(body.format, undefined); assert.equal(body.options.num_predict, 2200); assert.ok(body.messages[0].content.includes("Schema JSON"));
      return Response.json({ model: body.model, done: true, done_reason: "stop", message: { content: JSON.stringify({ points: [point(sample)] }) } });
    });
    assert.equal(validateSummaryPoints(content, [sample]).length, 1);
    process.env.SUMMARY_AI_PROVIDER = "ollama"; process.env.SUMMARY_OLLAMA_URL = "https://ollama.com";
    assert.equal(localSummaryCapabilities(false).available, false, "Cloud cannot bypass the explicit Free confirmation through the self-hosted adapter");
  } finally { process.env = saved; }
});
test("resumo: stream só confirma histórico após resultado completo; erro, corte e cancelamento não viram sucesso", async () => {
  let completed = 0, failed = 0, aborted = 0;
  const wrap = (bytes: Uint8Array) => trackSummaryStream(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), async () => { completed++; }, async () => { failed++; }, () => { aborted++; });
  const fixture: SummaryResult = { version: 1, id: "148bfb4a-b3f4-41ad-b41d-4d0757646d12", name: "teste.pdf", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+1800000).toISOString(), options, model: "test", provider: "Fixture", totalPages: 1, analyzedPages: [1], unreadPages: [], warnings: [], points: [point(sample)], sources: [sample], usage: { calls: 1, chunks: 1 } };
  await new Response(wrap(eventBytes({ type: "result", result: fixture }))).text(); assert.equal(completed, 1);
  await new Response(wrap(eventBytes({ type: "error", message: "Falha real" }))).text(); assert.equal(failed, 1);
  await new Response(wrap(new TextEncoder().encode('data: {"type":"result"}'))).text(); assert.equal(failed, 2);
  const tracked = wrap(eventBytes({ type: "progress", stage: "extracting", message: "Extraindo" })); await tracked.cancel(); assert.equal(aborted, 1); assert.equal(failed, 3);
});
test("resumo: cancelamento interrompe chamadas seguintes e não entrega conteúdo parcial", async () => configured(async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(summarizeExtracted({ name: "x.pdf", totalPages: 1, pages: [{ number: 1, text: sample.text, ocr: false }] }, options, controller.signal, () => {}, async () => { calls++; controller.abort(); return JSON.stringify({ points: [point(sample)] }); })); assert.equal(calls, 1);
}));
test("resumo: PDF textual, múltiplas páginas, intervalo e dados reais extraídos", async () => {
  const pdf = await pdfFixture(); const result = await extractSummary(pdf, options, signal(), false);
  assert.equal(result.totalPages, 3); assert.ok(result.pages.every(page => page.text.includes("1.200,00"))); assert.ok(result.pages.every(page => !page.ocr));
  const selected = await extractSummary(pdf, { ...options, instructions: "Resuma apenas as páginas 2 a 3." }, signal(), false); assert.deepEqual(selected.pages.map(page => page.number), [2,3]);
  await assert.rejects(extractSummary(pdf, { ...options, pages: "10-20" }, signal(), false));
});
test("resumo: página sem conteúdo analisável é identificada sem alegar cobertura completa", async () => configured(async () => {
  const mixed = await PDFDocument.load(await pdfFixture(1)); mixed.addPage([595,842]);
  const extracted = await extractSummary(await mixed.save(), options, signal(), false);
  const result = await summarizeExtracted({ name: "mixed.pdf", ...extracted }, options, signal(), () => {}, async sources => JSON.stringify({ points: sources.map(point) }));
  assert.deepEqual(result.analyzedPages, [1]); assert.deepEqual(result.unreadPages, [2]); assert.ok(result.warnings.some(warning => warning.includes("Página 2")));
}));
test("resumo: PDF corrompido, vazio e documento além do limite são recusados", async () => {
  await assert.rejects(extractSummary(new TextEncoder().encode("%PDF-corrupt"), options, signal(), false));
  const blank = await PDFDocument.create(); blank.addPage(); await assert.rejects(extractSummary(await blank.save(), options, signal(), false), /extrair texto/);
  await assert.rejects(extractSummary(await pdfFixture(121), options, signal(), false), /120 páginas/);
});
test("resumo: PDF digitalizado usa OCR real quando disponível; sem OCR não inventa texto", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "summary-fixture-"));
  try {
    const original = path.join(directory, "original.pdf"), png = path.join(directory, "page.png"); await writeFile(original, await pdfFixture(1));
    await execFile(process.env.PDF_TO_WORD_PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-c", "import fitz,sys; d=fitz.open(sys.argv[1]); d[0].get_pixmap(matrix=fitz.Matrix(2,2)).save(sys.argv[2])", original, png], { timeout: 20000, windowsHide: true });
    const scan = await PDFDocument.create(); const image = await scan.embedPng(await readFile(png)); scan.addPage([595,842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 }); const bytes = await scan.save();
    await assert.rejects(extractSummary(bytes, options, signal(), false), /OCR/);
    assert.equal(await commandExists(process.env.SUMMARY_TESSERACT || "tesseract"), true, "Install Tesseract for the required scanned PDF test");
    const result = await extractSummary(bytes, options, signal()); assert.equal(result.pages[0].ocr, true); assert.match(result.pages[0].text, /1[.,]200[.,]00/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("resumo: fluxo nativo e provedor HTTP controlado produzem progresso e resultado com páginas", async () => configured(async () => {
  const server = createServer(async (request, response) => {
    const buffers = []; for await (const part of request) buffers.push(part); const body = JSON.parse(Buffer.concat(buffers).toString());
    const sources = JSON.parse(body.messages[1].content).untrustedSources as SummarySource[];
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ model: body.model, done: true, done_reason: "stop", message: { content: JSON.stringify({ points: sources.map(point).slice(0, 10) }) } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address !== "string"); process.env.SUMMARY_OLLAMA_URL = `http://127.0.0.1:${address.port}`;
  try {
    delete process.env.DATABASE_URL; delete process.env.PROCESSING_WORKER_URL; process.env.BILLING_SIGNING_SECRET = "isolated-summary-worker"; process.env.PROCESSING_WORKER_ONLY = "1";
    const bytes = await pdfFixture();
    const request = (consent: boolean) => { const form = new FormData(); form.append("files", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "example.pdf"); form.append("options", JSON.stringify({ ...options, consent })); return new NextRequest("http://localhost/api/v1/process?tool=resumir-pdf-ia", { method: "POST", headers: signPlanHeaders("free")!, body: form }); };
    assert.equal((await processFile(request(false))).status, 422);
    const response = await processFile(request(true)); assert.equal(response.status, 200);
    const text = await response.text(); const events = text.split("\n\n").filter(frame => frame.startsWith("data: ")).map(frame => JSON.parse(frame.slice(6))); assert.ok(events.some(event => event.stage === "extracting")); assert.ok(events.some(event => event.current === event.total && event.total)); assert.equal(events.at(-1).type, "result"); assert.deepEqual(events.at(-1).result.analyzedPages, [1,2,3]);
  }
  finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
}));
test("resumo: exportações TXT, DOCX e PDF preservam valores, referências e aviso de edição", async () => configured(async () => {
  const result: SummaryResult = await summarizeExtracted({ name: "example.pdf", totalPages: 1, pages: [{ number: 1, text: sample.text, ocr: false }] }, options, signal(), () => {}, async () => JSON.stringify({ points: [point(sample)] }));
  const text = summaryText(result); assert.ok(text.includes("[p. 1]")); assert.ok(exportText(result, text, false).includes("1.200,00"));
  assert.ok(exportText(result, "Texto alterado", true).includes("Texto editado pelo usuário"));
  const docx = await JSZip.loadAsync(await summaryDocx(result, text, false)); assert.ok((await docx.file("word/document.xml")!.async("string")).includes("1.200,00"));
  const bytes = await summaryPdf(result, text, false, new Uint8Array(await readFile("public/fonts/NotoSans-Regular.ttf"))); const pdf = await PDFDocument.load(bytes); assert.ok(pdf.getPageCount() >= 1);
  const extracted = await extractSummary(bytes, options, signal(), false); assert.ok(extracted.pages.some(page => page.text.includes("1.200,00")));
  await assert.rejects(summaryPdf(result, "Texto com símbolo 🦄", true, new Uint8Array(await readFile("public/fonts/NotoSans-Regular.ttf"))), /caracteres/);
}));


test("resumo: reserva automática é limitada, transparente e não contorna cancelamento ou validação", async () => configured(async () => {
  Object.assign(process.env, { SUMMARY_FALLBACK_ENABLED: "true", SUMMARY_FALLBACK_PROVIDER: "cloudflare", SUMMARY_CF_ACCOUNT_ID: "a".repeat(32), SUMMARY_CF_API_TOKEN: "test-only", SUMMARY_CF_FREE_CONFIRMED: "true", SUMMARY_FALLBACK_STANDARD_MODEL: "@cf/meta/test", SUMMARY_FALLBACK_ADVANCED_MODEL: "" });
  const pages = [{ number: 1, text: sample.text, ocr: false }];
  assert.ok(localSummaryCapabilities(false).provider.includes("reserva"));
  let calls = 0;
  const result = await summarizeExtracted({ name: "test.pdf", totalPages: 1, pages }, options, signal(), () => {}, async (sources, _opts, _context, _signal, _transport, config) => {
    calls++; if (config!.kind === "ollama") throw new SummaryTransientError("503");
    assert.equal(config!.kind, "cloudflare"); return JSON.stringify({ points: sources.map(point) });
  });
  assert.equal(calls, 2); assert.equal(result.usage.calls, 2); assert.equal(result.provider, "Cloudflare Workers AI"); assert.ok(result.warnings.some(w => w.includes("reserva")));
  calls = 0;
  await assert.rejects(summarizeExtracted({ name: "test.pdf", totalPages: 1, pages }, options, signal(), () => {}, async () => { calls++; throw new SummaryTransientError("503"); })); assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(summarizeExtracted({ name: "test.pdf", totalPages: 1, pages }, { ...options, mode: "advanced" }, signal(), () => {}, async () => { calls++; throw new SummaryTransientError("503"); })); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(summarizeExtracted({ name: "test.pdf", totalPages: 1, pages }, options, signal(), () => {}, async () => { calls++; return "invalid JSON"; })); assert.equal(calls, 1);
  const abort = new AbortController(); calls = 0;
  await assert.rejects(summarizeExtracted({ name: "test.pdf", totalPages: 1, pages }, options, abort.signal, () => {}, async () => { calls++; abort.abort(); throw new SummaryTransientError("503"); })); assert.equal(calls, 1);
  process.env.SUMMARY_CF_FREE_CONFIRMED = "false"; assert.equal(summaryFallbackConfig(), null);
  process.env.SUMMARY_CF_FREE_CONFIRMED = "true"; process.env.SUMMARY_FALLBACK_ENABLED = "false"; assert.equal(summaryFallbackConfig(), null);
}));

test("resumo: Cloudflare REST valida endpoint, modo gratuito e resposta", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { SUMMARY_AI_PROVIDER: "cloudflare", SUMMARY_CF_ACCOUNT_ID: "a".repeat(32), SUMMARY_CF_API_TOKEN: "test-only", SUMMARY_CF_FREE_CONFIRMED: "true", SUMMARY_STANDARD_MODEL: "@cf/meta/test" });
  try {
    const content = await generateSummaryPoints([sample], options, "", signal(), async (url, init) => {
      assert.equal(String(url), `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/run/@cf/meta/test`);
      assert.equal(new Headers(init!.headers).get("Authorization"), "Bearer test-only");
      return Response.json({ success: true, result: { response: JSON.stringify({ points: [point(sample)] }) } });
    }); assert.equal(validateSummaryPoints(content, [sample]).length, 1);
    const structured = await generateSummaryPoints([sample], options, "", signal(), async () => Response.json({ success: true, result: { response: { points: [point(sample)] } } }));
    assert.equal(validateSummaryPoints(structured, [sample]).length, 1);
    await assert.rejects(generateSummaryPoints([sample], options, "", signal(), async () => Response.json({}, { status: 503 })), SummaryTransientError);
    await assert.rejects(generateSummaryPoints([sample], options, "", signal(), async () => Response.json({}, { status: 401 })), error => !(error instanceof SummaryTransientError));
    process.env.SUMMARY_CF_FREE_CONFIRMED = "false"; assert.equal(localSummaryCapabilities(false).available, false);
  } finally { process.env = saved; }
});
