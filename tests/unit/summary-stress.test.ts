import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { generateSummaryPoints, SummaryTransientError } from "../../lib/summary/provider";
import { summarizeExtracted, summaryChunks, validateSummaryPoints } from "../../lib/summary/engine";
import { extractSummary } from "../../lib/summary/extract";
import { summaryResultSchema, type SummarySource } from "../../lib/summary/types";
import { withNativeJob } from "../../lib/processing/native-job";
import { access } from "node:fs/promises";

const options = { consent: true as const, length: "long" as const, mode: "standard" as const, instructions: "", pages: "" };
const source = { id: "p1s1", page: 1, text: "Maria deve pagar R$ 1.200,00 em 25/10/2026." };
const point = (s: SummarySource) => ({ text: s.text.slice(0, 200), evidence: [{ sourceId: s.id, quote: s.text.slice(0, 200) }] });
test("stress resumo: JSON com cerca única mantém validação; prosa, múltiplas cercas e fatos inventados são recusados", () => {
  const json = JSON.stringify({ points: [point(source)] });
  assert.equal(validateSummaryPoints("```json\n" + json + "\n```", [source]).length, 1);
  assert.equal(validateSummaryPoints("```\r\n" + json + "\r\n```", [source]).length, 1);
  for (const content of ["Explicação\n```json\n" + json + "\n```", "```json\n" + json + "\n```\n```json\n{}\n```", "```json\n" + json.replace("1.200,00", "9.999,00") + "\n```", "```json\n{}\n```", "```json\n" + json]) assert.throws(() => validateSummaryPoints(content, [source]));
});
async function configured(run: () => Promise<void>) {
  const saved = { ...process.env };
  Object.assign(process.env, { SUMMARY_AI_PROVIDER: "groq", SUMMARY_STANDARD_MODEL: "test-small", SUMMARY_GROQ_API_KEY: "not-a-real-key", SUMMARY_GROQ_FREE_CONFIRMED: "true", SUMMARY_FALLBACK_ENABLED: "true", SUMMARY_FALLBACK_PROVIDER: "cloudflare", SUMMARY_CF_ACCOUNT_ID: "a".repeat(32), SUMMARY_CF_API_TOKEN: "not-a-real-key", SUMMARY_CF_FREE_CONFIRMED: "true", SUMMARY_FALLBACK_STANDARD_MODEL: "@cf/meta/test" });
  try { await run(); } finally { process.env = saved; }
}

test("stress resumo: queda da conexão durante o corpo permite reserva sem entregar resposta parcial", () => configured(async () => {
  let count = 0;
  const transport: typeof fetch = async () => {
    count++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"model":"test-small",')); controller.error(new TypeError("terminated")); } }));
  };
  await assert.rejects(generateSummaryPoints([source], options, "", new AbortController().signal, transport), SummaryTransientError);
  assert.equal(count, 1);
  await assert.rejects(generateSummaryPoints([source], options, "", new AbortController().signal, async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } }), { status: 503 })), SummaryTransientError);
}));

test("stress resumo: JSON nulo ou primitivo gera erro tratado do provedor", () => configured(async () => {
  for (const payload of [null, true, 42, "unexpected", []]) {
    await assert.rejects(generateSummaryPoints([source], options, "", new AbortController().signal, async () => Response.json(payload)), /O provedor retornou uma resposta inválida/);
  }
}));

test("stress resumo: Cloudflare com JSON aparentemente completo mas finish_reason length é recusado", () => configured(async () => {
  const config = { kind: "cloudflare", url: new URL("https://api.cloudflare.com/client/v4/accounts/" + "a".repeat(32) + "/ai/run"), standard: "@cf/meta/test", advanced: null, provider: "Cloudflare Workers AI", costNotice: "test" };
  await assert.rejects(generateSummaryPoints([source], options, "", new AbortController().signal, async () => Response.json({ success: true, result: { response: { points: [point(source)] }, usage: { completion_tokens: 100 }, choices: [{ finish_reason: "length", message: {} }] } }), config), /interrompida/);
}));

