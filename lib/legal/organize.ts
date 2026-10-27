import JSZip from "jszip";
import { uniqueOrganizedPaths, type LegalAnalysis } from "./analyze";
import { analysisText } from "./analysis-report";
export async function organizedArchive(result:LegalAnalysis,files:Map<string,{arrayBuffer:()=>Promise<ArrayBuffer>}>,paths:Record<string,string>,confirmed:boolean){
  if(result.tool!=="juris-organize"||!confirmed)throw Error("Revise e confirme os nomes e pastas antes de baixar.");
  const planned=uniqueOrganizedPaths(result.organized.map(o=>({documentId:o.documentId,path:paths[o.documentId]||o.path})));
  const zip=new JSZip();
  for(const entry of planned){const source=files.get(entry.documentId);if(!source)throw Error("Documento original não está mais na sessão.");const bytes=await source.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");if(hash!==result.documents.find(d=>d.id===entry.documentId)?.sha256)throw Error("Os bytes do documento não correspondem à análise. Analise novamente.");zip.file(entry.path,bytes);}
  zip.file("manifesto-organizacao.json",JSON.stringify({createdAt:result.createdAt,notice:"Cópias dos originais; nomes revisados, sem autenticação jurídica.",files:planned.map(e=>({...e,original:result.documents.find(d=>d.id===e.documentId)!.name,sha256:result.documents.find(d=>d.id===e.documentId)!.sha256}))},null,2));
  zip.file("relatorio.txt",analysisText({...result,organized:result.organized.map(o=>({...o,path:planned.find(p=>p.documentId===o.documentId)!.path}))}));
  return zip.generateAsync({type:"uint8array",compression:"STORE"});
}
