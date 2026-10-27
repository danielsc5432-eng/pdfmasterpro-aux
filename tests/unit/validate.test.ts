import test from "node:test";
import assert from "node:assert/strict";
import { detectKind, validateFile, FREE_MAX_FILE_SIZE } from "../../lib/processing/validate";

const pdf = new TextEncoder().encode("%PDF-1.7\nbody");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

test("detecta assinaturas reais de PDF e PNG", () => { assert.equal(detectKind(pdf), "pdf"); assert.equal(detectKind(png), "png"); });
test("detecta assinaturas de DOC legado e DOCX compactado", () => { assert.equal(detectKind(doc), "doc"); assert.equal(detectKind(docx), "docx"); assert.equal(validateFile("arquivo.docx", docx, ["docx"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document").ok, true); });
test("rejeita arquivo falso com extensão PDF", () => { const result = validateFile("fake.pdf", new TextEncoder().encode("texto"), ["pdf"], "application/pdf"); assert.equal(result.ok, false); if (!result.ok) assert.match(result.message, /formato real/); });
test("rejeita MIME incompatível e tamanho acima do limite", () => { const mime = validateFile("arquivo.pdf", pdf, ["pdf"], "image/png"); assert.equal(mime.ok, false); const tooLarge = validateFile("arquivo.pdf", new Uint8Array(FREE_MAX_FILE_SIZE + 1), ["pdf"], "application/pdf"); assert.equal(tooLarge.ok, false); });
