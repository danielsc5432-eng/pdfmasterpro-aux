import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { doclingDocumentToWord, extraEngineToWord } from "../../lib/processing/extra-engines";

const structure = { body: { children: [{ $ref: "#/texts/0" }, { $ref: "#/tables/0" }] }, texts: [{ text: "Contribuição & valores" }], tables: [{ data: { num_rows: 1, num_cols: 2, table_cells: [{ text: "Total", start_row_offset_idx: 0, start_col_offset_idx: 0 }, { text: "1.234,56", start_row_offset_idx: 0, start_col_offset_idx: 1 }] } }] };
test("Docling structure preserves editable reading order, table and financial value", async () => {
  const zip = await JSZip.loadAsync(await doclingDocumentToWord(structure));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.ok(xml.indexOf("Contribuição &amp; valores") < xml.indexOf("1.234,56"));
  assert.match(xml, /<w:tbl>/);
  await assert.rejects(doclingDocumentToWord({ body: { children: [{ $ref: "#/texts/99" }] } }), /Missing/);
});
test("real Docling picture references preserve their caption text", async () => {
  const output = await doclingDocumentToWord({ body: { children: [{ $ref: "#/pictures/0" }] }, pictures: [{ children: [{ $ref: "#/texts/0" }] }], texts: [{ text: "Legenda 123,45" }] });
  const zip = await JSZip.loadAsync(output);
  assert.match(await zip.file("word/document.xml")!.async("string"), /Legenda 123,45/);
});
test("service contracts send PDF multipart, reject partial conversion and restore globals", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.DOCLING_URL;
  const originalStirling = process.env.STIRLING_PDF_URL;
  try {
    process.env.DOCLING_URL = "http://localhost:5001";
    process.env.STIRLING_PDF_URL = "http://localhost:8080";
    globalThis.fetch = async (url, init) => {
      assert.equal(init?.redirect, "error");
      const form = init?.body as FormData;
      if (String(url).includes("/v1/convert/file")) {
        assert.ok(form.get("files") instanceof Blob);
        assert.equal(form.get("table_mode"), "accurate");
        return Response.json({ status: "success", document: { json_content: structure } });
      }
      assert.equal(String(url), "http://localhost:8080/api/v1/convert/pdf/word");
      assert.ok(form.get("fileInput") instanceof Blob);
      assert.equal(form.get("outputFormat"), "docx");
      return new Response(new Uint8Array(await doclingDocumentToWord(structure)));
    };
    assert.ok((await extraEngineToWord("docling", new Uint8Array([1]), 1000)).length > 100);
    assert.ok((await extraEngineToWord("stirling", new Uint8Array([1]), 1000)).length > 100);
    globalThis.fetch = async () => Response.json({ status: "partial_success", document: { json_content: structure } });
    await assert.rejects(extraEngineToWord("docling", new Uint8Array([1]), 1000), /Incomplete/);
    globalThis.fetch = async () => new Response("not a docx");
    await assert.rejects(extraEngineToWord("stirling", new Uint8Array([1]), 1000));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.DOCLING_URL; else process.env.DOCLING_URL = originalUrl;
    if (originalStirling === undefined) delete process.env.STIRLING_PDF_URL; else process.env.STIRLING_PDF_URL = originalStirling;
  }
});
