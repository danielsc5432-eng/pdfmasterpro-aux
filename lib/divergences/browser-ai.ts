import type { Finding, LocalAiReview } from "./types";

export function localAiPairs(findings: Finding[]) {
  return findings.filter(item => ["clause", "text"].includes(item.category) && item.evidence.length === 2)
    .slice(0, 10).map(item => ({ id: item.id, texts: item.evidence.map(source => source.quote.slice(0, 450)) }));
}

export function validatedLocalReview(data: unknown, findings: Finding[]): LocalAiReview {
  const result = data as Partial<LocalAiReview> | null;
  const allowed = new Set(localAiPairs(findings).map(pair => pair.id));
  if (!result || result.model !== "Xenova/paraphrase-multilingual-MiniLM-L12-v2" || result.revision !== "2c4055b12046f11709e9df2c122e59ffbdc2f900" ||
      typeof result.createdAt !== "string" || !Number.isFinite(Date.parse(result.createdAt)) || !Array.isArray(result.items) || result.items.length !== allowed.size) throw Error("Resposta inválida da IA local.");
  const seen = new Set<string>();
  for (const item of result.items) {
    if (!allowed.has(item.findingId) || seen.has(item.findingId) || !Number.isFinite(item.similarity) || item.similarity < -1 || item.similarity > 1) throw Error("Referência inválida da IA local.");
    seen.add(item.findingId);
  }
  return { model: result.model, revision: result.revision, createdAt: result.createdAt, items: result.items.map(item => ({ findingId: item.findingId, similarity: item.similarity })) };
}
