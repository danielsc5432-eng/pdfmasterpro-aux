import type { FidelityReport } from "./docx-fidelity";

type Options={deadline:number;verify(output:Uint8Array,budget:number):Promise<FidelityReport|null>;now?:()=>number};

/** Sequential retries bound memory use; failed or unverified attempts cannot win. */
export async function tryVerifiedConversion(convert:(budget:number)=>Promise<Uint8Array>,options:Options){
  const now=options.now??Date.now;
  const remaining=options.deadline-now();
  if(remaining<15000)return null;
  try{
    const output=await convert(Math.min(120000,Math.floor(remaining/2)));
    const budget=Math.min(60000,options.deadline-now());
    if(budget<5000)return null;
    const report=await options.verify(output,budget);
    return report?{output,report}:null;
  }catch{return null;}
}
