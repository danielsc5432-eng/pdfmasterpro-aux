import { z } from "zod";

export const SUMMARY_LIMITS = { uploadBytes: 4 * 1024 * 1024, pages: 120, characters: 60000, chunkCharacters: 7500, chunks: 8, ocrPages: 10, durationMs: 230000, resultCharacters: 16000 } as const;
export const summaryOptionsSchema = z.object({ length: z.enum(["short", "medium", "long"]), mode: z.enum(["standard", "advanced"]), instructions: z.string().trim().max(1200).default(""), pages: z.string().trim().max(300).default(""), consent: z.literal(true) }).strict();
export type SummaryOptions = z.infer<typeof summaryOptionsSchema>;
export type SummaryPage = { number: number; text: string; ocr: boolean; warning?: string };
export type SummarySource = { id: string; page: number; text: string };
export type SummaryPoint = { text: string; evidence: { sourceId: string; quote: string }[] };
export type SummaryResult = { version: 1; id: string; createdAt: string; expiresAt: string; name: string; options: SummaryOptions; provider: string; model: string; totalPages: number; analyzedPages: number[]; unreadPages: number[]; warnings: string[]; points: SummaryPoint[]; sources: SummarySource[]; usage: { calls: number; chunks: number } };
export type SummaryProgress = { type: "progress"; stage: "validating" | "extracting" | "summarizing" | "checking"; message: string; current?: number; total?: number };
export type SummaryEvent = SummaryProgress | { type: "result"; result: SummaryResult } | { type: "error"; message: string };
export type SummaryCapabilities = { available: boolean; provider: string; costNotice: string; models: { standard: string | null; advanced: string | null }; limits: typeof SUMMARY_LIMITS; ocr: boolean; jobsPerDay: number; authenticated: boolean; warning?: string; privacyUrl?: string; fallbackPrivacyUrl?: string };
export const summaryResultSchema = z.object({ version: z.literal(1), id: z.uuid(), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), name: z.string().max(160), options: summaryOptionsSchema, provider: z.string().max(100), model: z.string().max(200), totalPages: z.number().int().min(1).max(120), analyzedPages: z.array(z.number().int().min(1).max(120)).max(120), unreadPages: z.array(z.number().int().min(1).max(120)).max(120), warnings: z.array(z.string().max(600)).max(130), points: z.array(z.object({ text: z.string().max(1200), evidence: z.array(z.object({ sourceId: z.string().max(40), quote: z.string().max(650) }).strict()).min(1).max(3) }).strict()).min(1).max(18), sources: z.array(z.object({ id: z.string().max(40), page: z.number().int().min(1).max(120), text: z.string().max(1100) }).strict()).max(54), usage: z.object({ calls: z.number().int().min(1).max(9), chunks: z.number().int().min(1).max(8) }).strict() }).strict();

export function selectedPages(value: string, total: number) {
  if (!value) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
    if (!match) throw Error("Use páginas como 1-5, 8, 10-20.");
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last < first || last > total) throw Error("O intervalo inclui páginas inexistentes ou está invertido.");
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
export function requestedPages(options: SummaryOptions) {
  const match = options.instructions.match(/p[áa]ginas?\s+(\d{1,3})\s*(?:a|at[ée]|-)\s*(\d{1,3})/i);
  const inferred = match ? `${match[1]}-${match[2]}` : "";
  if (inferred && options.pages && options.pages.replace(/\s/g, "") !== inferred) throw Error("O intervalo informado nas instruções difere do campo de páginas. Use o mesmo intervalo nos dois campos.");
  return options.pages || inferred;
}
