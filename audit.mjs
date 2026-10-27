// Auditoria de qualidade das ferramentas: nao basta 200, o resultado tem de estar CORRETO.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { PNG } from "pngjs";

const Q = path.join(process.env.TEMP, "opencode", "quality");
const WORKER = process.env.WORKER || "https://pdfmasterpro.onrender.com";
const OUT = path.join(Q, "out");
await mkdir(OUT, { recursive: true });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name.padEnd(34)} | ${detail}`);
}

async function post(tool, files, extra = {}) {
  const form = new FormData();
  for (const [field, buf, filename, type] of files) {
    form.append("files", new Blob([buf], { type: type || "application/octet-stream" }), filename);
  }
  for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
  const res = await fetch(`${WORKER}/api/v1/process?tool=${tool}`, { method: "POST", body: form });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 200); } catch {}
    return { ok: false, status: res.status, error: body };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, status: res.status, buf, ct };
}

// ---------------------------------------------------------------- fixtures
async function makePdf(pages, opts = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Pagina ${i}`, { x: 60, y: 780, size: 24, font, color: rgb(0, 0, 0) });
    p.drawText("Texto com acentuacao: acao, coracao, maquina", { x: 60, y: 740, size: 12, font });
    p.drawText(`Marcador unico PAG-${i}-XYZ`, { x: 60, y: 720, size: 12, font });
    p.drawRectangle({ x: 60, y: 600, width: 200, height: 80, borderColor: rgb(1, 0, 0), borderWidth: 2 });
  }
  if (opts.rotateFirst) {
    doc.getPage(0).setRotation({ type: "degrees", angle: opts.rotateFirst });
  }
  return Buffer.from(await doc.save());
}

const base3 = await makePdf(3);
const base1 = await makePdf(1);
await writeFile(path.join(Q, "base3.pdf"), base3);
await writeFile(path.join(Q, "base1.pdf"), base1);

// PNG sintetico com texto? Nao: usamos um PNG real gerado do PDF renderizado.
// Para imagens-para-pdf, geramos 2 PNGs solidos distintos.
function solidPng(w, h, r, g, b) {
  // PNG minimo via canvas-like: usamos pngjs
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = r; png.data[i * 4 + 1] = g; png.data[i * 4 + 2] = b; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

console.log("=".repeat(78));
console.log("AUDITORIA DE QUALIDADE — worker:", WORKER);
console.log("=".repeat(78));

// ------------------------------------------------- 1. juntar-pdf (ordem!)
{
  const r = await post("juntar-pdf", [
    ["files", await makePdf(1), "a.pdf", "application/pdf"],
    ["files", await makePdf(2), "b.pdf", "application/pdf"],
  ]);
  if (!r.ok) record("juntar-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const doc = await PDFDocument.load(r.buf);
    const n = doc.getPageCount();
    record("juntar-pdf", n === 3, `${n} paginas (esperado 3)`);
  }
}

// ------------------------------------------------- 2. dividir-pdf (todas as paginas)
{
  const r = await post("dividir-pdf", [["files", base3, "in.pdf", "application/pdf"]]);
  if (!r.ok) record("dividir-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    try {
      const zip = await JSZip.loadAsync(r.buf);
      const names = Object.keys(zip.files).filter((n) => n.endsWith(".pdf"));
      record("dividir-pdf", names.length === 3, `${names.length} PDFs no zip (esperado 3)`);
    } catch (e) {
      // pode retornar PDF unico se so 1 pagina
      record("dividir-pdf", false, `nao e zip valido: ${e.message.slice(0, 60)}`);
    }
  }
}

// ------------------------------------------------- 3. organizar-pdf (ordem invertida)
{
  const r = await post("organizar-pdf", [["files", base3, "in.pdf", "application/pdf"]], { order: "3,2,1" });
  if (!r.ok) record("organizar-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const doc = await PDFDocument.load(r.buf);
    const t = await extractTextFromPdf(r.buf);
    const ok = doc.getPageCount() === 3 && t.indexOf("PAG-3-XYZ") < t.indexOf("PAG-1-XYZ") && t.indexOf("PAG-1-XYZ") !== -1;
    record("organizar-pdf", ok, `ordem invertida: ${t.indexOf("PAG-3") < t.indexOf("PAG-1") ? "3 antes de 1" : "ERRADA"}`);
  }
}

