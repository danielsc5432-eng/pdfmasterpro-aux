import { BorderStyle, Document, HeightRule, Packer, Paragraph, Table, TableAnchorType, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";
import { layoutSections } from "../processing/docx";
import type { LayoutPage } from "../processing/layout";
import { sourceDocument, validatePlan, type SourceSpan } from "./model";

/** Experimental native Word tables over original artwork; text always comes from PDF spans. */
export async function renderReconstruction(pages: LayoutPage[], assets: Map<string, Uint8Array>, artwork: Map<number, Uint8Array>, proposal: unknown): Promise<Uint8Array> {
  const source = sourceDocument(pages), plan = validatePlan(source, proposal);
  const used = new Set(plan.tables.flatMap(table => table.rows.flat(2)));
  const remainder = source.pages.map((page, p) => ({ ...pages[p], texts: page.spans.filter(span => !used.has(span.id)).map(span => ({ x: span.x, y: span.y, width: span.width, height: span.height, words: [{text: span.text, x: span.x, width: span.width, bold: span.bold, italic: span.italic}], segments: [{text: span.text, bold: span.bold, italic: span.italic}], font: {family: span.font, size: span.size, bold: span.bold, italic: span.italic, color: span.color} })) }));
  const sections = layoutSections(remainder, assets, artwork);
  for (const table of plan.tables) {
    const byId = new Map(source.pages[table.page].spans.map(span => [span.id, span]));
    const spans = table.rows.flat(2).map(id => byId.get(id)!);
    const x = Math.min(...spans.map(s => s.x)), y = Math.min(...spans.map(s => s.y));
    const right = Math.max(...spans.map(s => s.x + s.width)) + 2;
    const columnStarts = table.rows[0].map((_, c) => Math.min(...table.rows.flatMap(row => row[c].map(id => byId.get(id)!.x))));
    columnStarts[0] = x;
    if (columnStarts.some((start, c) => !Number.isFinite(start) || (c > 0 && start <= columnStarts[c - 1]))) throw new Error("Ambiguous table geometry");
    const widths = columnStarts.map((start, c) => Math.round(((columnStarts[c + 1] ?? right) - start) * 20));
    const border = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const native = new Table({ layout: TableLayoutType.FIXED, width: {size: widths.reduce((a,b) => a+b,0), type: WidthType.DXA}, columnWidths: widths,
      float: {horizontalAnchor: TableAnchorType.PAGE, verticalAnchor: TableAnchorType.PAGE, absoluteHorizontalPosition: Math.round(x*20), absoluteVerticalPosition: Math.round(y*20)},
      borders: {top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},
      rows: table.rows.map(row => {
        const rowSpans = row.flat().map(id => byId.get(id)!);
        const height = Math.max(...rowSpans.map(s => s.y+s.height))-Math.min(...rowSpans.map(s => s.y));
        return new TableRow({cantSplit:true, height:{value:Math.ceil(height*20),rule:HeightRule.ATLEAST},children:row.map((ids,c) => new TableCell({width:{size:widths[c],type:WidthType.DXA},margins:{top:0,bottom:0,left:0,right:0},children:[paragraph(ids.map(id=>byId.get(id)!))]}))});
      }),
    });
    // Keep each table on its source page after the page's stable anchor.
    (sections[table.page].children as (Paragraph | Table)[]).push(native);
  }
  return new Uint8Array(await Packer.toBuffer(new Document({creator:"PDF Master Pro SDK", sections})));
}
function paragraph(spans: SourceSpan[]) {
  const ordered = [...spans].sort((a,b) => Math.abs(a.y-b.y)>2 ? a.y-b.y : a.x-b.x);
  return new Paragraph({spacing:{before:0,after:0},children:ordered.map((span,i) => new TextRun({text:(i ? " " : "")+span.text,font:span.font,size:Math.max(2,Math.round(span.size*2)),bold:span.bold,italics:span.italic,color:/^#?[0-9a-f]{6}$/i.test(span.color)?span.color.replace("#",""):"000000"}))});
}
