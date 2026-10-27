import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { optimizePdf } from "../lib/processing/optimizer";
import { execFile } from "../lib/processing/system";

async function main(){
  const directory=path.resolve(".vercel/optimizer-regression");await mkdir(directory,{recursive:true});
  const python=process.env.PDF_TO_WORD_PYTHON||(process.platform==="win32"?"python":"python3");
  await execFile(python,["scripts/generate-pdf-regression.py",directory],{timeout:30000,windowsHide:true});
  const source=path.join(directory,"staggered-columns.pdf"),output=path.join(directory,"optimized.pdf");
  const input=new Uint8Array(await readFile(source)),result=await optimizePdf(input);
  assert.ok(result.length<input.length,"A compressible fixture must actually become smaller");
  await writeFile(output,result);
  const {stdout}=await execFile(python,["scripts/pdf-preservation.py",source,output],{timeout:60000,windowsHide:true});
  assert.equal(JSON.parse(stdout).preserved,true);
  // A broken validator or executable must preserve bytes, not deliver unchecked changes.
  const old=process.env.PDF_TO_WORD_PYTHON;
  try{process.env.PDF_TO_WORD_PYTHON=path.join(directory,"missing-python");assert.deepEqual(await optimizePdf(input),input);}
  finally{if(old===undefined)delete process.env.PDF_TO_WORD_PYTHON;else process.env.PDF_TO_WORD_PYTHON=old;}
  const report={sourceBytes:input.length,outputBytes:result.length,reduction:1-result.length/input.length,preserved:true};
  await writeFile(path.join(directory,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  const cases=["signed-values","staggered-columns","mixed-sizes-blank","mixed-renderers","rotated-page","rotated-page-270","scanned-statement","searchable-scan","transparent-searchable-scan","skewed-low-contrast"];
  const corpus=[];
  for(const name of cases){
    const sourceFile=path.join(directory,name+".pdf"),target=path.join(directory,name+"-optimized.pdf");
    const original=new Uint8Array(await readFile(sourceFile)),optimized=await optimizePdf(original);
    assert.ok(optimized.length<=original.length,"Optimizer must not increase file size");
    const unchanged=Buffer.from(original).equals(Buffer.from(optimized));
    await writeFile(target,optimized);
    if(!unchanged){
      const {stdout:comparison}=await execFile(python,["scripts/pdf-preservation.py",sourceFile,target],{timeout:60000,windowsHide:true});
      assert.equal(JSON.parse(comparison).preserved,true,`Preservation failed: ${name}`);
    }
    corpus.push({name,sourceBytes:original.length,outputBytes:optimized.length,unchanged,preserved:true});
  }
  await writeFile(path.join(directory,"corpus.json"),JSON.stringify(corpus,null,2));
  console.log(JSON.stringify({optimizerCases:corpus.length,reduced:corpus.filter(row=>!row.unchanged).length,allPreserved:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