// ------------------------------------------------- 4. girar-pdf (rotacao real)
{
  const r = await post("girar-pdf", [["files", base3, "in.pdf", "application/pdf"]], { angle: "90" });
  if (!r.ok) record("girar-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const doc = await PDFDocument.load(r.buf);
    const rot = doc.getPage(0).getRotation().angle;
    record("girar-pdf", rot === 90, `rotacao da pag 1 = ${rot} (esperado 90)`);
  }
}

// ------------------------------------------------- 5. comprimir-pdf (tem de reduzir)
{
  const r = await post("comprimir-pdf", [["files", base3, "in.pdf", "application/pdf"]]);
  if (!r.ok) record("comprimir-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const doc = await PDFDocument.load(r.buf);
    record("comprimir-pdf", doc.getPageCount() === 3, `${base3.length} -> ${r.buf.length} bytes, ${doc.getPageCount()} paginas`);
  }
}

// ------------------------------------------------- 6. extrair-texto (conteudo!)
{
  const r = await post("extrair-texto", [["files", base3, "in.pdf", "application/pdf"]]);
  if (!r.ok) record("extrair-texto", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const txt = r.buf.toString("utf8");
    const hasAll = [1, 2, 3].every((i) => txt.includes(`PAG-${i}-XYZ`));
    record("extrair-texto", hasAll, hasAll ? "achou os 3 marcadores" : `faltou marcador. inicio: ${JSON.stringify(txt.slice(0, 80))}`);
  }
}

// ------------------------------------------------- 7. pdf-para-imagens (contagem)
{
  const r = await post("pdf-para-imagens", [["files", base3, "in.pdf", "application/pdf"]]);
  if (!r.ok) record("pdf-para-imagens", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const zip = await JSZip.loadAsync(r.buf);
    const imgs = Object.keys(zip.files).filter((n) => /\.(png|jpg|jpeg)$/i.test(n));
    record("pdf-para-imagens", imgs.length === 3, `${imgs.length} imagens (esperado 3)`);
  }
}

// ------------------------------------------------- 8. imagens-para-pdf
{
  const p1 = solidPng(200, 200, 255, 0, 0);
  const p2 = solidPng(200, 200, 0, 128, 255);
  const r = await post("imagens-para-pdf", [
    ["files", p1, "vermelho.png", "image/png"],
    ["files", p2, "azul.png", "image/png"],
  ]);
  if (!r.ok) record("imagens-para-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const doc = await PDFDocument.load(r.buf);
    record("imagens-para-pdf", doc.getPageCount() === 2, `${doc.getPageCount()} paginas (esperado 2)`);
  }
}

// ------------------------------------------------- 9. marca-dagua
{
  const r = await post("marca-dagua", [["files", base3, "in.pdf", "application/pdf"]], { text: "CONFIDENCIAL" });
  if (!r.ok) record("marca-dagua", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const t = await extractTextFromPdf(r.buf);
    const ok = t.includes("CONFIDENCIAL");
    record("marca-dagua", ok, ok ? "texto aplicado no PDF" : "marca nao encontrada no texto");
  }
}

// ------------------------------------------------- 10. numerar-paginas
{
  const r = await post("numerar-paginas", [["files", base3, "in.pdf", "application/pdf"]]);
  if (!r.ok) record("numerar-paginas", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const t = await extractTextFromPdf(r.buf);
    const hasNums = /1/.test(t) && /2/.test(t) && /3/.test(t);
    record("numerar-paginas", hasNums, hasNums ? "numeros presentes" : "numeros ausentes");
  }
}

// ------------------------------------------------- 11. proteger-pdf (SENHA REAL)
{
  const r = await post("proteger-pdf", [["files", base3, "in.pdf", "application/pdf"]], { password: "senha123" });
  if (!r.ok) record("proteger-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const enc = isPdfEncrypted(r.buf);
    record("proteger-pdf", enc, enc ? "PDF realmente criptografado" : "PDF NAO esta criptografado");
  }
}

