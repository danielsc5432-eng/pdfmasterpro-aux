import { generateWithOpenCode } from "./opencode";
import { generateWithOllama, generateWithTransformers } from "./review-providers";
import { runReviewChain } from "./review-chain";
import type { AnalysisResult, Finding } from "./types";

const reasons = {
  wording: "A análise semântica sinalizou mudança de redação. Confirme se o significado foi preservado.",
  obligation: "A análise semântica sinalizou possível mudança de obrigação ou condição. Exige revisão humana.",
  context: "A análise semântica não assegurou equivalência de contexto. Confira finalidade e versão.",
  possible_typo: "A análise semântica sinalizou possível diferença de preenchimento ou digitação. Confira a fonte.",
};

export async function semanticReview(findings: Finding[], requested: boolean, signal?: AbortSignal, transport: typeof fetch = fetch): Promise<{ findings: Finding[]; ai: AnalysisResult["ai"]; warning?: string }> {
  if (!requested) return { findings, ai: { status: "disabled", considered: 0 } };
  const provider = process.env.DIVERGENCE_AI_PROVIDER ?? "ollama";
  const configured = provider === "opencode"
    ? Boolean(process.env.DIVERGENCE_OPENCODE_URL && process.env.DIVERGENCE_OPENCODE_PROVIDER && process.env.DIVERGENCE_OPENCODE_MODEL)
    : provider === "ollama"
      ? Boolean(process.env.DIVERGENCE_OLLAMA_URL && process.env.DIVERGENCE_OLLAMA_MODEL)
      : provider === "transformers" && Boolean(process.env.DIVERGENCE_TRANSFORMERS_URL && process.env.DIVERGENCE_TRANSFORMERS_MODEL);
  if (!configured) return { findings, ai: { status: "not_configured", considered: 0 }, warning: "A IA semântica não está configurada. Os resultados foram calculados por regras, sem envio a fornecedor de IA." };
  const candidates = findings.filter(item => item.category === "clause" && item.evidence.length === 2).slice(0, 10);
  if (!candidates.length) return { findings, ai: { status: "used", considered: 0 } };
  try {
    signal?.throwIfAborted();
    const parsed = await runReviewChain(candidates, prompt => provider === "opencode"
      ? generateWithOpenCode(prompt, signal, transport)
      : provider === "ollama" ? generateWithOllama(candidates, signal, transport) : generateWithTransformers(candidates, signal, transport));
    signal?.throwIfAborted();
    const updates = new Map(parsed.items.map(item => [item.findingId, reasons[item.reason]]));
    return {
      findings: findings.map(item => updates.has(item.id) ? { ...item, origin: "ai", classification: "possible", confidence: "low", explanation: updates.get(item.id)! } : item),
      ai: { status: "used", considered: candidates.length },
    };
  } catch {
    return { findings, ai: { status: "unavailable", considered: candidates.length }, warning: "A IA semântica não concluiu uma resposta válida. As evidências e a comparação por regras foram mantidas." };
  }
}
