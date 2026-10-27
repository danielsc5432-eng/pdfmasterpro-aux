import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { extractDocument } from "./extract";
import { compareDocuments, fieldsOf } from "./compare";
import { semanticReview } from "./ai";
import { normalized } from "./normalize";
import { ANALYSIS_LIMITS, evidenceIsValid, type AnalysisResult, type AnalysisOptions, type SourceDocument } from "./types";

export const analysisOptionsSchema=z.object({modes:z.array(z.enum(["general","values","identities","clauses","missing","custom"])).min(1).max(6),custom:z.string().max(600).default(""),useAi:z.boolean().default(false)}).strict().refine(value=>!value.modes.includes("custom")||value.custom.trim().length>=3,{message:"Descreva o que deseja verificar na análise personalizada."});
export function validateAnalysisFiles(files:{name:string;size:number}[]){
  if(files.length<2||files.length>ANALYSIS_LIMITS.maxFiles)throw new Error("A análise requer de 2 a 5 PDFs.");
  if(files.some(file=>!file.name.toLowerCase().endsWith(".pdf")||file.size===0||file.size>ANALYSIS_LIMITS.maxFileBytes))throw new Error("O limite desta análise é de 10 MB por PDF, sem arquivos vazios.");
  if(files.reduce((sum,file)=>sum+file.size,0)>ANALYSIS_LIMITS.maxTotalBytes)throw new Error("O total dos PDFs deve ser de até 25 MB nesta análise.");
}
export function markDuplicateDocuments(documents:SourceDocument[]){
  const hashes=new Map<string,string>(),contents=new Map<string,string>();
  for(const document of documents){
    const text=normalized(document.pages.flatMap(page=>page.lines).map(line=>line.text).join("\n"));
    const content=createHash("sha256").update(text).digest("hex");
    const duplicate=hashes.get(document.sha256)||(document.complete&&text?contents.get(content):undefined);
    if(duplicate){document.duplicateOf=duplicate;document.warnings.push("Documento duplicado ou com texto equivalente ao de outra fonte. Não foi contado como divergência.");}
    else{hashes.set(document.sha256,document.id);if(document.complete&&text)contents.set(content,document.id);}
  }
}
export async function analyzeFiles(files:{name:string;bytes:Uint8Array}[],options:AnalysisOptions,requestSignal?:AbortSignal):Promise<AnalysisResult>{
  validateAnalysisFiles(files.map(file=>({name:file.name,size:file.bytes.length})));
  const parsed=analysisOptionsSchema.parse(options);
  const signal=requestSignal?AbortSignal.any([requestSignal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
  const documents:SourceDocument[]=[];let pages=0;
  for(const [index,file]of files.entries()){
    signal.throwIfAborted();
    const document=await extractDocument(file.bytes,file.name,index,signal);pages+=document.pages.length;
    if(pages>ANALYSIS_LIMITS.maxTotalPages)throw new Error("O conjunto deve ter até 60 páginas nesta análise.");
    documents.push(document);
  }
  markDuplicateDocuments(documents);
  const comparison=compareDocuments(documents,parsed);
  const warnings=[...comparison.warnings];
  if(documents.some(document=>!document.complete))warnings.push("A análise é parcial: páginas sem texto verificável não permitem concluir ausência ou equivalência de informações.");
  if(!documents.some(document=>fieldsOf(document).length))warnings.push("Não foram localizados campos ou cláusulas comparáveis pelos padrões desta versão. O resultado é inconclusivo, não uma confirmação de equivalência.");
  const semantic=await semanticReview(comparison.findings,parsed.useAi,signal);
  signal.throwIfAborted();
  if(semantic.warning)warnings.push(semantic.warning);
  for(const finding of semantic.findings)if(!finding.evidence.length||!finding.evidence.every(item=>evidenceIsValid(item,documents)))throw new Error("A conferência das evidências não pôde ser concluída.");
  const minutes=Math.max(1,Math.min(120,Number(process.env.DIVERGENCE_RETENTION_MINUTES)||60));
  return {version:1,id:randomUUID(),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+minutes*60000).toISOString(),options:parsed,documents,findings:semantic.findings,warnings:[...new Set(warnings)],ai:semantic.ai,truncated:comparison.truncated};
}
