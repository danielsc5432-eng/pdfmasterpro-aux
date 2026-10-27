import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import { extractRange, imagesToPdf, mergePdfs, reorderPdf, rotatePdf, splitPdfToZip, verifyOutput } from "../../lib/processing/pdf";
import { addWatermark, editMetadata, numberPages, signPdf } from "../../lib/processing/extended";

async function makePdf(pageCount = 1, rotation = 0) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) {
    const page = document.addPage([200, 280]);
    page.drawText(`Pagina ${index + 1}`, { x: 20, y: 240, size: 12, color: rgb(0, 0, 0) });
    if (rotation) page.setRotation(degrees(rotation));
  }
  return document.save();
}

const tinyPng = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

test("junta dois PDFs em um documento só", async () => {
  const merged = await mergePdfs([await makePdf(1), await makePdf(2)]);
  assert.equal((await PDFDocument.load(merged)).getPageCount(), 3);
});

test("gira páginas somando à rotação existente", async () => {
  const rotated = await rotatePdf(await makePdf(1, 90), 90);
  const document = await PDFDocument.load(rotated);
  assert.equal(document.getPage(0).getRotation().angle, 180);
});

test("extrai intervalo e recusa intervalo fora do documento", async () => {
  const threePages = await makePdf(3);
  const extracted = await extractRange(threePages, 2, 3);
  assert.equal((await PDFDocument.load(extracted)).getPageCount(), 2);
  await assert.rejects(() => extractRange(threePages, 5, 6), /intervalo/i);
});

test("reordena páginas e valida valores fora do intervalo", async () => {
  const twoPages = await makePdf(2);
  const reordered = await reorderPdf(await makePdf(3), [3, 1, 2]);
  assert.equal((await PDFDocument.load(reordered)).getPageCount(), 3);
  await assert.rejects(() => reorderPdf(twoPages, [9]), /fora do intervalo/i);
});

test("divide em ZIP com um PDF por página", async () => {
  const zip = await JSZip.loadAsync(await splitPdfToZip(await makePdf(2)));
  assert.equal(Object.keys(zip.files).length, 2);
});

test("gera PDF a partir de imagem PNG", async () => {
  const output = await imagesToPdf([{ bytes: tinyPng, kind: "png" }], "a4", 12);
  assert.equal((await PDFDocument.load(output)).getPageCount(), 1);
});

test("aplica marca d'água, numeração e assinatura preservando páginas", async () => {
  const input = await makePdf(2);
  const watermarked = await addWatermark(input, { text: "CONFIDENCIAL", opacity: 0.3, rotation: 45, position: "center", color: "#ff0000" });
  assert.equal((await PDFDocument.load(watermarked)).getPageCount(), 2);
  const numbered = await numberPages(input, { format: "Página {n} de {total}", position: "bottom-center", start: 1, size: 12, color: "#202431" });
  assert.equal((await PDFDocument.load(numbered)).getPageCount(), 2);
  const signed = await signPdf(input, { text: "João da Silva", position: "bottom-right" });
  assert.equal((await PDFDocument.load(signed)).getPageCount(), 2);
});

test("edita metadados e o valor sobrevive ao recarregamento", async () => {
  const output = await editMetadata(await makePdf(1), { title: "Contrato", author: "Equipe", subject: "Revisão", keywords: "pdf, teste" });
  const document = await PDFDocument.load(output);
  assert.equal(document.getTitle(), "Contrato");
  assert.equal(document.getAuthor(), "Equipe");
});

test("verifyOutput aceita PDF válido e rejeita conteúdo inválido", async () => {
  await verifyOutput("ok.pdf", await makePdf(1));
  await assert.rejects(() => verifyOutput("bad.pdf", new Uint8Array([1, 2, 3])));
});
