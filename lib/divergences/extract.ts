import { createHash } from "node:crypto";
import path from "node:path";
import { withNativeJob } from "../processing/native-job";
import { execFile } from "../processing/system";
import { extractionPdf } from "../processing/pdf-visible-text";
import { ANALYSIS_LIMITS, type SourceDocument, type SourcePage } from "./types";

export async function extractDocument(input:Uint8Array,name:string,index:number,signal?:AbortSignal):Promise<SourceDocument>{
  signal?.throwIfAborted();
  const raw=await withNativeJob(await extractionPdf(input),"pdf",async({inputPath})=>{
    const python=process.env.PDF_TO_WORD_PYTHON||(process.platform==="win32"?"python":"python3");
    const {stdout}=await execFile(python,[path.join(process.cwd(),"scripts/extract-divergences.py"),inputPath],{timeout:45000,signal,windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,OMP_NUM_THREADS:"1"}});
    return JSON.parse(stdout) as {error?:string;pages?:SourcePage[];truncated?:boolean};
  });
  if(raw.error==="protected")throw new Error("O PDF está protegido por senha. Envie uma cópia desbloqueada que você tenha autorização para analisar.");
  if(raw.error==="pages")throw new Error("O PDF deve ter entre 1 e 20 páginas para esta análise.");
  if(raw.error||!Array.isArray(raw.pages)||!raw.pages.length)throw new Error("O PDF está corrompido, incompleto ou não pôde ser lido.");
  const warnings:string[]=[];
  const ocr=raw.pages.filter(page=>page.needsOcr).map(page=>page.number);
  if(ocr.length)warnings.push(`OCR necessário ou texto não verificável nas páginas ${ocr.join(", ")}. Essas páginas não sustentam conclusões de ausência.`);
  if(raw.truncated)warnings.push("O texto excedeu o limite de extração; a análise deste documento é parcial.");
  const words=raw.pages.flatMap(page=>page.lines).map(line=>line.text).join(" ").split(/\s+/).filter(Boolean).length;
  if(words<4)warnings.push("Conteúdo textual insuficiente para uma comparação confiável.");
  if(raw.pages.length>ANALYSIS_LIMITS.maxPagesPerFile)throw new Error("O PDF excede o limite de páginas.");
  return {id:`doc-${index+1}`,name:name.replace(/[\u0000-\u001f\u007f]/g,"").slice(0,160)||`Documento ${index+1}`,size:input.length,sha256:createHash("sha256").update(input).digest("hex"),pages:raw.pages,complete:!ocr.length&&!raw.truncated&&words>=4,warnings};
}
