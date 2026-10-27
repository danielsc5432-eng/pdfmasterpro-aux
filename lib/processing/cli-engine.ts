import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { execFile } from "./system";
import { withNativeJob } from "./native-job";

export type CliOperation="pdf-to-word"|"word-to-pdf";
const prefixes={"pdf-to-word":"PDF_TO_WORD_CLI","word-to-pdf":"WORD_TO_PDF_CLI"};
export function configuredCli(operation:CliOperation){return Boolean(process.env[prefixes[operation]+"_EXECUTABLE"]);}
export function cliArguments(template:unknown,values:Record<string,string>):string[]{
  if(!Array.isArray(template)||template.length>64||!template.every(arg=>typeof arg==="string"&&arg.length<=16384))throw new Error("Invalid CLI argument template");
  const args=template as string[];
  if(!args.some(arg=>arg.includes("{input}"))||!args.some(arg=>arg.includes("{output}")||arg.includes("{directory}")))throw new Error("CLI input/output placeholders required");
  return args.map(arg=>arg.replace(/\{([A-Za-z]+)\}/g,(_,key:string)=>{if(!(key in values))throw new Error("Unknown CLI placeholder");return values[key];}));
}

/** Admin-configured executable + argv only. No shell, credentials or license emulation. */
export async function cliConvert(operation:CliOperation,input:Uint8Array,timeout=90000,originalName="input.docx"):Promise<Uint8Array>{
  const prefix=prefixes[operation],executable=process.env[prefix+"_EXECUTABLE"];
  if(!executable)throw new Error("CLI engine not configured");
  if(operation==="pdf-to-word"&&!new TextDecoder().decode(input.subarray(0,1024)).includes("%PDF-"))throw new Error("Invalid PDF input");
  if(operation==="word-to-pdf"&&!(input[0]===0x50&&input[1]===0x4b)&&!(input[0]===0xd0&&input[1]===0xcf))throw new Error("Invalid Word input");
  const template=JSON.parse(process.env[prefix+"_ARGS"]||"[]");
  const extension=operation==="pdf-to-word"?"pdf":originalName.toLowerCase().endsWith(".doc")?"doc":"docx";
  return withNativeJob(input,extension,async({directory,inputPath})=>{
    const outputPath=path.join(directory,operation==="pdf-to-word"?"output.docx":"input.pdf");
    const args=cliArguments(template,{input:inputPath,output:outputPath,directory,profileUri:pathToFileURL(path.join(directory,"profile")).href});
    await execFile(executable,args,{timeout:Math.min(120000,Math.max(1,timeout)),windowsHide:true,maxBuffer:1024*1024,env:{...process.env,OMP_NUM_THREADS:"1",OPENBLAS_NUM_THREADS:"1"}});
    const info=await lstat(outputPath);
    if(!info.isFile()||info.size===0||info.size>64*1024*1024)throw new Error("Invalid CLI output size or type");
    const output=new Uint8Array(await readFile(outputPath));
    if(operation==="pdf-to-word"){
      const zip=await JSZip.loadAsync(output),xml=await zip.file("word/document.xml")?.async("string");
      if(!xml||!/<w:t(?:\s[^>]*)?>[^<\s]/.test(xml))throw new Error("CLI produced no editable Word text");
    }else if((await PDFDocument.load(output)).getPageCount()<1)throw new Error("CLI produced an empty PDF");
    return output;
  });
}
