import JSZip from "jszip";
import { SaxesParser } from "saxes";
import * as SSF from "ssf";
import { LIMITS, type Cell, type Sheet, type Source, type SourceRow } from "./types";

type Xml = { name: string; attributes: Record<string, string>; children: Xml[]; text: string };
function xml(bytes: Uint8Array, budget: { nodes: number }): Xml {
  let value: string;
  try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw Error("Os XMLs desta planilha devem usar UTF-8."); }
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw Error("Declarações DTD e entidades externas não são permitidas.");
  const stack: Xml[] = []; let root: Xml | null = null;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", tag => {
    if (++budget.nodes > 250000 || stack.length > 32) throw Error("XML excede o limite de estrutura do arquivo.");
    const node: Xml = { name: tag.name.split(":").pop()!, attributes: { ...tag.attributes }, children: [], text: "" };
    if (Object.keys(node.attributes).length > 32) throw Error("XML com atributos excessivos.");
    if (Object.values(node.attributes).some(value => value.length > 2048)) throw Error("Atributo XML excede o limite.");
    if (stack.length) stack[stack.length - 1].children.push(node); else { if (root) throw Error("XML com múltiplas raízes."); root = node; }
    stack.push(node);
  });
  const text = (value: string) => { if (stack.length) { const node = stack[stack.length - 1]; node.text += value; if (node.text.length > 65536) throw Error("Texto de célula excede o limite."); } };
  parser.on("text", text); parser.on("cdata", text); parser.on("closetag", () => { stack.pop(); });
  parser.on("error", () => { throw Error("XML inválido na planilha."); });
  parser.write(value).close();
  if (!root) throw Error("XML vazio.");
  return root;
}
const children = (node: Xml | undefined, name: string) => node?.children.filter(child => child.name === name) ?? [];
const child = (node: Xml | undefined, name: string) => children(node, name)[0];
function richText(node?: Xml) { return node ? node.children.filter(n => n.name === "t" || n.name === "r").map(n => n.name === "t" ? n.text : children(n, "t").map(t => t.text).join("")).join("") : ""; }

/** Check the central directory before JSZip can sanitize paths or inflate data. */
export function inspectXlsxArchive(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > LIMITS.sourceBytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw Error("Envie uma planilha XLSX válida, de até 8 MB. XLS/XLSM não são aceitos.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error("ZIP inválido ou dividido em volumes.");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (!count || count > LIMITS.zipEntries || view.getUint16(end + 8, true) !== count || offset + size !== end) throw Error("Planilha com estrutura ZIP excessiva ou ZIP64 não suportado.");
  let at = offset, expanded = 0;
  const seen = new Set<string>(), sizes = new Map<string, { size: number; crc: number }>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw Error("Diretório ZIP inválido.");
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), compressed = view.getUint32(at + 20, true), inflated = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true), local = view.getUint32(at + 42, true);
    if (at + 46 + nameLength + extra + comment > end || local + 30 > offset || view.getUint32(local, true) !== 0x04034b50 || compressed === 0xffffffff || inflated === 0xffffffff || (flags & 1) || ![0, 8].includes(method)) throw Error("ZIP criptografado, método desconhecido ou cabeçalho inválido.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (!name || name.length > 240 || /[^\x20-\x7e]|\\|^\/|:/.test(name) || name.split("/").includes("..") || seen.has(name)) throw Error("Caminho inseguro ou duplicado no ZIP.");
    if (/vbaProject|externalLinks|activeX|embeddings/i.test(name)) throw Error("Planilhas com macros, vínculos externos ou objetos incorporados não são aceitas.");
    const localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    if (local + 30 + localNameLength + localExtra + compressed > offset) throw Error("Entrada ZIP fora dos limites.");
    const localName = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(local + 30, local + 30 + localNameLength));
    if (localName !== name || view.getUint16(local + 8, true) !== method) throw Error("Nomes ou métodos divergentes no ZIP.");
    seen.add(name); sizes.set(name, { size: inflated, crc: view.getUint32(at + 16, true) }); expanded += inflated;
    if (inflated > LIMITS.xmlBytes || expanded > LIMITS.inflatedBytes) throw Error("Planilha excede o limite de descompactação (24 MB no total, 8 MB por entrada).");
    at += 46 + nameLength + extra + comment;
  }
  if (at !== end) throw Error("ZIP com diretório inconsistente.");
  return sizes;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => { let crc = index; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; return crc >>> 0; });
