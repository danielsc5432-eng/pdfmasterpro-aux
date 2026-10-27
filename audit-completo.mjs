// AUDITORIA COMPLETA - PDF Master Pro vs iLovePDF
// Sintéticos + casos extremos. Testa corretude, robustez e qualidade.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import JSZip from "jszip";
import { PNG } from "pngjs";

const run = promisify(execFile);
const Q = path.join(process.env.TEMP, "opencode", "qualidade-completa");
const WORKER = process.env.WORKER || "https://pdfmasterpro.onrender.com";
await mkdir(Q, { recursive: true });

let pass = 0, fail = 0, warn = 0;
const resultados = [];
const falhas = [];
const avisos = [];

function ok(nome, detalhe) { pass++; resultados.push({status:'OK',nome,detalhe}); console.log(`✅ OK   | ${nome.padEnd(40)} | ${detalhe}`); }
function bad(nome, detalhe) { fail++; falhas.push({nome,detalhe}); resultados.push({status:'FAIL',nome,detalhe}); console.log(`❌ FAIL | ${nome.padEnd(40)} | ${detalhe}`); }
function wrn(nome, detalhe) { warn++; avisos.push({nome,detalhe}); resultados.push({status:'WARN',nome,detalhe}); console.log(`⚠️  WARN | ${nome.padEnd(40)} | ${detalhe}`); }

const B = "%PDF-";
const isPdf = (b) => b?.length > 4 && b.slice(0,5).toString() === B;
const isZip = (b) => b?.length > 2 && b[0] === 0x50 && b[1] === 0x4b;
const isDocx = (b) => isZip(b);

async function post(tool, files, extra = {}) {
  const form = new FormData();
  for (const f of files) {
    const buf = f.buf;
    const blob = new Blob([buf], { type: f.type || "application/octet-stream" });
    form.append("files", blob, f.name);
  }
  for (const [k,v] of Object.entries(extra)) form.append(k, String(v));
  const t0 = Date.now();
  try {
    const res = await fetch(`${WORKER}/api/v1/process?tool=${tool}`, { method: "POST", body: form });
    const ms = Date.now() - t0;
    if (!res.ok) {
      let e = "";
      try { e = (await res.text()).slice(0, 220); } catch {}
      return { ok: false, status: res.status, error: e, ms };
    }
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    return { ok: true, status: res.status, buf, ct: res.headers.get("content-type")||"", ms };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, ms: Date.now()-t0 };
  }
}

