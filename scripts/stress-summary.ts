import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import JSZip from "jszip";
import { execFile } from "../lib/processing/system";
import { summaryStream } from "../lib/summary/stream";
import { summaryResultSchema, type SummaryOptions } from "../lib/summary/types";
import { summaryText, summaryDocx, summaryPdf, exportText } from "../lib/summary/export";
const dir = ".vercel/review/resumomaster";
async function run(name: string, bytes: Uint8Array, options: SummaryOptions) {
  const started = Date.now();
  const response = summaryStream(bytes, name + ".pdf", options, new AbortController().signal);
  const events = (await response.text()).split("\n\n").filter(s => s.startsWith("data: ")).map(s => JSON.parse(s.slice(6)));
  const error = events.find(event => event.type === "error"); if (error) throw Error(name + ": " + error.message);
  const result = summaryResultSchema.parse(events.find(event => event.type === "result")?.result);
  const text = summaryText(result); const txt = exportText(result, text, false);
  const docx = await summaryDocx(result, text, false); const xml = await (await JSZip.loadAsync(docx)).file("word/document.xml")!.async("string");
  assert.ok(xml.includes("1.200,00")); assert.ok(text.includes("25/10/2026"));
  const pdf = await summaryPdf(result, text, false, new Uint8Array(await readFile("public/fonts/NotoSans-Regular.ttf"))); assert.ok((await PDFDocument.load(pdf)).getPageCount() > 0);
  await writeFile(`${dir}/${name}-resumo.txt`, txt); await writeFile(`${dir}/${name}-resumo.docx`, docx); await writeFile(`${dir}/${name}-resumo.pdf`, pdf);
  const report = { name, milliseconds: Date.now() - started, inputBytes: bytes.length, totalPages: result.totalPages, analyzed: result.analyzedPages.length, unread: result.unreadPages, points: result.points.length, calls: result.usage.calls, chunks: result.usage.chunks, provider: result.provider, referenceToLastThird: result.sources.some(source => source.page > result.totalPages * 2 / 3), exports: ["PDF", "DOCX", "TXT"], warnings: result.warnings };
  console.log(JSON.stringify(report)); return report;
}
async function main() {
  if (process.env.SUMMARY_LIVE_STRESS !== "true") throw Error("Set SUMMARY_LIVE_STRESS=true to authorize bounded real-provider calls with synthetic PDFs.");
  process.loadEnvFile(".env.summary");
  await mkdir(dir, { recursive: true });
  const options: SummaryOptions = { consent: true, length: "long", mode: "standard", pages: "", instructions: "Resuma os registros financeiros e os prazos com valores e datas; inclua informacoes do inicio e do final do documento." };
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 36; page++) {
    const sheet = pdf.addPage([595,842]);
    for (let line = 1; line <= 13; line++) sheet.drawText(`Registro ${page}, item ${line}: Maria deve pagar R$ 1.200,00 em 25/10/2026. Conferir contrato e comprovante.`, { x: 20, y: 800 - line * 20, font, size: 8 });
  }
  const bytes = await pdf.save(); await writeFile(`${dir}/stress-36-paginas.pdf`, bytes);
  const large = await run("stress-36-paginas", bytes, options); assert.equal(large.analyzed, 36); assert.ok(large.chunks >= 6); assert.equal(large.referenceToLastThird, true);
  const original = await PDFDocument.create(); const scanfont = await original.embedFont(StandardFonts.Helvetica); original.addPage([595,842]).drawText("Maria deve pagar R$ 1.200,00 em 25/10/2026.", { x: 40, y: 750, font: scanfont, size: 14 });
  await writeFile(`${dir}/stress-scan-original.pdf`, await original.save());
  await execFile(process.env.PDF_TO_WORD_PYTHON!, ["-c", "import fitz,sys;d=fitz.open(sys.argv[1]);d[0].get_pixmap(matrix=fitz.Matrix(2,2)).save(sys.argv[2])", `${dir}/stress-scan-original.pdf`, `${dir}/stress-scan.png`], { timeout: 20000, windowsHide: true });
  const scan = await PDFDocument.create(); const image = await scan.embedPng(await readFile(`${dir}/stress-scan.png`));
  for (let i = 0; i < 12; i++) scan.addPage([595,842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  const scanbytes = await scan.save(); await writeFile(`${dir}/stress-scan-12.pdf`, scanbytes);
  const scanned = await run("stress-scan-12", scanbytes, { ...options, length: "short" });
  assert.equal(scanned.analyzed, 10); assert.deepEqual(scanned.unread, [11,12]); assert.ok(scanned.warnings.some(w => w.includes("OCR")));
  await writeFile(`${dir}/stress-real-report.json`, JSON.stringify({ syntheticDocumentsOnly: true, localPipelineWithRealProviders: true, productionAuthenticatedUploadTested: false, cases: [large, scanned] }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Falha no teste"); process.exitCode = 1; });
