import type { LegalEvidence } from "./types";
/** Optional semantic boundary; ai-service handles excerpt review with consent and quotas. */
export interface LegalSemanticReviewAdapter {
  review(evidence: {before:LegalEvidence;after:LegalEvidence}[],signal:AbortSignal):Promise<{pair:number;suggestion:string;sourceIds:string[]}[]>;
}
