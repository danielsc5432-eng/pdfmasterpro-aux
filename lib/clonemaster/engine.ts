import JSZip from "jszip";
import { LIMITS, type BatchResult, type Cell, type CloneConfig, type CloneOutput, type Column, type Plan, type Preview, type Sheet, type Source, type Template } from "./types";
import { readTextTemplate, renderTextTemplate, validateOutput } from "./text-template";
import { readXlsxSource } from "./xlsx-source";

export const FormatRegistry = { templates: ["txt", "ini", "cfg"], sources: ["xlsx"], modes: ["exact-text"] } as const;
export const TemplateReader = { read: readTextTemplate };
export const DataSourceReader = { read: readXlsxSource };
export const TemplateRenderer = { render: renderTextTemplate };
export const OutputValidator = { validate: validateOutput };
export const normalizeName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function columnsFor(sheet: Sheet, headerRow: number): Column[] {
  const row = sheet.rows.find(row => row.number === headerRow);
  if (!row) throw Error("A linha de cabeçalho não existe nesta aba.");
  const columns = Object.entries(row.cells).filter(([, cell]) => cell.raw.trim() !== "").map(([id, cell]) => ({ id, label: cell.raw }));
  if (columns.some(column => column.label.length > 200)) throw Error("Um cabeçalho excede 200 caracteres. Escolha outra linha ou simplifique o cabeçalho.");
  return columns;
}
export function parseRowSelection(value: string) {
  if (!value.trim()) return null;
  if (value.length > 2000) throw Error("Seleção de linhas longa demais.");
  const selected = new Set<number>();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw Error("Use linhas como 2,4,6-10.");
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end > LIMITS.rows || start > end) throw Error("Intervalo de linhas inválido.");
    for (let i = start; i <= end; i++) selected.add(i);
  }
  return selected;
}
export const DataNormalizer = {
  number(value: string) {
    // Numeric filters may accept Brazilian currency input. Raw XLSX numbers
    // already use dots and are parsed separately, never reformatted in output.
    const normalized = value.trim().replace(/^R\$\s*/, "");
    const cleaned = normalized.includes(",") ? normalized.replace(/\./g, "").replace(",", ".") : normalized;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned) || !Number.isFinite(Number(cleaned))) throw Error("Filtro numérico inválido.");
    return Number(cleaned);
  },
};
function isIsoDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function dateValue(cell: Cell) {
  // Numeric Excel dates are deliberately not guessed across 1900/1904 epochs.
  // A displayed ISO date or an explicit ISO text/date cell is required.
  const value = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(cell.raw) ? cell.raw.slice(0, 10) : cell.displayed;
  if (!value || !isIsoDate(value)) throw Error("Para filtrar datas, use células ISO AAAA-MM-DD válidas ou formato exibido AAAA-MM-DD.");
  return value;
}
export function selectedCell(cell: Cell | undefined, config: CloneConfig): string | null {
  if (!cell || cell.raw === "") {
    if (cell?.formula) throw Error("Fórmula sem valor armazenado; recalcule e salve a planilha.");
    if (config.emptyPolicy === "skip") return null;
    throw Error("Célula vazia na coluna selecionada.");
  }
  if (cell.kind === "error") throw Error("A célula selecionada contém um erro do Excel.");
  if (cell.formula && !config.allowCachedFormulas) throw Error("A coluna selecionada contém fórmulas. Autorize explicitamente os valores armazenados ou recalcule a fonte.");
  const value = config.valueMode === "displayed" ? cell.displayed : cell.raw;
  if (value === null) throw Error("Valor exibido indisponível nesta célula. Escolha valor bruto.");
  return value;
}
export function buildPlan(template: Template, source: Source, config: CloneConfig): Plan {
  if (config.templateId !== template.id || config.sourceId !== source.id || config.mode !== "exact-text") throw Error("Modelo, fonte ou modo de clonagem incompatível.");
  const sheet = source.sheets.find(sheet => sheet.id === config.sheetId);
  if (!sheet) throw Error("Selecione uma aba disponível.");
  if (![config.headerRow, config.firstRow, config.lastRow].every(n => Number.isInteger(n) && n >= 1 && n <= LIMITS.rows) || config.firstRow <= config.headerRow || config.lastRow < config.firstRow) throw Error("Confira o cabeçalho e o intervalo de linhas.");
  if (!["raw", "displayed"].includes(config.valueMode) || !["skip", "error"].includes(config.emptyPolicy) || typeof config.allowCachedFormulas !== "boolean") throw Error("Opções de extração inválidas.");
  const columns = columnsFor(sheet, config.headerRow), fields = new Set<string>();
  if (!config.mappings.length || config.mappings.length > LIMITS.fields) throw Error("Mapeie ao menos um campo do modelo.");
  for (const mapping of config.mappings) { if (!columns.some(column => column.id === mapping.column) || !template.fields.some(field => field.id === mapping.field) || fields.has(mapping.field)) throw Error("Coluna ou campo ausente, ou destino mapeado mais de uma vez."); fields.add(mapping.field); }
  const filter = config.filter;
  if (filter && (!columns.some(c => c.id === filter.column) || !["contains", "equals", "gt", "lt", "date-before", "date-after"].includes(filter.operator) || filter.value.length > 1000)) throw Error("Filtro inválido.");
  if (filter?.operator.startsWith("date-") && !isIsoDate(filter.value)) throw Error("Informe uma data válida de filtro como AAAA-MM-DD.");
  const selected = parseRowSelection(config.selectedRows), records: number[] = [], warnings = new Set(source.warnings);
  let emptyCount = 0;
  for (const row of sheet.rows) {
    if (row.number < config.firstRow || row.number > config.lastRow || (selected && !selected.has(row.number))) continue;
    if (filter) {
      const cell = row.cells[filter.column], actual = selectedCell(cell, config);
      if (actual === null || !cell) continue;
      let matches = false;
      switch (filter.operator) {
        case "contains": matches = normalizeName(actual).includes(normalizeName(filter.value)); break;
        case "equals": matches = actual === filter.value; break;
        case "gt": case "lt": { const number = cell.kind === "number" ? Number(cell.raw) : DataNormalizer.number(actual), threshold = DataNormalizer.number(filter.value); matches = filter.operator === "gt" ? number > threshold : number < threshold; break; }
        case "date-before": case "date-after": { const value = dateValue(cell); matches = filter.operator === "date-before" ? value < filter.value : value > filter.value; break; }
      }
      if (!matches) continue;
    }
    // Structural selection only. Per-cell extraction errors are reported by the
    // batch without discarding independent valid records from other templates.
    const empty = config.mappings.some(mapping => !row.cells[mapping.column] || (row.cells[mapping.column].raw === "" && !row.cells[mapping.column].formula));
    if (empty && config.emptyPolicy === "skip") { emptyCount++; continue; }
    if (config.mappings.some(mapping => row.cells[mapping.column]?.formula)) warnings.add("Existem fórmulas selecionadas: resultados armazenados não são recalculados nem garantidos atuais.");
    records.push(row.number);
  }
  if (emptyCount) warnings.add(`${emptyCount} linha(s) ignorada(s) por célula vazia no mapeamento.`);
  if (!records.length) throw Error("Nenhum registro corresponde às opções selecionadas.");
  if (records.length > LIMITS.outputs) throw Error("Reduza a seleção para no máximo 500 resultados no lote.");
  if (sheet.hidden) warnings.add("Você selecionou uma aba oculta da planilha.");
  return { config, records, warnings: [...warnings], selectedColumns: [...new Set(config.mappings.map(mapping => mapping.column))], mode: "exact-text", outputExtension: template.extension };
}
export function previewRecord(template: Template, source: Source, config: CloneConfig, rowNumber: number): { preview: Preview; bytes: Uint8Array } {
  const row = source.sheets.find(sheet => sheet.id === config.sheetId)?.rows.find(row => row.number === rowNumber);
  if (!row) throw Error("Registro não encontrado.");
  const replacements = config.mappings.map(mapping => { const value = selectedCell(row.cells[mapping.column], config); if (value === null) throw Error("Registro ignorado por célula vazia."); return { field: mapping.field, value }; });
  const bytes = renderTextTemplate(template, replacements);
  const changes = config.mappings.map((mapping, index) => { const field = template.fields.find(field => field.id === mapping.field)!; return { field: `${field.section ? `[${field.section}] → ` : ""}${field.key} · linha ${field.line}`, column: mapping.column, before: field.value, after: replacements[index].value }; });
  return { bytes, preview: { before: template.text, after: new TextDecoder(template.encoding, { ignoreBOM: true }).decode(bytes.subarray(template.bomLength)), changes, row: rowNumber } };
}
export const FieldMapper = { validate: buildPlan };

