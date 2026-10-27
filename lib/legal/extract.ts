import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";
import type Tesseract from "tesseract.js";
import { blocksFromLines } from "./structure";
import { LEGAL_LIMITS, type LegalDocument, type LegalLine, type LegalPage, type LegalProgress } from "./types";
import { loadLegalPdf } from "./pdf";

export function validateLegalFiles(files: {name:string;size:number;type:string}[]) {
  if (files.length<2 || files.length>LEGAL_LIMITS.files) throw Error("Envie de 2 a 4 PDFs, na ordem das versões.");
  if (files.reduce((sum,file)=>sum+file.size,0)>LEGAL_LIMITS.totalBytes) throw Error("O conjunto aceita até 12 MB.");
  for (const file of files) if (!/\.pdf$/i.test(file.name) || file.size<5 || file.size>LEGAL_LIMITS.fileBytes || (file.type && file.type!=="application/pdf")) throw Error("Cada versão deve ser um PDF não vazio de até 5 MB.");
}
function canvas(width:number,height:number) { const element=document.createElement("canvas");element.width=Math.max(1,Math.ceil(width));element.height=Math.max(1,Math.ceil(height));return element; }
async function render(page: PDFPageProxy, scale: number, signal: AbortSignal) {
  signal.throwIfAborted(); const viewport=page.getViewport({scale});
  if (!Number.isFinite(viewport.width*viewport.height) || viewport.width*viewport.height>LEGAL_LIMITS.pixels+10000) throw Error("A página excede os limites de renderização local.");
  const element=canvas(viewport.width,viewport.height), context=element.getContext("2d",{willReadFrequently:true})!;
  const task=page.render({canvas:element,canvasContext:context,viewport,annotationMode:1});
  const cancel=()=>task.cancel();signal.addEventListener("abort",cancel,{once:true});
  try {await task.promise;signal.throwIfAborted();return element;} finally {signal.removeEventListener("abort",cancel);}
}
export function linesFromText(items: TextItem[], width: number, height: number, viewportTransform: number[], transform: (one:number[],two:number[])=>number[]): LegalLine[] {
  if(items.length>12000)throw Error("A pagina excedeu o limite de elementos de texto.");
  const lines:LegalLine[]=[];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const tx=transform(viewportTransform,item.transform), size=Math.max(1,Math.hypot(tx[2],tx[3]));
    if(!tx.every(Number.isFinite)||!Number.isFinite(item.width)||tx[4]>=width||tx[4]+Math.abs(item.width)<=0||tx[5]<=0||tx[5]-size>=height)continue;
    const box:[number,number,number,number]=[Math.max(0,tx[4]),Math.max(0,tx[5]-size),Math.min(width,tx[4]+Math.abs(item.width)),Math.min(height,tx[5]+Math.max(1,size*.2))];
    const existing=lines.find(line=>Math.abs(line.box[1]-box[1])<Math.max(2,size*.3));
    if(existing) {const gap=box[0]-existing.box[2];existing.text+=(gap>size*1.8?"\t":gap>size*.12?" ":"")+item.str;existing.table=existing.table||gap>size*3;existing.box=[Math.min(existing.box[0],box[0]),Math.min(existing.box[1],box[1]),Math.max(existing.box[2],box[2]),Math.max(existing.box[3],box[3])];}
    else lines.push({text:item.str,box});
  }
  return lines.sort((a,b)=>a.box[1]-b.box[1]||a.box[0]-b.box[0]);
}
export class LocalOCRProcessor {
  private worker: Tesseract.Worker|null=null;
  private generation=0;
  used=0;
  async recognize(image:HTMLCanvasElement, width:number,height:number,signal:AbortSignal,progress:(message:LegalProgress)=>void):Promise<{lines:LegalLine[];confidence:number}> {
    if(this.used>=LEGAL_LIMITS.ocrPages) throw Error("Limite de cinco páginas OCR por análise atingido.");
    this.used++; signal.throwIfAborted();
    if(!this.worker){const generation=this.generation;const {createWorker}=await import("tesseract.js");signal.throwIfAborted();const created=createWorker("por+eng",1,{workerPath:"/legal-assets/ocr/worker.min.js",corePath:"/legal-assets/ocr/core/",langPath:"/legal-assets/ocr/lang",gzip:false,cacheMethod:"none",workerBlobURL:false,logger:message=>progress({stage:message.status==="recognizing text"?"Reconhecendo texto no navegador":"Carregando OCR local",done:Math.round(message.progress*100),total:100})});this.worker=await new Promise<Tesseract.Worker>((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});created.then(worker=>{signal.removeEventListener("abort",abort);if(signal.aborted||generation!==this.generation){void worker.terminate();reject(signal.reason||Error("OCR cancelado."));}else resolve(worker);},error=>{signal.removeEventListener("abort",abort);reject(error);});});}
    const abort=()=>{void this.close();};signal.addEventListener("abort",abort,{once:true});
    try {
      const {data}=await this.worker.recognize(image,{}, {text:true,blocks:true});signal.throwIfAborted();
      const lines:LegalLine[]=(data.blocks||[]).flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.map(line=>({text:line.text.trim(),box:[line.bbox.x0/image.width*width,line.bbox.y0/image.height*height,line.bbox.x1/image.width*width,line.bbox.y1/image.height*height] as [number,number,number,number]}))));
      return {lines,confidence:data.confidence};
    } finally {signal.removeEventListener("abort",abort);}
  }
  async close(){this.generation++;const worker=this.worker;this.worker=null;if(worker)await worker.terminate().catch(()=>{});}
}
export async function extractLegalDocument(file:File,id:string,ocrEnabled:boolean,ocr:LocalOCRProcessor,signal:AbortSignal,progress:(message:LegalProgress)=>void):Promise<LegalDocument> {
  const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();
  if(new TextDecoder("ascii").decode(bytes.slice(0,5))!=="%PDF-") throw Error(`${file.name}: conteúdo não reconhecido como PDF.`);
  const sha256=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");
  const {task,document:pdf}=await loadLegalPdf(bytes,signal);const cancel=()=>{void task.destroy();};signal.addEventListener("abort",cancel,{once:true});
  const pages:LegalPage[]=[],warnings:string[]=[];let characters=0,blocks=0;
  try {
    if(pdf.numPages<1||pdf.numPages>LEGAL_LIMITS.pagesPerFile)throw Error(`${file.name}: limite de 30 páginas por versão.`);
    const {Util,OPS}=await import("pdfjs-dist");
    for(let number=1;number<=pdf.numPages;number++){
      signal.throwIfAborted();progress({stage:`Lendo ${file.name} · página ${number}/${pdf.numPages}`,done:number-1,total:pdf.numPages});
      const page=await pdf.getPage(number),viewport=page.getViewport({scale:1});
      if(!Number.isFinite(viewport.width*viewport.height)||viewport.width<=0||viewport.height<=0||viewport.width>20000||viewport.height>20000)throw Error("Dimensões de página não suportadas.");
      const content=await page.getTextContent();let lines=linesFromText(content.items.filter((item):item is TextItem=>"str"in item),viewport.width,viewport.height,viewport.transform,Util.transform);
      const small=await render(page,Math.min(1,96/viewport.width,136/viewport.height),signal);const sample=canvas(96,136),ctx=sample.getContext("2d",{willReadFrequently:true})!;ctx.drawImage(small,0,0,96,136);const rgba=ctx.getImageData(0,0,96,136).data;
      const signature=Uint8Array.from({length:96*136},(_,index)=>Math.round(rgba[index*4]*.299+rgba[index*4+1]*.587+rgba[index*4+2]*.114));
      small.width=small.height=1;sample.width=sample.height=1;
      const textLength=lines.reduce((sum,line)=>sum+line.text.length,0);const ink=signature.some(value=>value<200);
      let recognized=false,confidence:number|undefined,warning:string|undefined,readable=true;
      const operators=textLength<300&&ink?await page.getOperatorList():null;
      const image=operators?.fnArray.some(op=>[OPS.paintImageXObject,OPS.paintImageMaskXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat].includes(op));
      if((textLength<5&&ink)||(image&&textLength<300)){
        readable=false;
        if(ocrEnabled&&ocr.used<LEGAL_LIMITS.ocrPages){
          let imageCanvas:HTMLCanvasElement|null=null;
          try{imageCanvas=await render(page,Math.min(2,Math.sqrt(LEGAL_LIMITS.pixels/(viewport.width*viewport.height))*.99),signal);const result=await ocr.recognize(imageCanvas,viewport.width,viewport.height,signal,progress);if(result.lines.some(line=>line.text)){lines=result.lines;recognized=true;confidence=result.confidence;readable=true;warning=`OCR utilizado; confiança média ${Math.round(confidence)}%. Revise o texto reconhecido${confidence<70?"; baixa confiança":""}.`;}}
          catch{signal.throwIfAborted();warning="OCR não concluído. A comparação textual desta página é parcial ou indisponível.";}
          finally{if(imageCanvas)imageCanvas.width=imageCanvas.height=1;}
        }else warning=ocrEnabled?"Página sem texto analisável: limite de cinco páginas OCR atingido.":"Página digitalizada ou sem texto analisável. Ative OCR local para tentar reconhecê-la.";
        if(!recognized&&!warning)warning="O OCR não reconheceu texto nesta página.";
      }
      if(textLength<5&&!ink){readable=false;warning="Página sem texto ou representação visual analisável. Pode estar vazia ou conter elementos não suportados; não foi comprovada igualdade de conteúdo.";}
      const extracted=blocksFromLines(lines,number,recognized,confidence);characters+=extracted.reduce((sum,block)=>sum+block.text.length,0);blocks+=extracted.length;
      if(characters>LEGAL_LIMITS.charactersPerFile||blocks>LEGAL_LIMITS.blocksPerFile)throw Error(`${file.name}: limite de texto ou blocos excedido. Use um documento menor.`);
      pages.push({number,width:viewport.width,height:viewport.height,blocks:extracted,readable,ocr:recognized,confidence,signature,warning});
      if(warning)warnings.push(`${file.name}, página ${number}: ${warning}`);page.cleanup();
      progress({stage:`Página ${number}/${pdf.numPages} extraída`,done:number,total:pdf.numPages});
    }
    const metadata:Record<string,string>={};
    try{const {info}=await pdf.getMetadata();for(const key of ["Title","Author","Creator","Producer","CreationDate","ModDate"]){const value=(info as Record<string,unknown>)[key];if(typeof value==="string"&&value.trim())metadata[key]=value.replace(/[\u0000-\u001f]/g," ").slice(0,500);}}catch{warnings.push("Metadados não disponíveis; a extração de páginas foi preservada.");}
    signal.throwIfAborted();
    return{id,name:file.name,sha256,bytes:file.size,pages,complete:pages.every(page=>page.readable),warnings,metadata};
  }catch(error){if(error instanceof Error&&error.name==="PasswordException")throw Error("PDF protegido por senha. Envie uma cópia desbloqueada autorizada.");throw error;}
  finally{signal.removeEventListener("abort",cancel);await task.destroy();}
}