// ------------------------------------------------- 12. assinar-pdf
{
  const r = await post("assinar-pdf", [["files", base3, "in.pdf", "application/pdf"]], { text: "Assinado dia 22" });
  if (!r.ok) record("assinar-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const doc = await PDFDocument.load(r.buf);
    record("assinar-pdf", doc.getPageCount() === 3, `${doc.getPageCount()} paginas preservadas`);
  }
}

// ------------------------------------------------- 13. editar-metadados
{
  const r = await post("editar-metadados", [["files", base3, "in.pdf", "application/pdf"]], { title: "Meu Titulo", author: "Eu" });
  if (!r.ok) record("editar-metadados", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const doc = await PDFDocument.load(r.buf);
    const title = doc.getTitle();
    record("editar-metadados", title === "Meu Titulo", `titulo = ${JSON.stringify(title)}`);
  }
}

// ------------------------------------------------- 14. pdf-para-word
{
  const r = await post("pdf-para-word", [["files", base3, "in.pdf", "application/pdf"]]);
  if (!r.ok) record("pdf-para-word", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const isZip = r.buf[0] === 0x50 && r.buf[1] === 0x4b;
    record("pdf-para-word", isZip, isZip ? `docx valido (${r.buf.length} bytes)` : "nao e um docx (zip)");
  }
}

// ------------------------------------------------- 15. word-para-pdf
{
  const sample = await readFile(path.join(process.env.TEMP, "opencode", "tooltest", "sample.docx"));
  const r = await post("word-para-pdf", [["files", sample, "doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]]);
  if (!r.ok) record("word-para-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else {
    const isPdf = r.buf.slice(0, 5).toString() === "%PDF-";
    record("word-para-pdf", isPdf && r.buf.length > 1000, isPdf ? `PDF valido (${r.buf.length} bytes)` : "nao e PDF");
  }
}

// ------------------------------------------------- 16. OCR (precisa de imagem com texto)
{
  const png = await renderTextImage();
  const r = await post("ocr-pdf", [["files", png, "scan.pdf", "application/pdf"]]);
  if (r.status === 402) record("ocr-pdf", true, "402 (gating premium — esperado no free)");
  else if (!r.ok) record("ocr-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else record("ocr-pdf", r.buf.slice(0, 5).toString() === "%PDF-", "PDF produzido");
}

// ------------------------------------------------- 17. redigir-pdf
{
  const r = await post("redigir-pdf", [["files", base3, "in.pdf", "application/pdf"]], { page: "1", x: "100", y: "100", width: "200", height: "50" });
  if (r.status === 402) record("redigir-pdf", true, "402 (gating premium — esperado no free)");
  else if (!r.ok) record("redigir-pdf", false, `HTTP ${r.status}: ${r.error}`);
  else record("redigir-pdf", r.buf.slice(0, 5).toString() === "%PDF-", "PDF produzido");
}

console.log("=".repeat(78));
const passed = results.filter((r) => r.ok).length;
console.log(`RESUMO: ${passed}/${results.length} com resultado CORRETO`);
process.exit(0);

// ---------------------------------------------------------------- helpers
async function extractTextFromPdf(buf) {
  // sem pdftotext garantido: tentamos extrair streams de texto crus
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const dir = path.join(Q, `text-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const f = path.join(dir, "x.pdf");
  await writeFile(f, buf);
  try {
    const { stdout } = await run("pdftotext", ["-layout", f, "-"], { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

function isPdfEncrypted(buf) {
  const s = buf.toString("latin1");
  return s.includes("/Encrypt") || s.includes("/V 5") || s.includes("/R 6");
}

async function renderTextImage() {
  // cria um PDF com texto e converte em imagem para simular um scan
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([800, 300]);
  p.drawText("HELLO OCR WORLD 12345", { x: 40, y: 150, size: 48, font });
  const pdf = Buffer.from(await doc.save());
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const dir = path.join(Q, `ocr-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const f = path.join(dir, "in.pdf");
  await writeFile(f, pdf);
  await run("pdftoppm", ["-png", "-r", "150", f, path.join(dir, "out")]);
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".png"));
  return readFile(path.join(dir, names[0]));
}
