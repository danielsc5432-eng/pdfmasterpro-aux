import JSZip from "jszip";
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from "docx";

export type ExtraEngine = "docling" | "stirling";
export function configuredExtraEngines(): ExtraEngine[] {
  return (["docling", "stirling"] as const).filter(e => Boolean(process.env[e === "docling" ? "DOCLING_URL" : "STIRLING_PDF_URL"]));
}
type Item = { text?: string; children?: { $ref: string }[]; prov?: { page_no: number }[]; data?: { num_rows: number; num_cols: number; table_cells: { text: string; start_row_offset_idx: number; start_col_offset_idx: number }[] } };
type Structure = { body?: Item; texts?: Item[]; tables?: Item[]; groups?: Item[]; pictures?: Item[] };

/** Docling exports structure rather than DOCX. Rebuild editable reading order. */
export async function doclingDocumentToWord(document: Structure): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];
  const visited = new Set<string>();
  let page = 1;
  function walk(item: Item, depth: number) {
    if (depth > 64 || visited.size > 20000) throw new Error("Document structure exceeds limits");
    const next = item.prov?.[0]?.page_no;
    if (next && next > page) { children.push(new Paragraph({ pageBreakBefore: true })); page = next; }
    if (item.data) {
      const { num_rows: rows, num_cols: cols, table_cells: cells } = item.data;
      if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows * cols > 20000) throw new Error("Invalid table dimensions");
      const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
      // Every merged-cell value appears once; layout differences remain subject to fidelity checks.
      for (const cell of cells) {
        const r = cell.start_row_offset_idx, c = cell.start_col_offset_idx;
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= rows || c < 0 || c >= cols || typeof cell.text !== "string") throw new Error("Invalid table cell");
        grid[r][c] += (grid[r][c] ? "\n" : "") + cell.text;
      }
      children.push(new Table({ rows: grid.map(row => new TableRow({ children: row.map(text => new TableCell({ children: [new Paragraph(text)] })) })) }));
    } else if (typeof item.text === "string" && item.text.trim()) children.push(new Paragraph(item.text));
    for (const child of item.children || []) {
      if (visited.has(child.$ref)) continue;
      const match = /^#\/(texts|tables|groups|pictures)\/(\d+)$/.exec(child.$ref);
      if (!match) throw new Error("Unsupported document reference");
      visited.add(child.$ref);
      const nested = document[match[1] as "texts" | "tables" | "groups" | "pictures"]?.[Number(match[2])];
      if (!nested) throw new Error("Missing document reference");
      walk(nested, depth + 1);
    }
  }
  if (!document.body) throw new Error("Missing document body");
  walk(document.body, 0);
  if (!children.length) throw new Error("Empty document");
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

async function boundedBody(response: Response) {
  if (!response.ok || !response.body) throw new Error("Conversion service unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024 * 1024) throw new Error("Conversion response exceeds limit");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function extraEngineToWord(engine: ExtraEngine, input: Uint8Array, timeout: number): Promise<Uint8Array> {
  const url = new URL(process.env[engine === "docling" ? "DOCLING_URL" : "STIRLING_PDF_URL"] || "");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid conversion endpoint");
  url.pathname = url.pathname.replace(/\/$/, "") + (engine === "docling" ? "/v1/convert/file" : "/api/v1/convert/pdf/word");
  const form = new FormData();
  form.append(engine === "docling" ? "files" : "fileInput", new Blob([new Uint8Array(input)], { type: "application/pdf" }), "document.pdf");
  if (engine === "docling") {
    form.append("to_formats", "json"); form.append("do_ocr", "true"); form.append("table_mode", "accurate");
  } else form.append("outputFormat", "docx");
  const key = process.env[engine === "docling" ? "DOCLING_API_KEY" : "STIRLING_PDF_API_KEY"];
  const response = await fetch(url, { method: "POST", body: form, headers: key ? { "X-API-KEY": key } : {}, signal: AbortSignal.timeout(Math.max(1, timeout)), redirect: "error", cache: "no-store" });
  const bytes = await boundedBody(response);
  let output: Uint8Array = bytes;
  if (engine === "docling") {
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (result.status !== "success" || result.errors?.length || !result.document?.json_content) throw new Error("Incomplete Docling conversion");
    output = await doclingDocumentToWord(result.document.json_content);
  }
  const zip = await JSZip.loadAsync(output);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml || !/<w:t(?:\s[^>]*)?>[^<\s]/.test(xml)) throw new Error("Conversion produced no editable text");
  return output;
}
