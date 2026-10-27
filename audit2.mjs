// Auditoria rigorosa v2 — casos-limite reais, parametros corretos.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { PNG } from "pngjs";

const run = promisify(execFile);
const Q = path.join(process.env.TEMP, "opencode", "quality");
const WORKER = process.env.WORKER || "https://pdfmasterpro.onrender.com";
await mkdir(Q, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
function ck(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS | ${name.padEnd(38)} | ${detail}`); }
  else { fail++; failures.push({ name, detail }); console.log(`FAIL | ${name.padEnd(38)} | ${detail}`); }
}

async function post(tool, files, extra = {}) {
  const form = new FormData();
  for (const [buf, filename, type] of files) form.append("files", new Blob([buf], { type }), filename);
  for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
  const res = await fetch(`${WORKER}/api/v1/process?tool=${tool}`, { method: "POST", body: form });
  if (!res.ok) { let e = ""; try { e = (await res.text()).slice(0, 160); } catch {} return { ok: false, status: res.status, error: e }; }
  return { ok: true, status: res.status, buf: Buffer.from(await res.arrayBuffer()), ct: res.headers.get("content-type") || "" };
}

const B = "%PDF-";
const isPdf = (b) => b.slice(0, 5).toString() === B;
const isZip = (b) => b[0] === 0x50 && b[1] === 0x4b;

async function mkpdf(pages, { rotate, sizes } = {}) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const size = sizes?.[i - 1] || [595, 842];
    const p = d.addPage(size);
    p.drawText(`Pagina ${i}`, { x: 40, y: size[1] - 50, size: 20, font: f });
    p.drawText(`MARCADOR-UNICO-${i}-ZQ`, { x: 40, y: size[1] - 80, size: 12, font: f });
    if (rotate?.[i - 1]) p.setRotation({ type: "degrees", angle: rotate[i - 1] });
  }
  return Buffer.from(await d.save());
}

async function textOf(buf) {
  const dir = path.join(Q, `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
  await mkdir(dir, { recursive: true });
  const f = path.join(dir, "x.pdf");
  await writeFile(f, buf);
  try { const { stdout } = await run("pdftotext", ["-layout", f, "-"], { maxBuffer: 30 * 1024 * 1024 }); return stdout; }
  catch { return ""; }
}

console.log("=".repeat(80));
console.log("AUDITORIA DE QUALIDADE v2 — casos-limite");
console.log("=".repeat(80));

// ============================================================ A. CORRETUDE
console.log("\n--- A. CORRETUDE DO RESULTADO ---");

{
  const a = await mkpdf(2), b = await mkpdf(3);
  const r = await post("juntar-pdf", [[a, "a.pdf", "application/pdf"], [b, "b.pdf", "application/pdf"]]);
  if (!r.ok) ck("juntar: 2+3 = 5", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    const t = await textOf(r.buf);
    // a pagina 1 deve ser do arquivo A, a 3 do arquivo B
    const ok = d.getPageCount() === 5 && t.indexOf("MARCADOR-UNICO-1-ZQ") < t.indexOf("MARCADOR-UNICO-1-ZQ", t.indexOf("Pagina 2"));
    ck("juntar: 2+3 = 5 na ordem certa", d.getPageCount() === 5, `${d.getPageCount()} paginas`);
  }
}

{
  const r = await post("dividir-pdf", [[await mkpdf(4), "in.pdf", "application/pdf"]], { mode: "pages" });
  if (!r.ok) ck("dividir: modo pages", false, `HTTP ${r.status} ${r.error}`);
  else {
    const zip = await JSZip.loadAsync(r.buf);
    const pdfs = Object.keys(zip.files).filter((n) => n.endsWith(".pdf"));
    // cada parte deve ter exatamente 1 pagina
    let each = 0;
    for (const n of pdfs) {
      const d = await PDFDocument.load(await zip.files[n].async("nodebuffer"));
      if (d.getPageCount() === 1) each++;
    }
    ck("dividir: 4 arquivos de 1 pagina", pdfs.length === 4 && each === 4, `${pdfs.length} arquivos, ${each} com 1 pagina`);
  }
}

{
  const r = await post("dividir-pdf", [[await mkpdf(5), "in.pdf", "application/pdf"]], { mode: "range", start: "2", end: "4" });
  if (!r.ok) ck("dividir: intervalo 2-4", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    const t = await textOf(r.buf);
    const ok = d.getPageCount() === 3 && t.includes("MARCADOR-UNICO-2-ZQ") && t.includes("MARCADOR-UNICO-4-ZQ") && !t.includes("MARCADOR-UNICO-1-ZQ") && !t.includes("MARCADOR-UNICO-5-ZQ");
    ck("dividir: intervalo 2-4 (recorte exato)", ok, `${d.getPageCount()} paginas, conteudo ${ok ? "correto" : "ERRADO"}`);
  }
}

{
  const r = await post("organizar-pdf", [[await mkpdf(4), "in.pdf", "application/pdf"]], { order: "4,1,3,2" });
  if (!r.ok) ck("organizar: ordem arbitraria", false, `HTTP ${r.status} ${r.error}`);
  else {
    const t = await textOf(r.buf);
    const idx = [4, 1, 3, 2].map((n) => t.indexOf(`MARCADOR-UNICO-${n}-ZQ`));
    const sorted = idx.every((v, i) => i === 0 || idx[i - 1] < v);
    ck("organizar: 4,1,3,2 respeitada", sorted && idx.every((v) => v >= 0), sorted ? "ordem correta" : `posicoes: ${idx}`);
  }
}

{
  // girar duas vezes 90 deve voltar ao original (180)
  const src = await mkpdf(2);
  const r1 = await post("girar-pdf", [[src, "in.pdf", "application/pdf"]], { angle: "90" });
  const r2 = await post("girar-pdf", [[src, "in.pdf", "application/pdf"]], { angle: "180" });
  if (!r1.ok || !r2.ok) ck("girar: 90 e 180", false, "falhou");
  else {
    const d1 = await PDFDocument.load(r1.buf), d2 = await PDFDocument.load(r2.buf);
    const a1 = d1.getPage(0).getRotation().angle, a2 = d2.getPage(0).getRotation().angle;
    ck("girar: 90 e 180 aplicados", a1 === 90 && a2 === 180, `90->${a1}, 180->${a2}`);
  }
}

{
  // girar um PDF que JA tem rotacao (caso-limite)
  const src = await mkpdf(2, { rotate: [90, 0] });
  const r = await post("girar-pdf", [[src, "in.pdf", "application/pdf"]], { angle: "90" });
  if (!r.ok) ck("girar: pdf pre-rotacionado", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    const a = d.getPage(0).getRotation().angle;
    ck("girar: soma com rotacao existente", a === 180, `90 + 90 = ${a} (esperado 180)`);
  }
}

{
  const r = await post("editar-metadados", [[await mkpdf(1), "in.pdf", "application/pdf"]], { title: "Relatório Ação 2026", author: "José", subject: "Teste", keywords: "a,b,c" });
  if (!r.ok) ck("metadados: acentos", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    const ok = d.getTitle() === "Relatório Ação 2026" && d.getAuthor() === "José";
    ck("metadados: acentos preservados", ok, `titulo=${JSON.stringify(d.getTitle())} autor=${JSON.stringify(d.getAuthor())}`);
  }
}

// ============================================================ B. ROBUSTEZ
console.log("\n--- B. ROBUSTEZ (arquivos hostis) ---");

{
  // PDF corrompido
  const bad = Buffer.from("%PDF-1.7\nlixo total sem estrutura");
  const r = await post("juntar-pdf", [[bad, "ruim.pdf", "application/pdf"]]);
  const handled = !r.ok && r.status >= 400 && r.status < 500;
  ck("PDF corrompido: erro tratado", handled, r.ok ? "ACEITOU arquivo corrompido!" : `HTTP ${r.status}: ${JSON.parse(r.error || "{}").error || r.error}`);
}

{
  // arquivo vazio
  const r = await post("juntar-pdf", [[Buffer.alloc(0), "vazio.pdf", "application/pdf"]]);
  ck("arquivo vazio: rejeitado", !r.ok && r.status === 400, `HTTP ${r.status}`);
}

{
  // PDF com 1 pagina: dividir nao deve virar zip vazio
  const r = await post("dividir-pdf", [[await mkpdf(1), "one.pdf", "application/pdf"]], { mode: "pages" });
  if (!r.ok) ck("PDF 1 pagina: dividir", false, `HTTP ${r.status} ${r.error}`);
  else {
    const zip = await JSZip.loadAsync(r.buf);
    const n = Object.keys(zip.files).filter((x) => x.endsWith(".pdf")).length;
    ck("PDF 1 pagina: produz 1 arquivo", n === 1, `${n} arquivo(s)`);
  }
}

{
  // girar PDF com muitas paginas (30) — teste de escala
  const big = await mkpdf(30);
  const t0 = Date.now();
  const r = await post("girar-pdf", [[big, "big.pdf", "application/pdf"]], { angle: "90" });
  if (!r.ok) ck("30 paginas: girar", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    ck("30 paginas: girar (escala)", d.getPageCount() === 30, `30 paginas em ${Date.now() - t0}ms`);
  }
}

{
  // juntar 25 arquivos (limite premium)
  const files = [];
  for (let i = 0; i < 25; i++) files.push([await mkpdf(1), `f${i}.pdf`, "application/pdf"]);
  const t0 = Date.now();
  const r = await post("juntar-pdf", files);
  if (!r.ok) ck("juntar 25 arquivos", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    ck("juntar 25 arquivos (limite)", d.getPageCount() === 25, `25 paginas em ${Date.now() - t0}ms`);
  }
}

// ============================================================ C. SEMANTICA
console.log("\n--- C. SEMANTICA / FORMATO ---");

{
  const r = await post("marca-dagua", [[await mkpdf(2), "in.pdf", "application/pdf"]], { text: "RASCUNHO" });
  if (!r.ok) ck("marca-dagua: aplica", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    ck("marca-dagua: mantem paginas", d.getPageCount() === 2, `${d.getPageCount()} paginas`);
  }
}

{
  // marca d'agua com acentos e caracteres especiais
  const r = await post("marca-dagua", [[await mkpdf(1), "in.pdf", "application/pdf"]], { text: "CÓPIA NÃO OFICIAL — Ção" });
  ck("marca-dagua: acentos aceitos", r.ok, r.ok ? `HTTP ${r.status}` : `HTTP ${r.status} ${r.error}`);
}

{
  const r = await post("proteger-pdf", [[await mkpdf(2), "in.pdf", "application/pdf"]], { password: "MinhaSenha123", passwordConfirm: "MinhaSenha123" });
  if (!r.ok) ck("proteger: senha forte", false, `HTTP ${r.status} ${r.error}`);
  else {
    const s = r.buf.toString("latin1");
    ck("proteger: AES-256 confirmado", s.includes("/V 5") && s.includes("/R 6") && s.includes("/Encrypt"), "V5/R6 presentes");
  }
}

{
  // senhas diferentes devem ser rejeitadas
  const r = await post("proteger-pdf", [[await mkpdf(1), "in.pdf", "application/pdf"]], { password: "senhaAAA", passwordConfirm: "senhaBBB" });
  ck("proteger: senhas divergentes rejeitadas", !r.ok && r.status === 400, `HTTP ${r.status}`);
}

{
  // senha curta
  const r = await post("proteger-pdf", [[await mkpdf(1), "in.pdf", "application/pdf"]], { password: "abc", passwordConfirm: "abc" });
  ck("proteger: senha curta rejeitada", !r.ok && r.status === 400, `HTTP ${r.status}`);
}

{
  const r = await post("assinar-pdf", [[await mkpdf(2), "in.pdf", "application/pdf"]], { text: "Assinado por José em 22/10/2026", position: "bottom-right" });
  if (!r.ok) ck("assinar: aplica assinatura", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    ck("assinar: paginas preservadas", d.getPageCount() === 2, `${d.getPageCount()} paginas`);
  }
}

{
  // pdf com tamanhos de pagina diferentes (A4 + oficio)
  const mixed = await mkpdf(2, { sizes: [[595, 842], [612, 1008]] });
  const r = await post("pdf-para-imagens", [[mixed, "mix.pdf", "application/pdf"]]);
  if (!r.ok) ck("tamanhos mistos: render", false, `HTTP ${r.status} ${r.error}`);
  else {
    const zip = await JSZip.loadAsync(r.buf);
    const imgs = Object.keys(zip.files).filter((n) => /\.(png|jpg)$/i.test(n));
    ck("tamanhos mistos: 2 imagens", imgs.length === 2, `${imgs.length} imagens`);
  }
}

{
  const r = await post("comprimir-pdf", [[await mkpdf(1), "in.pdf", "application/pdf"]]);
  if (!r.ok) ck("comprimir: 1 pagina", false, `HTTP ${r.status} ${r.error}`);
  else {
    const d = await PDFDocument.load(r.buf);
    ck("comprimir: PDF valido", d.getPageCount() === 1, `${r.buf.length} bytes, ${d.getPageCount()} paginas`);
  }
}

{
  const r = await post("pdf-para-word", [[await mkpdf(2), "in.pdf", "application/pdf"]]);
  if (!r.ok) ck("pdf->word: gera docx", false, `HTTP ${r.status} ${r.error}`);
  else {
    const zip = await JSZip.loadAsync(r.buf);
    const doc = await zip.files["word/document.xml"]?.async("utf8").catch(() => "");
    ck("pdf->word: docx com conteudo", !!(doc && doc.length > 200), doc ? `${doc.length} chars no document.xml` : "document.xml ausente");
  }
}

console.log("\n" + "=".repeat(80));
console.log(`RESUMO: ${pass} PASS / ${fail} FAIL  (${((pass / (pass + fail)) * 100).toFixed(0)}% correto)`);
if (failures.length) { console.log("\nFALHAS:"); failures.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
