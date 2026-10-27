export const ANALYSIS_MODES={general:"Análise geral",values:"Valores e datas",identities:"Nomes e identificadores",clauses:"Cláusulas e obrigações",missing:"Campos ausentes",custom:"Análise personalizada"} as const;
export type AnalysisMode=keyof typeof ANALYSIS_MODES;
export type Category="value"|"date"|"name"|"identifier"|"clause"|"missing"|"text";
export const CATEGORY_LABELS:Record<Category,string>={value:"Valor / percentual",date:"Data / prazo",name:"Nome",identifier:"Identificador",clause:"Cláusula / obrigação",missing:"Campo não localizado",text:"Texto"};
export type Classification="objective"|"possible"|"missing"|"inconclusive"|"textual";
export const CLASS_LABELS:Record<Classification,string>={objective:"Diferença objetiva",possible:"Possível divergência",missing:"Informação ausente",inconclusive:"Inconclusivo",textual:"Diferença textual"};
export type ReviewStatus="pending"|"confirmed"|"legitimate"|"later";
export const REVIEW_LABELS:Record<ReviewStatus,string>={pending:"Pendente de revisão",confirmed:"Confirmado pelo usuário",legitimate:"Diferença legítima",later:"Necessita de análise adicional"};
export type SourceLine={id:string;text:string;box:[number,number,number,number]};
export type SourcePage={number:number;width:number;height:number;needsOcr:boolean;lines:SourceLine[]};
export type SourceDocument={id:string;name:string;size:number;sha256:string;pages:SourcePage[];complete:boolean;warnings:string[];duplicateOf?:string};
export type AnalysisOptions={modes:AnalysisMode[];custom:string;useAi:boolean};
export type Evidence={documentId:string;documentName:string;page:number;lineId:string;quote:string;value:string;box:SourceLine["box"]};
export type Finding={id:string;category:Category;classification:Classification;title:string;explanation:string;confidence:"high"|"medium"|"low";documents:string[];evidence:Evidence[];missingDocumentId?:string;origin:"rules"|"ai"};
export type Review={status:ReviewStatus;note:string};
export type LocalAiReview={model:string;revision:string;createdAt:string;items:{findingId:string;similarity:number}[]};
export type AnalysisResult={version:1;id:string;createdAt:string;expiresAt:string;options:AnalysisOptions;documents:SourceDocument[];findings:Finding[];warnings:string[];ai:{status:"disabled"|"not_configured"|"used"|"unavailable";considered:number};truncated:boolean};
export const ANALYSIS_LIMITS={maxFiles:5,maxFileBytes:10*1024*1024,maxTotalBytes:25*1024*1024,maxPagesPerFile:20,maxTotalPages:60,maxCharsPerFile:100000,maxLinesPerFile:2000,maxFindings:200};

export function evidenceAt(document:SourceDocument,page:SourcePage,line:SourceLine,value=line.text):Evidence{
  return {documentId:document.id,documentName:document.name,page:page.number,lineId:line.id,quote:line.text,value,box:line.box};
}
export function evidenceIsValid(evidence:Evidence,documents:SourceDocument[]):boolean{
  const document=documents.find(item=>item.id===evidence.documentId);
  const page=document?.pages.find(item=>item.number===evidence.page);
  const line=page?.lines.find(item=>item.id===evidence.lineId);
  return Boolean(document&&line&&document.name===evidence.documentName&&line.text===evidence.quote&&line.text.includes(evidence.value)&&line.box.every((value,index)=>value===evidence.box[index]));
}
