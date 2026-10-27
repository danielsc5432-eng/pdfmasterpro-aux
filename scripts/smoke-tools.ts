import assert from "node:assert/strict";
import { signPlanHeaders } from "../lib/billing/plan-token";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { PNG } from "pngjs";

const run = promisify(execFile);
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const results: { tool: string; ok: boolean; detail: string }[] = [];

async function makePdf(pageCount: number, options: { rotation?: number; text?: string } = {}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index++) {
    const page = document.addPage([400, 560]);
    page.drawText(`${options.text || "Documento de teste"} - pagina ${index + 1}`, { x: 40, y: 500, size: 16, font, color: rgb(0, 0, 0) });
    page.drawText("linha de continuacao do paragrafo", { x: 40, y: 478, size: 12, font, color: rgb(0, 0, 0) });
    if (options.rotation) page.setRotation(degrees(options.rotation));
  }
  return document.save();
}

function makePng(width = 60, height = 40) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const idx = (width * y + x) << 2; png.data[idx] = 90; png.data[idx + 1] = 90; png.data[idx + 2] = 214; png.data[idx + 3] = 255; }
  return PNG.sync.write(png);
}

async function makeDocx() {
  const document = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("Relatorio gerado para o teste de conversao Word para PDF.")] }), new Paragraph({ children: [new TextRun("Segunda linha do documento de teste.")] })] }] });
  return new Uint8Array(await Packer.toBuffer(document));
}

async function makeRenderableImage(file: string) {
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$bmp = New-Object System.Drawing.Bitmap 900, 300`,
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.Clear([System.Drawing.Color]::White)",
    "$font = New-Object System.Drawing.Font 'Arial', 42, ([System.Drawing.FontStyle]::Bold)",
    "$g.DrawString('PDF MASTER PRO 12345', $font, [System.Drawing.Brushes]::Black, 30, 110)",
    "$g.Dispose()",
    `$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$bmp.Save('" + file.replace(/\.png$/, ".jpg") + "', [System.Drawing.Imaging.ImageFormat]::Jpeg)",
    "$bmp.Dispose()",
  ].join("; ");
  await run("powershell", ["-NoProfile", "-Command", script], { windowsHide: true, timeout: 60000 });
}

type Response = { status: number; bytes: Uint8Array; type: string; error?: string };
async function call(tool: string, files: { name: string; bytes: Uint8Array; type: string }[], fields: Record<string, string> = {}): Promise<Response> {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([file.bytes as BlobPart], { type: file.type }), file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const response = await fetch(`${BASE}/api/v1/process?tool=${tool}`, { method: "POST", body: form, headers: process.env.SMOKE_PREMIUM === "1" ? signPlanHeaders("premium-monthly") || {} : {} });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) { let error = ""; try { error = JSON.parse(new TextDecoder().decode(bytes)).error; } catch { /* ignore */ } return { status: response.status, bytes, type: "", error }; }
  return { status: response.status, bytes, type: response.headers.get("content-type") || "" };
}

