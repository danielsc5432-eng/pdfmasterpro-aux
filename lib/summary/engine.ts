import { randomUUID } from "node:crypto";
import { z } from "zod";
import { generateSummaryPoints, summaryConfig, summaryFallbackConfig, SummaryTransientError } from "./provider";
import { SUMMARY_LIMITS, type SummaryOptions, type SummarySource, type SummaryPoint, type SummaryPage, type SummaryProgress, type SummaryResult } from "./types";

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const numericTokens = (text: string) => text.match(/[+-]?\d+(?:[.,:/-]\d+)*(?:\s*%)?/g)?.map(normalize) || [];
const currencyTokens = (text: string) => text.match(/US\$|R\$|\b(?:USD|BRL|EUR|GBP)\b|€|£/gi)?.map(value => value.toUpperCase()) || [];
const pointsSchema = z.object({ points: z.array(z.object({ text: z.string().trim().min(8).max(1200), evidence: z.array(z.object({ sourceId: z.string().max(40), quote: z.string().trim().min(10).max(650) }).strict()).min(1).max(3) }).strict()).max(10) }).strict();
export function validateSummaryPoints(content: string, sources: SummarySource[]): SummaryPoint[] {
  let parsed;
  // Accept a single whole-response JSON code fence, never extract JSON from surrounding prose.
  const fenced = content.trim().match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  try { parsed = pointsSchema.parse(JSON.parse(fenced ? fenced[1] : content)); } catch { throw Error("A IA retornou uma estrutura inválida. Nenhum resumo foi entregue."); }
  const byId = new Map(sources.map(source => [source.id, source]));
  for (const point of parsed.points) {
    if (/https?:\/\/|<\/?[a-z]|\[\s*(?:p[áa]g|p\.)/i.test(point.text)) throw Error("O resumo contém conteúdo ou referências não permitidos.");
    for (const evidence of point.evidence) {
      const source = byId.get(evidence.sourceId);
      if (!source || !normalize(source.text).includes(normalize(evidence.quote))) throw Error("Uma citação da IA não corresponde ao texto extraído. Nenhum resumo foi entregue.");
    }
    const allowed = new Set(numericTokens(point.evidence.map(item => item.quote).join(" ")));
    if (numericTokens(point.text).some(value => !allowed.has(value))) throw Error("A IA alterou ou acrescentou um número ou data sem suporte na citação. Nenhum resumo foi entregue.");
    const currencies = new Set(currencyTokens(point.evidence.map(item => item.quote).join(" ")));
    if (currencyTokens(point.text).some(value => !currencies.has(value))) throw Error("A IA alterou uma moeda sem suporte na citação. Nenhum resumo foi entregue.");
  }
  return parsed.points;
}
export function summaryChunks(pages: SummaryPage[]): SummarySource[][] {
  const sources: SummarySource[] = [];
  for (const page of pages) {
    const text = normalize(page.text);
    for (let start = 0, index = 1; start < text.length; index++) {
      let end = Math.min(start + 1100, text.length);
      if (end < text.length) { const split = text.lastIndexOf(" ", end); if (split > start + 500) end = split; }
      const part = text.slice(start, end).trim();
      if (part) sources.push({ id: `p${page.number}s${index}`, page: page.number, text: part });
      start = end;
    }
  }
  const chunks: SummarySource[][] = []; let current: SummarySource[] = []; let count = 0;
  for (const source of sources) {
    if (current.length && count + source.text.length > SUMMARY_LIMITS.chunkCharacters) { chunks.push(current); current = [current[current.length - 1]]; count = current[0].text.length; }
    current.push(source); count += source.text.length;
  }
  if (current.length) chunks.push(current);
  if (!chunks.length || chunks.length > SUMMARY_LIMITS.chunks) throw Error("O documento excede o orçamento de análise. Selecione um intervalo menor de páginas.");
  return chunks;
}
export async function summarizeExtracted(input: { name: string; totalPages: number; pages: SummaryPage[] }, options: SummaryOptions, signal: AbortSignal, progress: (event: SummaryProgress) => void, generate: typeof generateSummaryPoints = generateSummaryPoints): Promise<SummaryResult> {
  const config = summaryConfig(); const model = options.mode === "advanced" ? config.advanced : config.standard;
  if (!model) throw Error("O modelo escolhido não está configurado.");
  let activeConfig = config; let calls = 0; let switched = false;
  const reserve = summaryFallbackConfig(); const used = new Map<string, string>();
  const chunks = summaryChunks(input.pages); const maps: SummaryPoint[][] = [];
  let context = "";
  for (let index = 0; index < chunks.length; index++) {
    signal.throwIfAborted(); progress({ type: "progress", stage: "summarizing", message: `Analisando trecho ${index + 1} de ${chunks.length}.`, current: index, total: chunks.length });
    let content: string;
    try { calls++; content = await generate(chunks[index], options, context, signal, undefined, activeConfig); }
    catch (error) {
      signal.throwIfAborted();
      const temporary = error instanceof SummaryTransientError || (error instanceof Error && error.name === "TimeoutError");
      if (!temporary || switched || !reserve || !(options.mode === "advanced" ? reserve.advanced : reserve.standard)) throw error;
      switched = true; activeConfig = reserve;
      progress({ type: "progress", stage: "summarizing", message: `Continuando a análise do trecho ${index + 1} de ${chunks.length}.`, current: index, total: chunks.length });
      calls++; content = await generate(chunks[index], options, context, signal, undefined, activeConfig);
    }
    used.set(activeConfig.provider, (options.mode === "advanced" ? activeConfig.advanced : activeConfig.standard)!);
    signal.throwIfAborted();
    const points = validateSummaryPoints(content, chunks[index]); maps.push(points);
    context = points.slice(-2).map(point => point.text).join(" ");
    progress({ type: "progress", stage: "summarizing", message: `Trecho ${index + 1} de ${chunks.length} analisado e conferido.`, current: index + 1, total: chunks.length });
  }
  progress({ type: "progress", stage: "checking", message: "Organizando os tópicos e conferindo as referências." });
  const maximum = { short: 5, medium: 10, long: 18 }[options.length];
  const selected: SummaryPoint[] = []; const seen = new Set<string>();
  for (let level = 0; level < 10 && selected.length < maximum; level++) for (const map of maps) {
    const point = map[level]; if (!point || selected.length >= maximum) continue;
    const key = normalize(point.text).toLowerCase();
    if (!seen.has(key)) { seen.add(key); selected.push(point); }
  }
  if (!selected.length) throw Error("A IA não encontrou informações suficientes para o foco solicitado. Tente outro intervalo ou instruções mais gerais.");
  const sources = [...new Map(chunks.flat().map(source => [source.id, source])).values()].filter(source => selected.some(point => point.evidence.some(item => item.sourceId === source.id)));
  const warnings = input.pages.filter(page => page.warning).map(page => `Página ${page.number}: ${page.warning}`);
  if (switched) warnings.push("A IA de reserva foi utilizada automaticamente após indisponibilidade da principal.");
  if (input.pages.some(page => page.ocr)) warnings.push("OCR foi utilizado. Revise nas páginas originais os valores, nomes e datas reconhecidos.");
  warnings.push("As citações e os números foram conferidos no texto extraído. Isso não garante que a interpretação da IA esteja correta; revise o documento original.");
  if (selected.length === maximum && maps.flat().length > maximum) warnings.push("O tamanho escolhido seleciona os tópicos principais; o resumo não reproduz todas as informações do documento.");
  const now = Date.now();
  const result: SummaryResult = { version: 1, id: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60 * 1000).toISOString(), name: input.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160), options, provider: [...used.keys()].join(" / ").slice(0, 100), model: [...new Set(used.values())].join(" / ").slice(0, 200), totalPages: input.totalPages, analyzedPages: input.pages.filter(page => page.text.trim()).map(page => page.number), unreadPages: input.pages.filter(page => !page.text.trim()).map(page => page.number), warnings, points: selected, sources, usage: { calls, chunks: chunks.length } };
  if (selected.reduce((sum, point) => sum + point.text.length, 0) > SUMMARY_LIMITS.resultCharacters) throw Error("O resultado excedeu o limite de exportação.");
  return result;
}
