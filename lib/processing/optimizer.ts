import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { commandExists, execFile } from "./system";
import { withNativeJob } from "./native-job";

/** Structural compression without resampling images. Keep original on any uncertainty. */
export async function optimizePdf(input:Uint8Array):Promise<Uint8Array>{
  const executable=process.env.PDF_OPTIMIZER||"qpdf";
  const python=process.env.PDF_TO_WORD_PYTHON||(process.platform==="win32"?"python":"python3");
  if(input.byteLength>64*1024*1024||!(await commandExists(python)))return input;
  try{return await withNativeJob(input,"pdf",async({directory,inputPath})=>{
    const deadline=Date.now()+110000,candidates:{file:string;size:number}[]=[];
    const options=()=>({timeout:Math.max(1,Math.min(30000,deadline-Date.now())),windowsHide:true,maxBuffer:1024*1024,env:{...process.env,OMP_NUM_THREADS:"1",OPENBLAS_NUM_THREADS:"1"}});
    async function collect(file:string){const info=await lstat(file);if(info.isFile()&&info.size>0&&info.size<input.length)candidates.push({file,size:info.size});}
    if(await commandExists(executable)){
      const file=path.join(directory,"qpdf.pdf");
      try{await execFile(executable,["--object-streams=generate","--stream-data=compress","--recompress-flate","--compression-level=9",inputPath,file],options());await collect(file);}catch{/* Try the independent deduplicator. */}
    }
    if(deadline-Date.now()>10000){
      const file=path.join(directory,"deduplicated.pdf");
      try{await execFile(python,[path.join(process.cwd(),"scripts/pdf-optimize.py"),inputPath,file],options());await collect(file);}catch{/* A skipped rich PDF remains eligible for qpdf validation. */}
    }
    for(const candidate of candidates.sort((a,b)=>a.size-b.size)){
      if(deadline-Date.now()<5000)break;
      try{
        const {stdout}=await execFile(python,[path.join(process.cwd(),"scripts/pdf-preservation.py"),inputPath,candidate.file],{...options(),timeout:Math.min(40000,deadline-Date.now())});
        if(JSON.parse(stdout).preserved===true)return new Uint8Array(await readFile(candidate.file));
      }catch{/* Never deliver an unverified reduction. */}
    }
    return input;
  });}catch{return input;}
}
