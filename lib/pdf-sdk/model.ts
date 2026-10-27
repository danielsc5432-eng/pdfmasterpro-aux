import type { LayoutPage, LayoutWord } from "../processing/layout";

export type SourceSpan = { id: string; page: number; text: string; x: number; y: number; width: number; height: number; baseline?:number; font: string; size: number; bold: boolean; italic: boolean; color: string };
export type SourceDocument = { version: 1; pages: { width: number; height: number; spans: SourceSpan[] }[] };
/** AI plans contain references only. They cannot supply replacement text or values. */
export type TablePlan = { page: number; rows: string[][][] };
export type ReconstructionPlan = { version: 1; tables: TablePlan[] };
export interface LayoutPlanner { readonly name: string; propose(source: SourceDocument, signal: AbortSignal): Promise<unknown> }

export function sourceDocument(pages: LayoutPage[]): SourceDocument {
  return { version: 1, pages: pages.map((page, p) => ({ width: page.width, height: page.height, spans: page.texts.flatMap((line, l) => {
    const words: LayoutWord[] = line.words.length ? line.words : [{ text: line.segments.map(s => s.text).join(""), x: line.x, width: line.width, bold: line.font.bold, italic: line.font.italic }];
    return words.filter(word => word.text.trim()).map((word, w) => ({ id: `p${p}:l${l}:w${w}`, page: p, text: word.text, x: word.x, y: word.y??line.y, width: word.width, height: word.height??line.height, baseline:line.baseline,font: line.font.family, size: line.font.size, bold: word.bold, italic: word.italic, color: line.font.color }));
  }) })) };
}

export function validatePlan(source: SourceDocument, value: unknown): ReconstructionPlan {
  if (!value || typeof value !== "object") throw new Error("Invalid reconstruction plan");
  const plan = value as ReconstructionPlan;
  if (plan.version !== 1 || !Array.isArray(plan.tables) || plan.tables.length > 200) throw new Error("Invalid reconstruction plan");
  const used = new Set<string>();
  const tables = plan.tables.map(table => {
    if (!Number.isInteger(table.page) || !source.pages[table.page] || !Array.isArray(table.rows) || table.rows.length < 2 || table.rows.length > 500) throw new Error("Invalid table page or rows");
    const page = source.pages[table.page], byId = new Map(page.spans.map(span => [span.id, span]));
    const columns = table.rows[0]?.length;
    if (columns < 2 || columns > 50) throw new Error("Invalid table columns");
    const rows = table.rows.map(row => {
      if (!Array.isArray(row) || row.length !== columns) throw new Error("Inconsistent table columns");
      return row.map(cell => {
        if (!Array.isArray(cell) || cell.length > 500) throw new Error("Invalid table cell");
        return cell.map(id => {
          if (typeof id !== "string" || !byId.has(id) || used.has(id)) throw new Error("Unknown, cross-page or duplicated source reference");
          used.add(id); return id;
        });
      });
    });
    // Model-provided order must agree with the physical reading order.
    let lastY = -Infinity;
    for (const row of rows) {
      const spans = row.flat().map(id => byId.get(id)!);
      if (!spans.length) throw new Error("Empty table row");
      const y = Math.min(...spans.map(span => span.y));
      if (y < lastY - 2) throw new Error("Table rows reverse source order");
      lastY = y;
      let lastX = -Infinity;
      for (const cell of row) {
        const items = cell.map(id => byId.get(id)!);
        if (!items.length) continue;
        const x = Math.min(...items.map(span => span.x));
        if (x < lastX - 2) throw new Error("Table cells reverse source order");
        lastX = x;
      }
    }
    return { page: table.page, rows };
  });
  // Strip all extra model keys, including any attempted replacement text.
  return { version: 1, tables };
}
