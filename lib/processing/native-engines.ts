import { access, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { commandExists, execFile } from "./system";
import { withNativeJob } from "./native-job";
export type NativePdfInfo={pages:{number:number;width:number;height:number;text:string;needsOcr:boolean;rotation:number}[];rich:boolean};
export const ENGINE_LIMITS={bytes:25*1024*1024,pages:60,ocrPages:30,output:64*1024*1024,renderBytes:32*1024*1024,pixels:4000000} as const;
export function engineEnvironment(directory:string):NodeJS.ProcessEnv{const env:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV};for(const key of ["PATH","Path","SYSTEMROOT","SystemRoot","WINDIR","COMSPEC","PATHEXT","USERPROFILE","LOCALAPPDATA","APPDATA","PROGRAMFILES","ProgramFiles","PROGRAMFILES(X86)","HOME","LANG","FONTCONFIG_PATH","TESSDATA_PREFIX"])if(process.env[key])env[key]=process.env[key];return {...env,TEMP:directory,TMP:directory,TMPDIR:directory,OMP_THREAD_LIMIT:"1",OMP_NUM_THREADS:"1",OPENBLAS_NUM_THREADS:"1"};}
export function enginesPython(){return process.env.PDF_ENGINES_PYTHON?.trim()||"";}
export async function hasPdfium(){return !!enginesPython()&&await commandExists(enginesPython());}
export async function hasPdfbox(){const jar=process.env.PDFBOX_JAR?.trim();if(!jar||!await commandExists(process.env.PDFBOX_JAVA||"java"))return false;try{await access(jar);return true;}catch{return false;}}
export async function enginePython(args:string[],directory:string,timeout=30000){if(!await hasPdfium())throw Error("Motor PDF complementar não configurado.");return execFile(enginesPython(),[path.join(process.cwd(),"scripts/native-pdf-engine.py"),...args],{timeout,windowsHide:true,maxBuffer:2*1024*1024,env:engineEnvironment(directory)});}
export async function inspectNativePdf(inputPath:string,directory:string):Promise<NativePdfInfo>{const {stdout}=await enginePython(["inspect",inputPath],directory);const info=JSON.parse(stdout);if(!Array.isArray(info.pages)||!info.pages.length||info.pages.length>ENGINE_LIMITS.pages||typeof info.rich!=="boolean")throw Error("Não foi possível conferir a estrutura do PDF.");return info;}
export async function checkNativeOcr(inputPath:string,outputPath:string,directory:string,timeout=30000){const {stdout}=await enginePython(["check-ocr",inputPath,outputPath],directory,timeout);return JSON.parse(stdout).valid===true;}
export async function pdfbox(args:string[],directory:string,timeout=30000){if(!await hasPdfbox())throw Error("PDFBox não configurado.");return execFile(process.env.PDFBOX_JAVA||"java",["-Xmx128m","-XX:ActiveProcessorCount=1","-Djava.awt.headless=true",`-Djava.io.tmpdir=${directory}`,"-jar",process.env.PDFBOX_JAR!,...args],{timeout,windowsHide:true,maxBuffer:1024*1024,env:engineEnvironment(directory)});}
export async function boundedFile(file:string,max=ENGINE_LIMITS.output){const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>max)throw Error("Saída do motor inválida ou acima do limite.");return new Uint8Array(await readFile(file));}
export function validateEngineInput(input:Uint8Array){if(!input.length||input.length>ENGINE_LIMITS.bytes||!new TextDecoder("ascii").decode(input.subarray(0,5)).startsWith("%PDF-"))throw Error("Envie um PDF válido de até 25 MB.");}
export async function nativeExtractText(input:Uint8Array){validateEngineInput(input);return withNativeJob(input,"pdf",async({directory,inputPath})=>{
  const configured=process.env.PDF_TEXT_ENGINE||"auto";if(!["auto","poppler","pdfbox","pdfium"].includes(configured))throw Error("Motor de texto inválido no servidor.");
  if(await hasPdfium())await inspectNativePdf(inputPath,directory);
  const engines=configured==="auto"?["poppler","pdfbox","pdfium"]:[configured,...["poppler","pdfbox","pdfium"].filter(e=>e!==configured)];
  for(const engine of engines){const output=path.join(directory,`${engine}.txt`);try{if(engine==="poppler"){const exe=process.env.PDF_TEXT_EXTRACTOR||"pdftotext";if(!await commandExists(exe))continue;await execFile(exe,["-layout","-enc","UTF-8",inputPath,output],{timeout:30000,windowsHide:true,maxBuffer:1024*1024,env:engineEnvironment(directory)});}else if(engine==="pdfbox"){if(!await hasPdfbox())continue;await pdfbox(["export:text","-encoding=UTF-8","-sort",`-i=${inputPath}`,`-o=${output}`],directory);}else{if(!await hasPdfium())continue;await enginePython(["text",inputPath,output],directory);}const text=await boundedFile(output,2*1024*1024);if(new TextDecoder().decode(text).trim())return text;}catch{/* Independent fallback; no content or subprocess error is logged. */}}
  throw Error("Não foi possível extrair texto utilizável. Confira o PDF ou utilize OCR para digitalizações.");
});}
export async function renderEnginePages(inputPath:string,directory:string,start:number,end:number,dpi=144){
  const input=await PDFDocument.load(await readFile(inputPath));const total=input.getPageCount();if(total>ENGINE_LIMITS.pages||!Number.isInteger(start)||!Number.isInteger(end)||start<1||start>(end||total)||(end||total)>total)throw Error("Intervalo inválido ou limite de 60 páginas excedido.");
  if(await hasPdfium())await inspectNativePdf(inputPath,directory);
  const preferred=process.env.PDF_RASTERIZER||"auto";if(!["auto","poppler","pdfium","pdfbox"].includes(preferred))throw Error("Renderizador inválido no servidor.");
  const order=preferred==="auto"?["poppler","pdfium","pdfbox"]:[preferred,...["poppler","pdfium","pdfbox"].filter(e=>e!==preferred)];
  for(const engine of order){const folder=path.join(directory,engine);await mkdir(folder,{recursive:true});try{
    if(engine==="pdfium"){if(!await hasPdfium())continue;await enginePython(["render",inputPath,folder,"--start",String(start),"--end",String(end||total),"--dpi",String(dpi)],directory,90000);}
    else if(engine==="poppler"){const exe=process.env.PDF_RENDERER||"pdftoppm";if(!await commandExists(exe))continue;await execFile(exe,["-png","-r",String(dpi),"-scale-to","2000","-f",String(start),"-l",String(end||total),inputPath,path.join(folder,"pagina")],{timeout:90000,windowsHide:true,maxBuffer:1024*1024,env:engineEnvironment(directory)});}
    else{if(!await hasPdfbox())continue;await pdfbox(["render",`-i=${inputPath}`,`-prefix=${path.join(folder,"pagina")}`,"-format=png",`-dpi=${dpi}`,`-startPage=${start}`,`-endPage=${end||total}`],directory,90000);}
    const names=(await readdir(folder)).filter(n=>/^pagina-?\d+\.png$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));if(names.length!==(end||total)-start+1)throw Error("Renderização parcial.");let bytes=0;
    const isolatedValidation=await hasPdfium();
    for(const name of names){const image=await boundedFile(path.join(folder,name),ENGINE_LIMITS.renderBytes);bytes+=image.byteLength;if(bytes>ENGINE_LIMITS.renderBytes)throw Error("Imagens excedem o orçamento.");if(image.length<24||Buffer.from(image.subarray(0,8)).toString("hex")!=="89504e470d0a1a0a")throw Error("Imagem inválida.");const b=Buffer.from(image);if(b.readUInt32BE(16)*b.readUInt32BE(20)>ENGINE_LIMITS.pixels)throw Error("Imagem excede orçamento de pixels.");if(!isolatedValidation)PNG.sync.read(b);}
    if(isolatedValidation){const {stdout}=await enginePython(["check-images",folder],directory);const checked=JSON.parse(stdout);if(checked.valid!==true||checked.count!==names.length)throw Error("Imagens incompletas ou inválidas.");}
    return {directory:folder,names,engine};
  }catch{/* A partial engine output never reaches the ZIP. */}}
  throw Error("Nenhum renderizador concluiu as páginas dentro dos limites seguros.");
}
