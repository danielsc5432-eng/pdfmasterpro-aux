import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let active=false;
/** One native CLI job at a time in this process; no filenames come from uploads. */
export async function withNativeJob<T>(input:Uint8Array,extension:"pdf"|"doc"|"docx",run:(job:{directory:string;inputPath:string})=>Promise<T>):Promise<T>{
  if(active)throw new Error("O motor de documentos está ocupado. Tente novamente em instantes.");
  active=true;
  let directory:string|undefined;
  try{
    directory=await mkdtemp(path.join(os.tmpdir(),"pdfmaster-native-"));
    const inputPath=path.join(directory,`input.${extension}`);
    await writeFile(inputPath,input);
    return await run({directory,inputPath});
  }finally{
    try{if(directory)await rm(directory,{recursive:true,force:true});}
    finally{active=false;}
  }
}