test("stress resumo: corpo interrompido aciona reserva real do fluxo; cancelamento não aciona", () => configured(async () => {
  let calls = 0;
  const controller = new AbortController();
  const transport: typeof fetch = async (url) => {
    calls++;
    if (String(url).includes("groq.com")) return new Response(new ReadableStream({ start(body) { body.error(new TypeError("terminated")); } }));
    return Response.json({ success: true, result: { response: { points: [point(source)] } } });
  };
  const input = { name: "network.pdf", totalPages: 1, pages: [{ number: 1, text: source.text, ocr: false }] };
  const result = await summarizeExtracted(input, options, controller.signal, () => {}, (sources, opts, context, signal, _fetch, config) => generateSummaryPoints(sources, opts, context, signal, transport, config));
  assert.equal(result.provider, "Cloudflare Workers AI"); assert.equal(calls, 2);
  calls = 0;
  const cancelledTransport: typeof fetch = async () => {
    calls++; controller.abort();
    return new Response(new ReadableStream({ start(body) { body.error(new TypeError("terminated")); } }));
  };
  await assert.rejects(summarizeExtracted(input, options, controller.signal, () => {}, (sources, opts, context, signal, _fetch, config) => generateSummaryPoints(sources, opts, context, signal, cancelledTransport, config)), error => error instanceof Error && error.name === "AbortError");
  assert.equal(calls, 1);
}));

test("stress resumo: falha após trechos bem-sucedidos troca uma vez e mantém fontes e contadores", () => configured(async () => {
  const pages = Array.from({ length: 35 }, (_, i) => ({ number: i + 1, ocr: false, text: (`Registro ${i + 1}: pagamento de R$ 1.200,00 em 25/10/2026. Maria deve conferir o contrato. `).repeat(15) }));
  const chunks = summaryChunks(pages); assert.ok(chunks.length >= 6);
  let primary = 0, reserve = 0;
  const result = await summarizeExtracted({ name: "stress.pdf", totalPages: pages.length, pages }, options, new AbortController().signal, () => {}, async (sources, _options, _context, _signal, _transport, config) => {
    if (config!.kind === "groq" && ++primary === 3) throw new SummaryTransientError("503");
    if (config!.kind === "cloudflare") reserve++;
    return JSON.stringify({ points: sources.slice(0, 3).map(point) });
  });
  assert.equal(primary, 3); assert.equal(reserve, chunks.length - 2); assert.equal(result.usage.calls, chunks.length + 1); assert.ok(result.usage.calls <= 9);
  assert.ok(summaryResultSchema.safeParse(result).success); assert.equal(result.analyzedPages.length, 35);
  assert.ok(result.provider.includes("Groq")); assert.ok(result.provider.includes("Cloudflare"));
  for (const p of result.points) for (const evidence of p.evidence) assert.ok(result.sources.some(s => s.id === evidence.sourceId && s.text.includes(evidence.quote)));
}));

test("stress resumo: orçamento excedido recusa antes de chamar a IA", () => configured(async () => {
  let calls = 0;
  const pages = Array.from({ length: 120 }, (_, i) => ({ number: i + 1, ocr: false, text: "Texto de documento extenso. ".repeat(400) }));
  await assert.rejects(summarizeExtracted({ name: "large.pdf", totalPages: 120, pages }, options, new AbortController().signal, () => {}, async () => { calls++; return "{}"; }), /orçamento/);
  assert.equal(calls, 0);
}));

test("stress resumo: lê 120 páginas reais e rejeita excesso de texto antes de IA", async () => {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 120; i++) pdf.addPage([595,842]).drawText(`Pagina ${i + 1}: valor R$ 1.200,00. Prazo 25/10/2026.`, { x: 30, y: 750, font, size: 10 });
  const extracted = await extractSummary(await pdf.save(), options, new AbortController().signal, false);
  assert.equal(extracted.pages.length, 120); assert.ok(extracted.pages[119].text.includes("120"));
  const large = await PDFDocument.create();
  for (let i = 0; i < 12; i++) {
    const page = large.addPage([595,842]); const embedded = await large.embedFont(StandardFonts.Helvetica);
    for (let line = 0; line < 70; line++) page.drawText("Lancamento financeiro: pagamento em 25/10/2026, valor de R$ 1.200,00, conferir registro.", { x: 15, y: 810 - line * 11, font: embedded, size: 6 });
  }
  await assert.rejects(extractSummary(await large.save(), options, new AbortController().signal, false), /limites|menos páginas/);
});

test("stress resumo: trabalhos nativos concorrentes são recusados e os temporários são limpos em falhas", async () => {
  let inputPath = ""; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
  const running = withNativeJob(new Uint8Array([1,2,3]), "pdf", async job => { inputPath = job.inputPath; entered(); await gate; throw Error("synthetic failure"); });
  const rejection = assert.rejects(running, /synthetic failure/);
  await ready;
  try { await assert.rejects(withNativeJob(new Uint8Array([4]), "pdf", async () => {}), /ocupado/); }
  finally { release(); }
  await rejection; await assert.rejects(access(inputPath));
  await withNativeJob(new Uint8Array([1]), "pdf", async () => {});
});
