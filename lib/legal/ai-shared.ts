import { z } from "zod";
import { LEGAL_SUITE, type LegalSuiteSlug } from "./suite-config";
import type { LegalDocument, LegalEvidence } from "./types";
export type LegalAITool=LegalSuiteSlug|"pdf-timemachine-juridico";
export const LEGAL_AI_LIMITS={sources:8,characters:6000,sourceCharacters:750,bytes:32768,points:10,timeout:48000} as const;
export const legalAIRequestSchema=z.object({tool:z.enum(["pdf-timemachine-juridico",...LEGAL_SUITE.map(t=>t.slug)]),consent:z.literal(true),sources:z.array(z.object({id:z.string().regex(/^s[1-8]$/),page:z.number().int().min(1).max(30),text:z.string().trim().min(10).max(750)}).strict()).min(1).max(8)}).strict().superRefine((value,ctx)=>{if(new Set(value.sources.map(s=>s.id)).size!==value.sources.length||value.sources.reduce((n,s)=>n+s.text.length,0)>6000)ctx.addIssue({code:"custom",message:"Trechos duplicados ou limite de texto excedido."});});
export type LegalAISource={id:string;page:number;text:string;documentId:string;blockId:string};
export type LegalAIPoint={text:string;evidence:{sourceId:string;quote:string}[]};
export type LegalAIReviewResult={provider:string;model:string;calls:number;createdAt:string;points:LegalAIPoint[];sources:LegalAISource[];warnings:string[]};
export type LegalAICapabilities={available:boolean;authenticated:boolean;provider:string;privacyUrls:string[];notice:string;limits:typeof LEGAL_AI_LIMITS};
export const legalAIResponseSchema=z.object({provider:z.string().max(150),model:z.string().max(200),calls:z.number().int().min(1).max(2),createdAt:z.iso.datetime(),points:z.array(z.object({text:z.string().max(1200),evidence:z.array(z.object({sourceId:z.string().regex(/^s[1-8]$/),quote:z.string().max(650)}).strict()).min(1).max(3)}).strict()).max(10),warnings:z.array(z.string().max(600)).max(5)}).strict();
export function legalAISources(documents:LegalDocument[],preferred:LegalEvidence[]=[]):LegalAISource[]{
  const blocks=documents.flatMap(d=>d.pages.flatMap(p=>p.blocks.map(b=>({d,b}))));
  // Round-robin across documents prevents filling the budget solely with the first PDF.
  const groups=documents.map(d=>blocks.filter(v=>v.d.id===d.id));const balanced=Array.from({length:Math.max(0,...groups.map(g=>g.length))},(_,i)=>groups.flatMap(g=>g[i]?[g[i]]:[])).flat();
  const prioritized=preferred.flatMap(e=>blocks.filter(v=>v.d.id===e.documentId&&v.b.id===e.blockId));const seen=new Set<string>(),sources:LegalAISource[]=[];
  for(const {d,b}of [...prioritized,...balanced]){const key=d.id+":"+b.id;if(seen.has(key)||b.text.trim().length<10)continue;seen.add(key);let text=b.text.trim().slice(0,750);if(text.length<b.text.trim().length){const boundary=text.lastIndexOf(" ");if(boundary>500)text=text.slice(0,boundary);}sources.push({id:`s${sources.length+1}`,documentId:d.id,blockId:b.id,page:b.page,text});if(sources.length===8)break;}
  return sources;
}
export function legalAIReportText(review:LegalAIReviewResult|undefined,documents:LegalDocument[]){if(!review)return "";return ["REVISÃO OPCIONAL COM IA — SUGESTÕES, NÃO CONCLUSÕES",`Provedor: ${review.provider} | Modelo: ${review.model} | Chamadas: ${review.calls}`,`Data: ${review.createdAt}`,`Trechos considerados: ${review.sources.length}; não é análise integral do documento.`,...review.points.flatMap((p,index)=>[`${index+1}. ${p.text}`,...p.evidence.map(e=>{const s=review.sources.find(s=>s.id===e.sourceId)!;return `${documents.find(d=>d.id===s.documentId)?.name||"Documento"} | Página ${s.page}\n${e.quote}`;})]),...review.warnings].join("\n");}
export function legalAICsvRows(review:LegalAIReviewResult|undefined,documents:LegalDocument[]){return review?[["Revisão opcional com IA",review.provider,review.model,...review.warnings],["Tipo","Sugestão de IA","Documento citado","Página citada","Citação literal"],...review.points.flatMap(p=>p.evidence.map(e=>{const s=review.sources.find(s=>s.id===e.sourceId)!;return ["Sugestão de IA; conferir",p.text,documents.find(d=>d.id===s.documentId)?.name||"Documento",String(s.page),e.quote];}))]:[];}