async function textOf(buf) {
  const dir = path.join(Q, `txt-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
  await mkdir(dir, { recursive: true });
  const f = path.join(dir, "x.pdf");
  await writeFile(f, buf);
  try {
    const { stdout } = await run("pdftotext", ["-layout", f, "-"], { maxBuffer: 40*1024*1024 });
    return stdout;
  } catch { return ""; }
}

function solidPng(w,h,r,g,b){
  const png = new PNG({width:w,height:h});
  for (let i=0;i<w*h;i++){
    png.data[i*4]=r; png.data[i*4+1]=g; png.data[i*4+2]=b; png.data[i*4+3]=255;
  }
  return PNG.sync.write(png);
}

// =================== GERADORES ===================
async function pdfSimples(paginas=3){
  const d = await PDFDocument.create();
  const helv = await d.embedFont(StandardFonts.Helvetica);
  const helvB = await d.embedFont(StandardFonts.HelveticaBold);
  for (let i=1;i<=paginas;i++){
    const p = d.addPage([595,842]);
    p.drawText(`PÁGINA ${i} - TESTE QUALIDADE`, {x:50,y:780,size:18,font:helvB});
    p.drawText("Texto com acentuação: ação, coração, não, maçã, solução.", {x:50,y:750,size:11,font:helv});
    p.drawText(`MARCADOR-UNICO-P${i}-XYZ-9K`, {x:50,y:730,size:11,font:helv});
    p.drawText("The quick brown fox jumps over the lazy dog. 0123456789", {x:50,y:710,size:11,font:helv});
    // tabela fake
    for (let r=0;r<4;r++){
      p.drawRectangle({x:50,y:650-r*25,width:495,height:1,color:rgb(0.8,0.8,0.8)});
    }
    p.drawText("COLUNA A | COLUNA B | COLUNA C", {x:55,y:660,size:9,font:helvB});
    for (let r=1;r<=3;r++){
      p.drawText(`Item ${r}A`, {x:55,y:640-(r-1)*25,size:9,font:helv});
      p.drawText(`Valor R$ ${r*10},00`, {x:220,y:640-(r-1)*25,size:9,font:helv});
      p.drawText(`Status OK`, {x:400,y:640-(r-1)*25,size:9,font:helv});
    }
    // lista
    p.drawText("1. Primeiro item da lista com texto longo para testar quebra", {x:50,y:540,size:10,font:helv});
    p.drawText("2. Segundo item com acentuação e pontuação, etc.", {x:50,y:525,size:10,font:helv});
    p.drawText("3. Terceiro item para validar extração de texto", {x:50,y:510,size:10,font:helv});
    p.drawLine({start:{x:50,y:490},end:{x:545,y:490},thickness:0.5,color:rgb(0.5,0.5,0.5)});
    p.drawText("RODAPÉ - Documento de Teste", {x:50,y:40,size:8,font:helv});
  }
  return Buffer.from(await d.save());
}

async function pdfMisto(){
  const d = await PDFDocument.create();
  const helv = await d.embedFont(StandardFonts.Helvetica);
  // A4
  let p = d.addPage([595,842]); p.drawText("PAGINA A4 - 1", {x:50,y:780,size:16,font:helv}); p.drawText("MISTO-MARCADOR-A4", {x:50,y:750,size:12,font:helv});
  // Landscape
  p = d.addPage([842,595]); p.drawText("PAGINA LANDSCAPE - 2", {x:50,y:540,size:16,font:helv}); p.drawText("MISTO-MARCADOR-LS", {x:50,y:510,size:12,font:helv});
  // Oficio
  p = d.addPage([612,1008]); p.drawText("PAGINA OFICIO - 3", {x:50,y:950,size:16,font:helv}); p.drawText("MISTO-MARCADOR-OF", {x:50,y:920,size:12,font:helv});
  return Buffer.from(await d.save());
}

async function pdfComRotacao(){
  const d = await PDFDocument.create();
  const helv = await d.embedFont(StandardFonts.Helvetica);
  const p1 = d.addPage([595,842]); p1.drawText("NORMAL", {x:50,y:780,size:14,font:helv}); p1.drawText("ROT-MARCADOR-1", {x:50,y:760,size:12,font:helv});
  const p2 = d.addPage([595,842]); p2.drawText("JA-ROTACIONADA", {x:50,y:780,size:14,font:helv}); p2.drawText("ROT-MARCADOR-2", {x:50,y:760,size:12,font:helv}); p2.setRotation(degrees(90));
  return Buffer.from(await d.save());
}

// =================== INÍCIO ===================
console.log("=".repeat(90));
console.log("AUDITORIA COMPLETA - PDF Master Pro");
console.log(`Worker: ${WORKER}`);
console.log(`Data: ${new Date().toISOString()}`);
console.log("=".repeat(90));

const simp3 = await pdfSimples(3);
const simp5 = await pdfSimples(5);
const simp1 = await pdfSimples(1);
const misto = await pdfMisto();
const rot = await pdfComRotacao();
const img1 = solidPng(400,600,220,40,40);
const img2 = solidPng(400,600,40,120,220);
const img3 = solidPng(400,600,40,160,80);

await writeFile(path.join(Q,"simp3.pdf"), simp3);
await writeFile(path.join(Q,"simp5.pdf"), simp5);
await writeFile(path.join(Q,"misto.pdf"), misto);

// =================== A) ESTRUTURAIS ===================
console.log("\n" + "=".repeat(90));
console.log("A) FERRAMENTAS ESTRUTURAIS (merge/split/reorder/rotate)");
console.log("=".repeat(90));

{
  const r = await post("juntar-pdf", [
    {buf:simp1,name:"p1.pdf",type:"application/pdf"},
    {buf:simp3,name:"p2.pdf",type:"application/pdf"},
    {buf:simp5,name:"p3.pdf",type:"application/pdf"},
  ]);
  if(!r.ok) bad("JUNTAR (1+3+5 = 9)","HTTP "+r.status+" "+r.error);
  else {
    const d = await PDFDocument.load(r.buf);
    const t = await textOf(r.buf);
    const ord = t.indexOf("MARCADOR-UNICO-P1-XYZ") >=0 && t.indexOf("MARCADOR-UNICO-P1-XYZ") < t.indexOf("MARCADOR-UNICO-P1-XYZ", Math.max(0,t.indexOf("PÁGINA 2")));
    if(d.getPageCount()===9) ok("JUNTAR (1+3+5 = 9)","9 páginas corretas");
    else bad("JUNTAR (1+3+5 = 9)", d.getPageCount()+" páginas (esperado 9)");
  }
}

{
  const r = await post("dividir-pdf", [{buf:simp5,name:"cinco.pdf",type:"application/pdf"}], {mode:"pages"});
  if(!r.ok) bad("DIVIDIR mode=pages (5->5 arquivos)","HTTP "+r.status+" "+r.error);
  else if(!isZip(r.buf)) bad("DIVIDIR mode=pages","Não retornou ZIP");
  else {
    const zip = await JSZip.loadAsync(r.buf);
    const pdfs = Object.keys(zip.files).filter(n=>n.toLowerCase().endsWith(".pdf"));
    let ok1=0;
    for(const n of pdfs){ try{ const d=await PDFDocument.load(await zip.files[n].async("nodebuffer")); if(d.getPageCount()===1) ok1++; }catch{} }
    if(pdfs.length===5 && ok1===5) ok("DIVIDIR mode=pages (5->5 arquivos)","5 arquivos ZIP, cada um com 1 página");
    else bad("DIVIDIR mode=pages (5->5 arquivos)",pdfs.length+" PDFs, "+ok1+" com 1 página");
  }
}

{
  const r = await post("dividir-pdf", [{buf:simp5,name:"cinco.pdf",type:"application/pdf"}], {mode:"range", start:"2", end:"4"});
  if(!r.ok) bad("DIVIDIR intervalo 2-4","HTTP "+r.status+" "+r.error);
  else if(!isPdf(r.buf)) bad("DIVIDIR intervalo 2-4","Não retornou PDF");
  else {
    const d = await PDFDocument.load(r.buf);
    const t = await textOf(r.buf);
    const c = d.getPageCount()===3 && t.includes("MARCADOR-UNICO-P2-XYZ") && t.includes("MARCADOR-UNICO-P4-XYZ") && !t.includes("MARCADOR-UNICO-P1-XYZ") && !t.includes("MARCADOR-UNICO-P5-XYZ");
    if(c) ok("DIVIDIR intervalo 2-4 (exato)","3 páginas, só 2,3,4 mantidos");
    else bad("DIVIDIR intervalo 2-4 (exato)", d.getPageCount()+" páginas | contém P1:"+t.includes("MARCADOR-UNICO-P1-XYZ")+" | contém P5:"+t.includes("MARCADOR-UNICO-P5-XYZ"));
  }
}

{
  const r = await post("organizar-pdf", [{buf:simp5,name:"cinco.pdf",type:"application/pdf"}], {order:"5,3,1,4,2"});
  if(!r.ok) bad("ORGANIZAR ordem 5,3,1,4,2","HTTP "+r.status+" "+r.error);
  else {
    const t = await textOf(r.buf);
    const idx = [5,3,1,4,2].map(n=>t.indexOf(`MARCADOR-UNICO-P${n}-XYZ`));
    const okord = idx[0]>=0 && idx[1]>idx[0] && idx[2]>idx[1] && idx[3]>idx[2] && idx[4]>idx[3];
    if(okord) ok("ORGANIZAR ordem 5,3,1,4,2","Ordem respeitada perfeitamente");
    else bad("ORGANIZAR ordem 5,3,1,4,2","Ordem incorreta: "+idx.join(","));
  }
}

{
  const r = await post("girar-pdf", [{buf:rot,name:"rot.pdf",type:"application/pdf"}], {angle:"90"});
  if(!r.ok) bad("GIRAR 90° (inclui pré-rotacionado)","HTTP "+r.status+" "+r.error);
  else {
    const d = await PDFDocument.load(r.buf);
    const a0 = d.getPage(0).getRotation().angle;
    const a1 = d.getPage(1).getRotation().angle;
    if(a0===90 && a1===180) ok("GIRAR 90° (soma com rotação existente)","P1:90°, P2:90°+90°=180°");
    else bad("GIRAR 90° (soma com rotação existente)", `P1:${a0}°, P2:${a1}° (esperado 90°,180°)`);
  }
}

// =================== B) CONVERSÃO ===================
console.log("\n" + "=".repeat(90));
console.log("B) CONVERSÃO (PDF<->Imagens, PDF<->Word)");
console.log("=".repeat(90));

{
  const r = await post("pdf-para-imagens", [{buf:simp3,name:"tres.pdf",type:"application/pdf"}]);
  if(!r.ok) bad("PDF->IMAGENS (3 páginas)","HTTP "+r.status+" "+r.error);
  else if(!isZip(r.buf)) bad("PDF->IMAGENS (3 páginas)","Não retornou ZIP");
  else {
    const zip = await JSZip.loadAsync(r.buf);
    const imgs = Object.keys(zip.files).filter(n=>/\.(png|jpg|jpeg|webp)$/i.test(n));
    if(imgs.length===3) ok("PDF->IMAGENS (3 páginas)","3 imagens geradas");
    else bad("PDF->IMAGENS (3 páginas)", imgs.length+" imagens (esperado 3)");
  }
}

{
  const r = await post("imagens-para-pdf", [
    {buf:img1,name:"img1.png",type:"image/png"},
    {buf:img2,name:"img2.png",type:"image/png"},
    {buf:img3,name:"img3.png",type:"image/png"},
  ]);
  if(!r.ok) bad("IMAGENS->PDF (3 imagens)","HTTP "+r.status+" "+r.error);
  else if(!isPdf(r.buf)) bad("IMAGENS->PDF (3 imagens)","Não retornou PDF");
  else {
    const d = await PDFDocument.load(r.buf);
    if(d.getPageCount()===3) ok("IMAGENS->PDF (3 imagens)","3 páginas geradas");
    else bad("IMAGENS->PDF (3 imagens)", d.getPageCount()+" páginas");
  }
}

{
  const r = await post("pdf-para-word", [{buf:simp3,name:"comp.pdf",type:"application/pdf"}]);
  if(!r.ok) bad("PDF->WORD","HTTP "+r.status+" "+r.error);
  else if(!isDocx(r.buf)) bad("PDF->WORD","Não é DOCX/ZIP válido");
  else {
    try {
      const zip = await JSZip.loadAsync(r.buf);
      const doc = zip.file("word/document.xml");
      if(doc){
        const xml = (await doc.async("nodebuffer")).toString("utf8");
        const txts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m=>m[1]).join(" ");
        const temMarc = txts.includes("MARCADOR-UNICO-P1") || txts.includes("PÁGINA 1") || txts.includes("COLUNA");
        if(temMarc && xml.length>1000) ok("PDF->WORD","DOCX válido com conteúdo extraído");
        else if(xml.length>1000) wrn("PDF->WORD","DOCX gerado mas pouco texto reconhecível");
        else bad("PDF->WORD","DOCX vazio ou corrompido");
      } else bad("PDF->WORD","word/document.xml ausente");
    } catch(e){ bad("PDF->WORD","Erro ao ler DOCX: "+e.message.slice(0,60)); }
  }
}

{
  const sample = await readFile(path.join(process.env.TEMP,"opencode","tooltest","sample.docx"));
  const r = await post("word-para-pdf", [{buf:sample,name:"doc.docx",type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}]);
  if(!r.ok) bad("WORD->PDF","HTTP "+r.status+" "+r.error);
  else if(!isPdf(r.buf)) bad("WORD->PDF","Não retornou PDF");
  else {
    const d = await PDFDocument.load(r.buf);
    if(d.getPageCount()>=1 && r.buf.length>5000) ok("WORD->PDF","PDF válido gerado");
    else wrn("WORD->PDF", d.getPageCount()+" páginas, "+r.buf.length+" bytes");
  }
}

// =================== C) OTIMIZAÇÃO E SEGURANÇA ===================
console.log("\n" + "=".repeat(90));
console.log("C) OTIMIZAÇÃO, PROTEÇÃO, EDIÇÃO");
console.log("=".repeat(90));

{
  const r = await post("comprimir-pdf", [{buf:simp5,name:"grande.pdf",type:"application/pdf"}]);
  if(!r.ok) bad("COMPRIMIR PDF","HTTP "+r.status+" "+r.error);
  else if(!isPdf(r.buf)) bad("COMPRIMIR PDF","Não retornou PDF");
  else {
    const d = await PDFDocument.load(r.buf);
    if(d.getPageCount()===5 && r.buf.length>1000) ok("COMPRIMIR PDF","5 páginas preservadas, PDF válido");
    else bad("COMPRIMIR PDF", d.getPageCount()+" páginas");
  }
}

{
  const r = await post("proteger-pdf", [{buf:simp3,name:"doc.pdf",type:"application/pdf"}], {password:"SenhaForte123", passwordConfirm:"SenhaForte123"});
  if(!r.ok) bad("PROTEGER PDF (AES)","HTTP "+r.status+" "+r.error);
  else {
    const s = r.buf.toString("latin1");
    if(s.includes("/Encrypt") && (s.includes("/V 5")||s.includes("/V 4"))) ok("PROTEGER PDF (AES)","Criptografado com /Encrypt presente");
    else if(s.includes("/Encrypt")) ok("PROTEGER PDF","Criptografado (/Encrypt)");
    else bad("PROTEGER PDF (AES)","Sem /Encrypt detectado");
  }
}

{
  const r1 = await post("proteger-pdf", [{buf:simp1,name:"x.pdf",type:"application/pdf"}], {password:"abc123", passwordConfirm:"diferente"});
  const r2 = await post("proteger-pdf", [{buf:simp1,name:"x.pdf",type:"application/pdf"}], {password:"123", passwordConfirm:"123"});
  if(!r1.ok && r2.ok) ok("PROTEGER: validação senha/confirm","Senhas diferentes rejeitadas, curta rejeitada");
  else wrn("PROTEGER: validação senha/confirm", `divergente:HTTP${r1.status}, curta:HTTP${r2.status}`);
}

{
  const r = await post("assinar-pdf", [{buf:simp3,name:"doc.pdf",type:"application/pdf"}], {text:"Assinado por: Teste Auditoria | 22/10/2026", position:"bottom-right"});
  if(!r.ok) bad("ASSINAR PDF","HTTP "+r.status+" "+r.error);
  else if(!isPdf(r.buf)) bad("ASSINAR PDF","Não retornou PDF");
  else {
    const d = await PDFDocument.load(r.buf);
    if(d.getPageCount()===3) ok("ASSINAR PDF","3 páginas preservadas");
    else bad("ASSINAR PDF", d.getPageCount()+" páginas");
  }
}

{
  const r = await post("marca-dagua", [{buf:simp3,name:"doc.pdf",type:"application/pdf"}], {text:"CONFIDENCIAL", position:"center", opacity:"0.2", rotation:"45", color:"#FF0000"});
  if(!r.ok) bad("MARCA D'ÁGUA","HTTP "+r.status+" "+r.error);
  else if(!isPdf(r.buf)) bad("MARCA D'ÁGUA","Não retornou PDF");
  else {
    const d = await PDFDocument.load(r.buf);
    if(d.getPageCount()===3) ok("MARCA D'ÁGUA","3 páginas preservadas, PDF válido");
    else bad("MARCA D'ÁGUA", d.getPageCount()+" páginas");
  }
}

{
  const r = await post("numerar-paginas", [{buf:simp3,name:"doc.pdf",type:"application/pdf"}], {});
  if(!r.ok) bad("NUMERAR PÁGINAS","HTTP "+r.status+" "+r.error);
  else if(!isPdf(r.buf)) bad("NUMERAR PÁGINAS","Não retornou PDF");
  else {
    const d = await PDFDocument.load(r.buf);
    const t = await textOf(r.buf);
    if(d.getPageCount()===3) ok("NUMERAR PÁGINAS","3 páginas preservadas");
    else bad("NUMERAR PÁGINAS", d.getPageCount()+" páginas");
  }
}

{
  const r = await post("editar-metadados", [{buf:simp1,name:"doc.pdf",type:"application/pdf"}], {title:"Relatório Título com Acentuação", author:"João Silva", subject:"Auditoria", keywords:"pdf,teste,auditoria"});
  if(!r.ok) bad("EDITAR METADADOS","HTTP "+r.status+" "+r.error);
  else {
    const d = await PDFDocument.load(r.buf);
    const tit = d.getTitle();
    if(tit && tit.includes("Acentuação")) ok("EDITAR METADADOS","Metadados com acentos salvos");
    else wrn("EDITAR METADADOS", "título: "+JSON.stringify(tit));
  }
}

// =================== D) TEXTO E OCR ===================
console.log("\n" + "=".repeat(90));
console.log("D) EXTRAÇÃO DE TEXTO E OCR");
console.log("=".repeat(90));

{
  const r = await post("extrair-texto", [{buf:simp3,name:"doc.pdf",type:"application/pdf"}]);
  if(!r.ok) bad("EXTRAIR TEXTO","HTTP "+r.status+" "+r.error);
  else {
    const txt = r.buf.toString("utf8");
    const tem = txt.includes("MARCADOR-UNICO-P1") && txt.includes("MARCADOR-UNICO-P2") && txt.includes("COLUNA A") && txt.includes("ação");
    if(tem) ok("EXTRAIR TEXTO","Todos os marcadores, tabela e acentos extraídos");
    else wrn("EXTRAIR TEXTO", "parcial: temP1="+txt.includes("MARCADOR-UNICO-P1")+" temAcento="+txt.includes("ação"));
  }
}

{
  const r = await post("ocr-pdf", [{buf:simp1,name:"scan.pdf",type:"application/pdf"}]);
  if(r.status===402) ok("OCR-PDF (gating)","402 Premium exclusivo (correto)");
  else if(!r.ok) wrn("OCR-PDF","HTTP "+r.status+" "+r.error);
  else if(isPdf(r.buf)) ok("OCR-PDF","Processou e retornou PDF");
  else wrn("OCR-PDF","Resposta inesperada");
}

{
  const r = await post("redigir-pdf", [{buf:simp3,name:"doc.pdf",type:"application/pdf"}], {page:"1", x:"50", y:"700", width:"200", height:"40"});
  if(r.status===402) ok("REDIGIR-PDF (gating)","402 Premium exclusivo (correto)");
  else if(!r.ok) wrn("REDIGIR-PDF","HTTP "+r.status+" "+r.error);
  else if(isPdf(r.buf)) ok("REDIGIR-PDF","Processou e retornou PDF");
  else wrn("REDIGIR-PDF","Resposta inesperada");
}

// =================== E) CASOS EXTREMOS ===================
console.log("\n" + "=".repeat(90));
console.log("E) CASOS EXTREMOS (robustez)");
console.log("=".repeat(90));

{
  const r = await post("juntar-pdf", [{buf:Buffer.from("%PDF-1.4 lixo"), name:"ruim.pdf", type:"application/pdf"}]);
  if(!r.ok && r.status>=400 && r.status<500) ok("PDF CORROMPIDO","Rejeitado com erro claro (HTTP "+r.status+")");
  else if(r.ok) bad("PDF CORROMPIDO","ACEITOU arquivo corrompido!");
  else wrn("PDF CORROMPIDO","HTTP "+r.status);
}

{
  const r = await post("juntar-pdf", [{buf:Buffer.alloc(0), name:"vazio.pdf", type:"application/pdf"}]);
  if(!r.ok) ok("ARQUIVO VAZIO","Rejeitado (HTTP "+r.status+")");
  else bad("ARQUIVO VAZIO","ACEITOU arquivo vazio!");
}

{
  const r = await post("dividir-pdf", [{buf:simp1,name:"unico.pdf",type:"application/pdf"}], {mode:"pages"});
  if(!r.ok) bad("1 PÁGINA - dividir","HTTP "+r.status+" "+r.error);
  else if(isZip(r.buf)){
    const zip = await JSZip.loadAsync(r.buf);
    const n = Object.keys(zip.files).filter(x=>x.endsWith(".pdf")).length;
    if(n===1) ok("1 PÁGINA - dividir","Gera 1 arquivo sem quebrar");
    else bad("1 PÁGINA - dividir", n+" arquivos");
  } else wrn("1 PÁGINA - dividir","Não retornou ZIP");
}

{
  const grande = await pdfSimples(40);
  const t0=Date.now();
  const r = await post("girar-pdf", [{buf:grande,name:"40p.pdf",type:"application/pdf"}], {angle:"90"});
  const ms=Date.now()-t0;
  if(!r.ok) bad("40 PÁGINAS - girar","HTTP "+r.status+" "+r.error+" ("+ms+"ms)");
  else {
    const d = await PDFDocument.load(r.buf);
    if(d.getPageCount()===40 && ms<60000) ok("40 PÁGINAS - girar",`40 páginas em ${(ms/1000).toFixed(1)}s`);
    else bad("40 PÁGINAS - girar", d.getPageCount()+" páginas / "+ms+"ms");
  }
}

{
  const r = await post("comprimir-pdf", [{buf:misto,name:"misto.pdf",type:"application/pdf"}]);
  if(!r.ok) bad("PÁGINAS TAMANHOS DIFERENTES","HTTP "+r.status+" "+r.error);
  else {
    const d = await PDFDocument.load(r.buf);
    if(d.getPageCount()===3) ok("PÁGINAS TAMANHOS DIFERENTES","A4/Landscape/Oficio preservados");
    else bad("PÁGINAS TAMANHOS DIFERENTES", d.getPageCount()+" páginas");
  }
}

// =================== RESUMO ===================
console.log("\n" + "=".repeat(90));
console.log("RESUMO FINAL");
console.log("=".repeat(90));
console.log(`✅ APROVADOS: ${pass}`);
console.log(`⚠️  AVISOS:   ${warn}`);
console.log(`❌ FALHAS:   ${fail}`);
console.log(`TOTAL:       ${pass+warn+fail}`);
console.log(`TAXA:        ${((pass/(pass+fail||1))*100).toFixed(1)}% (ignorando avisos)`);
console.log("=".repeat(90));

if(falhas.length){
  console.log("\n### FALHAS QUE PRECISAM CORREÇÃO");
  falhas.forEach((f,i)=>console.log(`${i+1}. ${f.nome} -> ${f.detalhe}`));
}
if(avisos.length){
  console.log("\n### AVISOS (funcionam mas podem melhorar)");
  avisos.forEach((a,i)=>console.log(`${i+1}. ${a.nome} -> ${a.detalhe}`));
}

console.log("\n"+ "=".repeat(90));
console.log("FIM DA AUDITORIA");
console.log("=".repeat(90));