export class NaturalLanguageExtractionPlanner {
  analyze(instruction: string, template: Template, source: Source, base: CloneConfig): { config: CloneConfig | null; issues: string[]; explanation: string } {
    if (!instruction.trim() || instruction.length > LIMITS.instruction) return { config: null, issues: ["Escreva uma instrução de até 2.000 caracteres."], explanation: "" };
    const normalized = normalizeName(instruction), issues: string[] = [];
    const sheet = source.sheets.find(sheet => sheet.id === base.sheetId);
    if (!sheet) return { config: null, issues: ["Selecione uma fonte e uma aba."], explanation: "" };
    if (/\b(filtr\w*|onde|maior|menor|multipli\w*|somar|media|arredond\w*|execut\w*|script|codigo|python|javascript|converta|renome\w*|ignore|exceto|primeir\w*|ultim\w*|linhas?|metade|dobro|adicion\w*|remov\w*|apagu\w*|exclu\w*)\b|[<>]|\b\d+\b/.test(normalized)) issues.push("A instrução contém filtro, transformação ou operação fora da interpretação automática. Configure o mapeamento/filtro manual e confirme apenas o plano exibido.");
    if (!/\b(coluna|column)\b/.test(normalized) || !/\b(campo|chave)\b/.test(normalized) || !/\b(substitu\w*|troqu\w*|preench\w*)\b/.test(normalized)) issues.push("Indique explicitamente a coluna de origem, o campo/chave de destino e a substituição desejada.");
    const mentions = (text: string, label: string) => { const name = normalizeName(label); const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp(`(?:^|[^a-z0-9_])${escaped}(?=$|[^a-z0-9_])`, "i").test(text); };
    const sourcePart = normalized.match(/\bcoluna\s+(.+?)(?:\s+da\s+planilha|\s+e\s+substit|[.;]|$)/)?.[1] ?? "";
    const destinationPart = normalized.match(/\b(?:campo|chave)\s+(.+?)(?:\s+no\s+|\s+na\s+|[.;]|$)/)?.[1] ?? "";
    const columns = columnsFor(sheet, base.headerRow).filter(c => mentions(sourcePart, c.label) || normalizeName(c.id) === sourcePart.replace(/["']/g, "").trim());
    let fields = template.fields.filter(field => mentions(destinationPart, field.key));
    const sectionNames = [...new Set(template.fields.map(field => field.section).filter(Boolean))].filter(section => normalized.includes(`[${normalizeName(section)}]`));
    if (sectionNames.length === 1) fields = fields.filter(field => field.section === sectionNames[0]);
    if (columns.length !== 1) issues.push(columns.length ? "Há colunas ambíguas. Escolha a coluna pelo identificador no mapeamento." : "A coluna solicitada não foi encontrada; nenhum valor foi inventado.");
    if (fields.length !== 1) issues.push(fields.length ? "Há mais de uma ocorrência da chave. Escolha a seção e a linha no mapeamento." : "A chave solicitada não existe no modelo.");
    if (issues.length) return { config: null, issues, explanation: "Nenhuma configuração foi aplicada automaticamente." };
    // Reset narrowing options to prevent stale filters silently changing a new command.
    const config: CloneConfig = { ...base, mappings: [{ column: columns[0].id, field: fields[0].id }], firstRow: base.headerRow + 1, lastRow: Math.max(...sheet.rows.map(row => row.number)), selectedRows: "", filter: null, mode: "exact-text" };
    return { config, issues: [], explanation: `Usar somente ${columns[0].label} (${columns[0].id}) para substituir ${fields[0].section ? `[${fields[0].section}] → ` : ""}${fields[0].key}, linha ${fields[0].line}. Um arquivo ${template.extension.toUpperCase()} por registro válido. Confira as opções e confirme o plano antes de gerar.` };
  }
}

export class MultiTemplateManager {
  static validate(templates: Template[]) { if (!templates.length || templates.length > LIMITS.filesPerArea || new Set(templates.map(t => t.id)).size !== templates.length) throw Error("Selecione de 1 a 5 modelos com identificadores únicos."); }
}
export class MultiSourceManager {
  static validate(sources: Source[]) { if (!sources.length || sources.length > LIMITS.filesPerArea || new Set(sources.map(s => s.id)).size !== sources.length) throw Error("Selecione de 1 a 5 fontes com identificadores únicos."); }
}
export class OutputPackageManager {
  static async zip(outputs: CloneOutput[]) { const zip = new JSZip(); for (const output of outputs) zip.file(output.filename, output.bytes, { date: new Date("2000-01-01T00:00:00Z") }); return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } }); }
}
export class BatchJobManager {
  async run(templates: Template[], sources: Source[], configs: CloneConfig[], options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; yieldControl?: () => Promise<void> } = {}): Promise<BatchResult> {
    MultiTemplateManager.validate(templates); MultiSourceManager.validate(sources);
    if (configs.length !== templates.length || new Set(configs.map(c => c.templateId)).size !== configs.length) throw Error("Cada modelo precisa de uma configuração independente.");
    const jobs = configs.map(config => { const template = templates.find(t => t.id === config.templateId), source = sources.find(s => s.id === config.sourceId); if (!template || !source) throw Error("Modelo ou fonte removido do lote."); return { template, source, config, plan: buildPlan(template, source, config) }; });
    const total = jobs.reduce((sum, job) => sum + job.plan.records.length, 0);
    if (total > LIMITS.outputs) throw Error("O lote completo excede 500 arquivos. Reduza os registros selecionados.");
    const outputs: CloneOutput[] = [], errors: BatchResult["errors"] = []; let done = 0, bytes = 0;
    const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    for (let modelIndex = 0; modelIndex < jobs.length; modelIndex++) {
      const { template, source, config, plan } = jobs[modelIndex]; let sequence = 0;
      for (const row of plan.records) {
        if (options.signal?.aborted) return { outputs: [], errors: [], zip: null, cancelled: true };
        try {
          const rendered = previewRecord(template, source, config, row);
          bytes += rendered.bytes.length;
          if (bytes > LIMITS.outputBytes) throw Error("O lote ultrapassa 32 MB de resultados. Reduza a seleção.");
          sequence++;
          const filename = jobs.length === 1 ? `funcionario_${String(sequence).padStart(3, "0")}.${template.extension}` : `modelo_${String(modelIndex + 1).padStart(2, "0")}/registro_${String(sequence).padStart(3, "0")}.${template.extension}`;
          outputs.push({ filename, bytes: rendered.bytes, templateId: template.id, row, changes: rendered.preview.changes });
        } catch (error) { if (bytes > LIMITS.outputBytes) throw error; errors.push({ templateId: template.id, row, message: error instanceof Error ? error.message : "Falha na geração do registro." }); }
        done++; options.onProgress?.(done, total); await yieldControl();
      }
    }
    if (options.signal?.aborted) return { outputs: [], errors: [], zip: null, cancelled: true };
    const zip = outputs.length ? await OutputPackageManager.zip(outputs) : null;
    if (options.signal?.aborted) return { outputs: [], errors: [], zip: null, cancelled: true };
    return { outputs, errors, zip, cancelled: false };
  }
}
