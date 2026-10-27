import type { LegalAIReviewResult } from "./ai-shared";
export const LEGAL_LIMITS = { files: 4, fileBytes: 5 * 1024 * 1024, totalBytes: 12 * 1024 * 1024, pagesPerFile: 30, pages: 60, charactersPerFile: 120000, blocksPerFile: 500, findings: 300, ocrPages: 5, durationMs: 180000, pixels: 2000000 } as const;
export const LEGAL_CATEGORIES = { text: "Texto", money: "Valores", percent: "Percentuais", date: "Datas", deadline: "Prazos", quantity: "Quantidades", clause: "Cláusulas", party: "Nomes e partes", table: "Possível tabela", page: "Páginas", visual: "Apresentação visual", movement: "Trecho movido" } as const;
export type LegalCategory = keyof typeof LEGAL_CATEGORIES;
export type LegalMode = "text" | "visual" | "structure" | "complete";
export type LegalOptions = { mode: LegalMode; sensitivity: "relevant" | "all"; categories: LegalCategory[]; ocr: boolean };
export type Box = [number, number, number, number]; // PDF.js viewport coordinates, top-left origin, scale 1.
export type LegalLine = { text: string; box: Box; table?: boolean };
export type LegalBlock = { id: string; page: number; text: string; box: Box; clause?: string; table: boolean; ocr: boolean; confidence?: number };
export type LegalPage = { number: number; width: number; height: number; blocks: LegalBlock[]; readable: boolean; ocr: boolean; confidence?: number; signature: Uint8Array; warning?: string };
export type LegalDocument = { id: string; name: string; sha256: string; bytes: number; pages: LegalPage[]; complete: boolean; warnings: string[]; metadata?:Record<string,string> };
export type VersionLabel = { id: string; name: string; date: string }; // Dates explicitly entered by the user, never inferred from file timestamps.
export type LegalEvidence = { documentId: string; page: number; blockId?: string; quote: string; box: Box };
export type LegalFinding = { id: string; pair: number; kind: "added" | "removed" | "modified" | "moved" | "unverified"; categories: LegalCategory[]; title: string; explanation: string; attention: boolean; confidence: "high" | "medium" | "low"; before?: LegalEvidence; after?: LegalEvidence; visualRatio?: number };
export type PageLink = { before: number; after: number; basis: "text" | "blocks" | "position" | "image" };
export type LegalPair = { index: number; beforeId: string; afterId: string; links: PageLink[]; findings: LegalFinding[]; warnings: string[] };
export type LegalReview = { status:"pending"|"reviewed"|"ignore"; note:string };
export type LegalResult = { version: 1; id: string; createdAt: string; expiresAt: string; options: LegalOptions; labels: VersionLabel[]; documents: LegalDocument[]; pairs: LegalPair[]; warnings: string[]; truncated: boolean; reviews?:Record<string,LegalReview>; aiReview?:LegalAIReviewResult; reportName?:string };
export type LegalProgress = { stage: string; done: number; total: number };
export const DEFAULT_LEGAL_OPTIONS: LegalOptions = { mode: "complete", sensitivity: "relevant", categories: Object.keys(LEGAL_CATEGORIES) as LegalCategory[], ocr: false };
export function validateLegalOptions(options: LegalOptions) {
  if (!["text", "visual", "structure", "complete"].includes(options.mode) || !["relevant", "all"].includes(options.sensitivity) || !Array.isArray(options.categories) || !options.categories.length || options.categories.some(key => !(key in LEGAL_CATEGORIES)) || typeof options.ocr !== "boolean") throw Error("Selecione um modo e categorias de análise válidos.");
}
export function evidenceFor(document: LegalDocument, block: LegalBlock): LegalEvidence { return { documentId: document.id, page: block.page, blockId: block.id, quote: block.text, box: block.box }; }
export function legalEvidenceValid(evidence: LegalEvidence, documents: LegalDocument[]) {
  const page = documents.find(document => document.id === evidence.documentId)?.pages.find(page => page.number === evidence.page);
  if (!page || !evidence.box.every(Number.isFinite)) return false;
  if (!evidence.blockId) return evidence.quote === "" && evidence.box[0] >= 0 && evidence.box[1] >= 0 && evidence.box[2] <= page.width + 1 && evidence.box[3] <= page.height + 1;
  const block = page.blocks.find(block => block.id === evidence.blockId);
  return !!block && block.text === evidence.quote && block.box.every((value, index) => value === evidence.box[index]);
}