async function boundedRead(entry: JSZip.JSZipObject, expected: { size: number; crc: number }) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = []; let size = 0, failed = false, crc = 0xffffffff;
    // JSZip 3.10 exposes this documented method but omits it in JSZipObject's
    // declarations. Keep the shim local and typed; do not access _data internals.
    type Stream = { on(event: "data", callback: (chunk: Uint8Array) => void): Stream; on(event: "error", callback: () => void): Stream; on(event: "end", callback: () => void): Stream; pause(): void; resume(): void };
    const stream = (entry as JSZip.JSZipObject & { internalStream(type: "uint8array"): Stream }).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => { if (failed) return; size += chunk.length; if (size > expected.size || size > LIMITS.xmlBytes) { failed = true; stream.pause(); reject(Error("Descompactação excedeu o tamanho declarado.")); return; } for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; chunks.push(chunk); });
    stream.on("error", () => { failed = true; reject(Error("Falha ao descompactar a planilha.")); });
    stream.on("end", () => { if (failed) return; if (size !== expected.size || ((crc ^ 0xffffffff) >>> 0) !== expected.crc) { reject(Error("Tamanho ou CRC da entrada XLSX inconsistente. O arquivo pode estar corrompido.")); return; } const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } resolve(bytes); });
    stream.resume();
  });
}
function relationshipPath(base: string, target: string) {
  if (!target || /[\\:%?#\x00-\x20]/.test(target)) throw Error("Destino de relação XLSX inseguro.");
  const result: string[] = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of target.split("/")) { if (!part || part === ".") continue; if (part === "..") { if (!result.length) throw Error("Relação fora do pacote."); result.pop(); } else result.push(part); }
  return result.join("/");
}
function parseRelations(node: Xml) {
  if (node.name !== "Relationships") throw Error("Relações XLSX inválidas.");
  const relations = children(node, "Relationship"), ids = new Set<string>();
  for (const relation of relations) { if (relation.attributes.TargetMode === "External") throw Error("Relações externas não são permitidas."); if (!relation.attributes.Id || ids.has(relation.attributes.Id)) throw Error("Relação XLSX duplicada."); ids.add(relation.attributes.Id); }
  return relations;
}
function columnNumber(name: string) { let value = 0; for (const c of name) value = value * 26 + c.charCodeAt(0) - 64; return value; }

export async function readXlsxSource(id: string, name: string, bytes: Uint8Array): Promise<Source> {
  if (!name.toLowerCase().endsWith(".xlsx")) throw Error("Fontes disponíveis nesta etapa: XLSX, sem macros.");
  const sizes = inspectXlsxArchive(bytes), zip = await JSZip.loadAsync(bytes, { createFolders: false });
  const documents = new Map<string, Xml>();
  const budget = { nodes: 0 };
  // Bound every XML before parsing. Do not let ignored relationship files hide
  // external links, DTDs, or malicious payloads behind a supported workbook.
  for (const [path, size] of sizes) if (/\.(xml|rels)$/i.test(path)) {
    const entry = zip.file(path); if (!entry) throw Error("Entrada XLSX ausente.");
    const doc = xml(await boundedRead(entry, size), budget); documents.set(path, doc);
    if (path.endsWith(".rels")) parseRelations(doc);
  }
  const types = documents.get("[Content_Types].xml"), workbook = documents.get("xl/workbook.xml"), rels = documents.get("xl/_rels/workbook.xml.rels");
  if (types?.name !== "Types" || workbook?.name !== "workbook" || !rels || !types.children.some(n => n.attributes.ContentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")) throw Error("O arquivo não é uma pasta de trabalho XLSX suportada.");
  const relations = parseRelations(rels), shared = children(documents.get("xl/sharedStrings.xml"), "si").map(richText);
  if (shared.length > LIMITS.cells || shared.some(value => value.length > 32767)) throw Error("Tabela de textos excede o limite.");
  const styles = documents.get("xl/styles.xml"), formats = new Map<number, string>();
  for (const n of children(child(styles, "numFmts"), "numFmt")) { if (!n.attributes.formatCode || n.attributes.formatCode.length > 256) throw Error("Formato numérico excessivo ou inválido."); formats.set(Number(n.attributes.numFmtId), n.attributes.formatCode); }
  const cellStyles = children(child(styles, "cellXfs"), "xf").map(n => Number(n.attributes.numFmtId ?? 0));
  const date1904 = ["1", "true"].includes(child(workbook, "workbookPr")?.attributes.date1904 ?? "");
  const warnings = new Set<string>(), sheets: Sheet[] = [], sheetNames = new Set<string>(); let totalCells = 0;
  for (const item of children(child(workbook, "sheets"), "sheet")) {
    if (sheets.length >= 20) throw Error("A planilha excede 20 abas.");
    const relationId = item.attributes["r:id"] ?? Object.entries(item.attributes).find(([key]) => key.endsWith(":id"))?.[1];
    const relation = relations.find(n => n.attributes.Id === relationId);
    if (!relation?.attributes.Type.endsWith("/worksheet")) throw Error("Tipo de aba não suportado.");
    const path = relationshipPath("xl/workbook.xml", relation.attributes.Target), doc = documents.get(path);
    if (doc?.name !== "worksheet" || !item.attributes.name || sheetNames.has(item.attributes.name)) throw Error("Aba ausente, duplicada ou inválida.");
    sheetNames.add(item.attributes.name);
    if (children(doc, "mergeCells").length) warnings.add("Há células mescladas. Valores de células vazias não são propagados automaticamente.");
    const rows: SourceRow[] = [], usedRows = new Set<number>();
    for (const row of children(child(doc, "sheetData"), "row")) {
      const number = Number(row.attributes.r);
      if (!Number.isInteger(number) || number < 1 || number > LIMITS.rows || usedRows.has(number)) throw Error("Linhas duplicadas ou limite de 5.000 linhas excedido.");
      usedRows.add(number); const cells: SourceRow["cells"] = {};
      for (const c of children(row, "c")) {
        if (++totalCells > LIMITS.cells) throw Error("Limite de 100.000 células excedido.");
        const ref = c.attributes.r?.match(/^([A-Z]{1,3})([1-9]\d*)$/);
        if (!ref || Number(ref[2]) !== number || columnNumber(ref[1]) > LIMITS.columns || cells[ref[1]]) throw Error("Referência de célula inválida, duplicada ou além de 200 colunas.");
        const value = child(c, "v"), formula = !!child(c, "f"), type = c.attributes.t ?? "n";
        let raw = value?.text ?? "", displayed: string | null = raw, kind: Cell["kind"] = "text", warning: string | undefined;
        if (type === "s") { const index = Number(raw); if (!/^\d+$/.test(raw) || !Number.isSafeInteger(index) || shared[index] === undefined) throw Error("Índice de texto compartilhado inválido."); raw = shared[index]; displayed = raw; }
        else if (type === "inlineStr") { raw = richText(child(c, "is")); displayed = raw; }
        else if (type === "b") { if (!["0", "1", ""].includes(raw)) throw Error("Valor booleano inválido."); kind = "boolean"; displayed = raw === "1" ? "TRUE" : raw ? "FALSE" : ""; }
        else if (type === "e") { kind = "error"; warning = "Célula com erro do Excel."; }
        else if (type === "d") { kind = "date"; if (raw && Number.isNaN(Date.parse(raw))) throw Error("Data ISO inválida na planilha."); }
        else if (type === "n" && raw !== "") {
          if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) throw Error("Célula numérica inválida.");
          kind = "number";
          const style = c.attributes.s === undefined ? 0 : Number(c.attributes.s);
          if (!Number.isInteger(style) || style < 0 || (style > 0 && cellStyles[style] === undefined)) throw Error("Estilo de célula inválido.");
          const code = cellStyles[style] ?? 0, format = formats.get(code) ?? SSF.get_table()[code];
          try { if (format === undefined) throw Error(); kind = SSF.is_date(format) ? "date" : "number"; displayed = SSF.format(format, Number(raw), { date1904 }); }
          catch { displayed = null; warning = "Formato exibido não suportado; use o valor bruto."; }
        } else if (!["n", "s", "inlineStr", "b", "e", "d", "str"].includes(type)) throw Error("Tipo de célula não suportado.");
        if (formula) { warning = "Fórmula não recalculada: o valor armazenado pode estar desatualizado."; if (!value) { raw = ""; displayed = null; warning = "Fórmula sem valor armazenado; não é possível extrair um resultado."; } }
        if (raw.length > 32767) throw Error("Valor de célula excede 32.767 caracteres.");
        cells[ref[1]] = { raw, displayed, kind, formula, ...(warning ? { warning } : {}) };
      }
      rows.push({ number, cells });
    }
    sheets.push({ id: `sheet-${sheets.length}`, name: item.attributes.name, hidden: item.attributes.state === "hidden" || item.attributes.state === "veryHidden", rows: rows.sort((a, b) => a.number - b.number) });
  }
  if (!sheets.length) throw Error("Nenhuma aba de dados encontrada.");
  return { id, name, sheets, warnings: [...warnings] };
}