async function expect(tool: string, response: Response, check: (response: Response) => Promise<string> | string) {
  console.log("CHECK " + tool + ": HTTP " + response.status);
  if (process.env.SMOKE_PREMIUM !== "1" && /^(ocr-pdf|redigir-pdf)/.test(tool)) {
    results.push({ tool, ok: response.status === 402, detail: "Premium access check: HTTP " + response.status });
    return;
  }
  if (response.status !== 200) { results.push({ tool, ok: false, detail: `HTTP ${response.status}: ${response.error || "sem detalhe"}` }); return; }
  try { results.push({ tool, ok: true, detail: await check(response) }); } catch (error) { results.push({ tool, ok: false, detail: error instanceof Error ? error.message : String(error) }); }
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pdfmaster-smoke-"));
  try {
    const pdf3 = await makePdf(3);
    const pdf1 = await makePdf(1);
    const rotated = await makePdf(1, { rotation: 90 });
    const png1 = new Uint8Array(makePng());
    const png2 = new Uint8Array(makePng(120, 80));
    const docx = await makeDocx();
    await makeRenderableImage(path.join(dir, "texto.png"));
    const textPng = new Uint8Array(await readFile(path.join(dir, "texto.png")));
    const textJpg = new Uint8Array(await readFile(path.join(dir, "texto.jpg")));
    const scanned = await PDFDocument.create();
    const scannedImage = await scanned.embedPng(textPng);
    const scannedPage = scanned.addPage([900, 300]);
    scannedPage.drawImage(scannedImage, { x: 0, y: 0, width: 900, height: 300 });
    const scannedPdf = await scanned.save();
    const file = (name: string, bytes: Uint8Array, type: string) => ({ name, bytes, type });
    const pdf = (name: string, bytes: Uint8Array) => file(name, bytes, "application/pdf");

    await expect("juntar-pdf", await call("juntar-pdf", [pdf("a.pdf", pdf1), pdf("b.pdf", pdf3)]), async (response) => { const count = (await PDFDocument.load(response.bytes)).getPageCount(); assert.ok(count > 0); return "PDF com " + count + " paginas"; });

    await expect("dividir-pdf (intervalo)", await call("dividir-pdf", [pdf("doc.pdf", pdf3)], { mode: "range", start: "2", end: "3" }), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas`);

    await expect("dividir-pdf (zip)", await call("dividir-pdf", [pdf("doc.pdf", pdf3)], { mode: "pages" }), async (response) => `ZIP com ${Object.keys((await JSZip.loadAsync(response.bytes)).files).length} arquivos`);

    await expect("girar-pdf", await call("girar-pdf", [pdf("doc.pdf", rotated)], { angle: "90" }), async (response) => `rotação final ${(await PDFDocument.load(response.bytes)).getPage(0).getRotation().angle}°`);

    await expect("organizar-pdf", await call("organizar-pdf", [pdf("doc.pdf", pdf3)], { order: "3,1,2" }), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas`);

    await expect("imagens-para-pdf (PNG)", await call("imagens-para-pdf", [file("a.png", png1, "image/png"), file("b.png", png2, "image/png")], { pageSize: "a4", margin: "12" }), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas`);

    await expect("imagens-para-pdf (JPG)", await call("imagens-para-pdf", [file("texto.jpg", textJpg, "image/jpeg")], { pageSize: "auto", margin: "0" }), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} página`);

    await expect("pdf-para-imagens", await call("pdf-para-imagens", [pdf("doc.pdf", pdf3)], { start: "1", end: "2" }), async (response) => `ZIP com ${Object.keys((await JSZip.loadAsync(response.bytes)).files).length} imagens`);

    await expect("comprimir-pdf", await call("comprimir-pdf", [pdf("doc.pdf", pdf3)]), async (response) => { assert.ok(response.bytes.length <= pdf3.length, "Compression increased the file size"); assert.equal((await PDFDocument.load(response.bytes)).getPageCount(), 3); return "3 pages; " + response.bytes.length + " bytes (input: " + pdf3.length + ")"; });

    await expect("pdf-para-word", await call("pdf-para-word", [pdf("doc.pdf", pdf3)]), async (response) => {
      const zip = await JSZip.loadAsync(response.bytes);
      const entry = zip.file("word/document.xml");
      if (!entry) throw new Error("DOCX sem word/document.xml");
      const xml = await entry.async("string");
      // Match text elements, not w:tabs/w:tab. Position-preserving DOCX uses
      // tab stops between words, which are whitespace rather than lost text.
      const text = (xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || []).map((item) => item.replace(/<[^>]+>/g, "")).join(" ").replace(/\s+/g, " ").trim();
      if (!text.includes("pagina 3")) throw new Error("o texto do PDF não chegou ao DOCX");
      if (!text.includes("linha de continuacao do paragrafo")) throw new Error("texto secundário ausente no DOCX");
      const frames = xml.match(/<w:framePr[^>]*>/g) || [];
      const sections = xml.match(/<w:sectPr/g) || [];
      if (!frames.length && !sections.length) throw new Error("DOCX sem estrutura de páginas");
      if (frames.length) {
        // Motor de reconstrução: blocos com posição absoluta herdada do PDF.
        if (!/w:x="\d+"/.test(xml) || !/w:y="\d+"/.test(xml)) throw new Error("blocos sem posição absoluta no DOCX");
        const positions = new Set([...xml.matchAll(/w:y="(\d+)"/g)].map((match) => match[1]));
        if (positions.size < 2) throw new Error("posições verticais absolutas não foram preservadas");
      }
      if (!/w:ascii="Arial"/.test(xml)) throw new Error("fonte extraída do PDF não foi aplicada");
      const sizes = new Set([...xml.matchAll(/<w:sz w:val="(\d+)"/g)].map((match) => match[1]));
      if (sizes.size < 2) throw new Error(`tamanhos de fonte não preservados: ${[...sizes].join(", ")}`);
      return `DOCX com layout: ${frames.length ? `${frames.length} blocos posicionados` : "Microsoft Word (fluxo nativo)"}`;
    });
    await expect("word-para-pdf", await call("word-para-pdf", [file("doc.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas`);

    await expect("ocr-pdf (imagem)", await call("ocr-pdf", [file("texto.png", textPng, "image/png")], { language: "por+eng" }), async (response) => `PDF OCR com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas`);

    await expect("ocr-pdf (pdf digitalizado)", await call("ocr-pdf", [pdf("scan.pdf", scannedPdf)], { language: "por+eng" }), async (response) => `PDF OCR com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas`);

    await expect("extrair-texto", await call("extrair-texto", [pdf("doc.pdf", pdf3)]), async (response) => { const text = new TextDecoder().decode(response.bytes); if (!text.includes("Documento de teste")) throw new Error("texto extraído não contém o conteúdo esperado"); return `${text.trim().length} caracteres extraídos`; });

    await expect("marca-dagua", await call("marca-dagua", [pdf("doc.pdf", pdf3)], { text: "CONFIDENCIAL", opacity: "0.3", rotation: "45", position: "center", color: "#ff0000" }), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas`);

    await expect("numerar-paginas", await call("numerar-paginas", [pdf("doc.pdf", pdf3)], { format: "Página {n}", position: "bottom-center", start: "1", size: "12", color: "#202431" }), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas`);

    await expect("assinar-pdf", await call("assinar-pdf", [pdf("doc.pdf", pdf1)], { text: "João da Silva", position: "bottom-right" }), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} página`);

    await expect("proteger-pdf", await call("proteger-pdf", [pdf("doc.pdf", pdf1)], { password: "segredo123", passwordConfirm: "segredo123" }), (response) => `${response.bytes.length} bytes protegidos`);

    await expect("editar-metadados", await call("editar-metadados", [pdf("doc.pdf", pdf1)], { title: "Contrato", author: "Equipe", subject: "Revisão", keywords: "pdf, teste" }), async (response) => { const document = await PDFDocument.load(response.bytes); if (document.getTitle() !== "Contrato") throw new Error("título não aplicado"); return "metadados aplicados"; });

    await expect("redigir-pdf", await call("redigir-pdf", [pdf("doc.pdf", pdf3)], { page: "2", x: "36", y: "36", width: "200", height: "60" }), async (response) => `PDF com ${(await PDFDocument.load(response.bytes)).getPageCount()} páginas, apenas a página 2 rasterizada`);


    await expect("redigir-pdf (rotacionado)", await call("redigir-pdf", [pdf("rotated.pdf", rotated)], { page: "1", x: "36", y: "36", width: "100", height: "50" }), async (response) => {
      const page = (await PDFDocument.load(response.bytes)).getPage(0);
      assert.equal(page.getWidth(), 560);
      assert.equal(page.getHeight(), 400);
      assert.equal(page.getRotation().angle, 0);
      return "landscape orientation preserved after rasterization";
    });

    await expect("validar arquivo falso", await call("juntar-pdf", [file("fake.pdf", new TextEncoder().encode("não é pdf"), "application/pdf")]), (response) => { throw new Error(`esperava rejeição, recebeu HTTP ${response.status}`); });
    results[results.length - 1].ok = results[results.length - 1].detail.includes("HTTP 422");
    results[results.length - 1].detail = "HTTP " + (results[results.length - 1].ok ? "422 (rejeitado corretamente)" : "inesperado");

    for (const [label, slug, fields, status] of [
      ["ferramenta desconhecida", "inexistente", {}, 404],
      ["rotacao invalida", "girar-pdf", { angle: "45" }, 422],
      ["pagina fora do documento", "dividir-pdf", { start: "10", end: "12" }, 422],
      ["confirmacao de senha", "proteger-pdf", { password: "segredo123", passwordConfirm: "outro" }, 400],
      ["senha curta", "proteger-pdf", { password: "123", passwordConfirm: "123" }, 400],
    ] as const) {
      const response = await call(slug, [pdf("doc.pdf", pdf1)], fields);
      results.push({ tool: label, ok: response.status === status, detail: "HTTP " + response.status + " (esperado " + status + ")" });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const result of results) {
    if (!result.ok) failures++;
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.tool.padEnd(24)} ${result.detail}`);
  }
  console.log(`\n${results.length - failures}/${results.length} verificações aprovadas.`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
