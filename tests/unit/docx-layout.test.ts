import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { Document, Packer } from "docx";
import { layoutSections, mergeDocxBodies } from "../../lib/processing/docx";
import type { LayoutPage } from "../../lib/processing/layout";

const page = (): LayoutPage => ({ width: 595.5, height: 842.25, images: [], texts: [{ x: 40, y: 300, width: 120, height: 8, font: { family: "Arial", size: 8, color: "#000000", bold: false, italic: false }, segments: [{ text: "CAMPO Valor", bold: false, italic: false }], words: [{ text: "CAMPO", x: 40, width: 30, bold: true, italic: false }, { text: "Valor", x: 100, width: 25, bold: false, italic: false }] }] });
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
async function xmlFor(pages: LayoutPage[], assets = new Map<string, Uint8Array>(), artwork = new Map<number, Uint8Array>()) {
  const bytes = await Packer.toBuffer(new Document({ sections: layoutSections(pages, assets, artwork) }));
  const zip = await JSZip.loadAsync(bytes);
  return { zip, bytes, xml: await zip.file("word/document.xml")!.async("string") };
}

test("form fields keep absolute positions, editable runs and explicit word tab stops", async () => {
  const { xml } = await xmlFor([page()]);
  assert.match(xml, /<w:framePr[^>]*w:x="800"/);
  assert.match(xml, /<w:framePr[^>]*w:y="5962"/);
  assert.match(xml, /w:pos="1200"/);
  assert.match(xml, /<w:t[^>]*>CAMPO<\/w:t>/);
  assert.match(xml, /<w:t[^>]*>Valor<\/w:t>/);
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 0);
  assert.match(xml, /w:top="0"/);
});

test("a blank intermediate page and different paper sizes preserve their own sections", async () => {
  const blank = { ...page(), texts: [] };
  const last = { ...page(), height: 1134 };
  const { xml } = await xmlFor([page(), blank, last]);
  assert.equal((xml.match(/<w:sectPr[ >]/g) || []).length, 3);
  assert.equal((xml.match(/w:w="11910"/g) || []).length, 3);
  assert.match(xml, /w:h="22680"/);
});

test("logos stay anchored to their source page and graphics do not replace editable text", async () => {
  const first = page();
  first.images = [{ x: 236, y: 29, width: 60, height: 57, source: "logo.jpg" }];
  const { zip, xml } = await xmlFor([first, page()], new Map([["logo.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]]), new Map([[0, png], [1, png]]));
  const sectionEnd = xml.indexOf("</w:p>", xml.indexOf("</w:sectPr>")) + "</w:p>".length;
  assert.equal((xml.slice(0, sectionEnd).match(/<wp:anchor /g) || []).length, 2);
  assert.equal((xml.slice(sectionEnd).match(/<wp:anchor /g) || []).length, 1);
  assert.match(xml, /<wp:posOffset>2997200<\/wp:posOffset>/);
  assert.match(xml, /<wp:posOffset>368300<\/wp:posOffset>/);
  assert.equal((xml.match(/behindDoc="1"/g) || []).length, 2);
  assert.equal((xml.match(/>CAMPO<\/w:t>/g) || []).length, 2);
  assert.ok(Object.keys(zip.files).some((name) => name.endsWith(".jpg")));
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /ContentType="image\/jpeg"/);
});

test("joining text-only chunks leaves one terminal body section and a paragraph section break", async () => {
  const one = await xmlFor([page(), page()]);
  const two = await xmlFor([{ ...page(), height: 1134 }]);
  const merged = await mergeDocxBodies([one.bytes, two.bytes]);
  const zip = await JSZip.loadAsync(merged);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.equal((xml.match(/<w:sectPr[ >]/g) || []).length, 3);
  assert.match(xml, /<w:p><w:pPr><w:sectPr/);
  assert.match(xml, /<\/w:sectPr><\/w:body>/);
  for (const properties of xml.matchAll(/<w:pPr>([\s\S]*?)<\/w:pPr>/g)) assert.doesNotMatch(properties[1], /<w:p[ >]|<w:t[ >]/);
});
