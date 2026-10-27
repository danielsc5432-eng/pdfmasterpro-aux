import path from "node:path";
import { withNativeJob } from "./native-job";
import { boundedFile, checkNativeOcr, engineEnvironment, enginesPython, hasPdfium, inspectNativePdf, validateEngineInput, type NativePdfInfo } from "./native-engines";
import { execFile } from "./system";
export function ocrEngineArguments(info:NativePdfInfo,language:string,input:string,output:string){
  if(!["por","eng","por+eng"].includes(language))throw Error("Idioma OCR inválido.");
  const rotated=info.pages.some(p=>p.needsOcr&&p.rotation!==0);
  return ["-m","ocrmypdf","--mode","skip","--output-type","pdf","--optimize","0","--jobs","1","--oversample","300","--max-image-mpixels","12","--tesseract-timeout","40","--tesseract-non-ocr-timeout","20","--rasterizer",rotated?"ghostscript":"pypdfium","-l",language,...(rotated?["--rotate-pages","--rotate-pages-threshold","5"]:[]),input,output];
}
/** A code-zero OCR is not accepted without page/text/visual checks. The original is never overwritten. */
export async function smartOcrPdf(input:Uint8Array,language:string,legacy:(bytes:Uint8Array,language:string,info?:NativePdfInfo,deadline?:number)=>Promise<Uint8Array>){
  validateEngineInput(input);if(!["por","eng","por+eng"].includes(language))throw Error("Idioma OCR inválido.");
  const backend=process.env.PDF_OCR_BACKEND||"auto";if(!["auto","ocrmypdf","legacy"].includes(backend))throw Error("Motor OCR inválido no servidor.");
  return withNativeJob(input,"pdf",async({directory,inputPath})=>{
    if(!await hasPdfium()){if(backend==="ocrmypdf")throw Error("OCRmyPDF não está configurado no servidor.");return legacy(input,language);}
    const deadline=Date.now()+200000,info=await inspectNativePdf(inputPath,directory);
    if(info.pages.length>30)throw Error("O OCR aceita até 30 páginas por tarefa. Divida o documento.");
    if(!info.pages.some(p=>p.needsOcr))return input;
    if(info.rich)throw Error("Este PDF contém formulários, assinaturas ou anotações. Para preservar esses elementos, envie uma cópia simples autorizada para OCR.");
    const file=path.join(directory,"ocr.pdf");
    if(backend!=="legacy")try{
      await execFile(enginesPython(),ocrEngineArguments(info,language,inputPath,file),{timeout:130000,windowsHide:true,maxBuffer:1024*1024,env:engineEnvironment(directory)});
      const output=await boundedFile(file);if(await checkNativeOcr(inputPath,file,directory,Math.min(30000,deadline-Date.now())))return output;
    }catch{/* Failed, empty or visually changed OCR candidates do not replace the original. */}
    if(deadline-Date.now()<40000)throw Error("Não houve tempo para concluir um OCR conferido. Tente um documento menor.");
    const output=await legacy(input,language,info,deadline);const {writeFile}=await import("node:fs/promises");const fallback=path.join(directory,"fallback.pdf");await writeFile(fallback,output);
    if(await checkNativeOcr(inputPath,fallback,directory,Math.max(1,Math.min(30000,deadline-Date.now()))))return output;
    throw Error("O OCR não produziu texto utilizável com preservação suficiente das páginas. Nenhum resultado incompleto foi entregue.");
  });
}
