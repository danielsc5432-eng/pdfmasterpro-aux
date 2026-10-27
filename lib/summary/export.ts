import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { SummaryResult } from "./types";

export function summaryText(result: SummaryResult) {
  const sources = new Map(result.sources.map(source => [source.id, source]));
  return result.points.map(point => `${point.text} [p. ${[...new Set(point.evidence.map(item => sources.get(item.sourceId)?.page).filter(Boolean))].join(", ")}]`).join("\n\n");
}
export function exportText(result: SummaryResult, edited: string, changed: boolean) {
  if (edited.length > 20000) throw Error("O texto editado excede o limite de 20.000 caracteres.");
  return ["PDF MASTER PRO — RESUMOMASTER AI", `Documento: ${result.name}`, `Modelo: ${result.model}`, changed ? "Texto editado pelo usuário. As referências originais podem não sustentar as alterações." : "Resumo gerado por IA. Confira as citações e o documento original.", "", edited, "", "LIMITAÇÕES", ...result.warnings, "", "CITAÇÕES DO RESULTADO ORIGINAL", ...result.points.flatMap(point => point.evidence.map(item => { const source = result.sources.find(value => value.id === item.sourceId); return `Página ${source?.page ?? "?"}: ${item.quote}`; }))].join("\n");
}
export async function summaryDocx(result: SummaryResult, edited: string, changed: boolean) {
  const text = exportText(result, edited, changed);
  return new Uint8Array(await (await Packer.toBlob(new Document({ sections: [{ children: text.split("\n").map((line, index) => new Paragraph(index === 0 ? { text: line, heading: HeadingLevel.TITLE } : { children: [new TextRun(line)], spacing: { after: 100 } })) }] }))).arrayBuffer());
}
export async function summaryPdf(result: SummaryResult, edited: string, changed: boolean, fontBytes: Uint8Array) {
  const text = exportText(result, edited, changed); const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true }); const supported = new Set(font.getCharacterSet());
  if ([...text].some(char => !["\n", "\t", "\r"].includes(char) && !supported.has(char.codePointAt(0)!))) throw Error("Há caracteres não suportados pela fonte PDF. Use TXT ou DOCX para preservar o texto integral.");
  let page = pdf.addPage([595, 842]), y = 790;
  for (const paragraph of text.split("\n")) {
    let row = "";
    const draw = () => { if (y < 60) { page = pdf.addPage([595, 842]); y = 790; } page.drawText(row, { x: 42, y, font, size: 10, color: rgb(.12, .14, .2) }); y -= 15; row = ""; };
    for (const char of paragraph.replace(/\r/g, "").replace(/\t/g, "    ")) { if (row && font.widthOfTextAtSize(row + char, 10) > 510) draw(); row += char; }
    if (row) draw(); else y -= 10;
  }
  pdf.setTitle("PDF Master Pro — Resumo de PDF");
  const pages = pdf.getPages(); pages.forEach((sheet, index) => sheet.drawText(`${index + 1}/${pages.length}`, { x: 42, y: 30, font, size: 8 }));
  return pdf.save();
}
