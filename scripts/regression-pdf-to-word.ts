import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { decodeEntities } from "../lib/processing/layout";
import { baselineFailures, knownOcrTruth } from "./conversion-baseline";
import { createPdfMasterSdk } from "../lib/pdf-sdk";
import { checkedPdfToDocx } from "../lib/processing/docx-auto";
import { betterFidelity, checkDocxFidelity, fidelityStatus, unsafeFidelity, type FidelityReport } from "../lib/processing/docx-fidelity";
import { execFile } from "../lib/processing/system";

// Pinned official public fixtures; downloaded only on an explicit --public run.
const upstream = [
  {name:"public-lattice.pdf",url:"https://raw.githubusercontent.com/ArtifexSoftware/pdf2docx/3e1c2319d6a3fbf2ae4d46c3ab734b7fc87bd9b4/test/samples/demo-table-lattice.pdf"},
  {name:"public-columns.pdf",url:"https://raw.githubusercontent.com/ArtifexSoftware/pdf2docx/3e1c2319d6a3fbf2ae4d46c3ab734b7fc87bd9b4/test/samples/demo-section.pdf"},
  {name:"public-image-overlap.pdf",url:"https://raw.githubusercontent.com/ArtifexSoftware/pdf2docx/3e1c2319d6a3fbf2ae4d46c3ab734b7fc87bd9b4/test/samples/demo-image-overlap.pdf"},
  {name:"public-annotations-rotated.pdf",url:"https://raw.githubusercontent.com/jsvine/pdfplumber/4c64b92d5caccd71c645e98e0fabb0c4dba7ff45/tests/pdfs/annotations-rotated-90.pdf"},
];

async function main() {
  const directory=path.resolve(".vercel/regression-pdf");
  await mkdir(directory,{recursive:true});
  const python=process.env.PDF_TO_WORD_PYTHON || (process.platform==="win32"?"python":"python3");
  await execFile(python,["scripts/generate-pdf-regression.py",directory],{timeout:30000,windowsHide:true});
  const names=["signed-values.pdf","staggered-columns.pdf","mixed-sizes-blank.pdf","mixed-renderers.pdf","rotated-page.pdf","rotated-page-270.pdf","scanned-statement.pdf","searchable-scan.pdf","transparent-searchable-scan.pdf","skewed-low-contrast.pdf"];
  const manifest:{name:string;sha256:string;url?:string}[]=[];
  if(process.argv.includes("--public"))for(const fixture of upstream){
    const response=await fetch(fixture.url,{signal:AbortSignal.timeout(30000),redirect:"error"});
    if(!response.ok)throw new Error(`Fixture download HTTP ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length>10*1024*1024||!new TextDecoder().decode(bytes.subarray(0,8)).startsWith("%PDF-"))throw new Error("Invalid upstream fixture");
    await writeFile(path.join(directory,fixture.name),bytes);names.push(fixture.name);
  }
  const results:unknown[]=[];
  const filter=process.argv.find(value=>value.startsWith("--case="))?.slice(7);
  const suffix=filter?"-"+filter.replace(/[^a-zA-Z0-9_-]/g,"_"):"";
  for(const name of names.filter(name=>!filter||name.includes(filter))){
    const input=await readFile(path.join(directory,name));
    manifest.push({name,sha256:createHash("sha256").update(input).digest("hex"),url:upstream.find(f=>f.name===name)?.url});
    const reports:FidelityReport[]=[];
    let candidateIndex=0;
    const started=Date.now();let record;
    try{
      const sdk=createPdfMasterSdk({verify:async(pdf,word,budget)=>{if(process.argv.includes("--keep-candidates"))await writeFile(path.join(directory,name+`.candidate-${candidateIndex++}.docx`),word);const measured=await checkDocxFidelity(pdf,word,budget);if(measured)reports.push(measured);return measured;}});
      const result=process.argv.includes("--automatic")?await checkedPdfToDocx(input,name):await sdk.convert(input,{name,signal:AbortSignal.timeout(300000)});
      await writeFile(path.join(directory,name+".docx"),result.output);
      const zip=await JSZip.loadAsync(result.output);
      const xml=await zip.file("word/document.xml")!.async("string");
      const editable=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match=>decodeEntities(match[1])).join(" ");
      record={name,outcome:result.status,engine:"engine"in result?result.engine:"automatic",report:result.report,audit:"audit"in result?result.audit:undefined,ocrGroundTruth:knownOcrTruth(name,editable)};
    }catch{
      let best:FidelityReport|undefined;
      for(const report of reports)if(!best||betterFidelity(report,best))best=report;
      record={name,outcome:"blocked",bestMeasured:best??null,measuredCandidates:reports.length,reason:best&&unsafeFidelity(best)?"measured-content-or-pagination-loss":"conversion-or-verification-failed",status:best?fidelityStatus(best):"unavailable"};
    }
    const entry={...record,milliseconds:Date.now()-started};results.push(entry);
    await writeFile(path.join(directory,`manifest${suffix}.json`),JSON.stringify(manifest,null,2));
    await writeFile(path.join(directory,`results${suffix}.json`),JSON.stringify(results,null,2));
    console.log(JSON.stringify(entry));
  }
  const outcomes=results as {outcome:string}[];
  const summary={cases:outcomes.length,checked:outcomes.filter(r=>r.outcome==="checked").length,review:outcomes.filter(r=>r.outcome==="review").length,blocked:outcomes.filter(r=>r.outcome==="blocked").length,allChecked:outcomes.length>0&&outcomes.every(r=>r.outcome==="checked")};
  await writeFile(path.join(directory,`summary${suffix}.json`),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
  if(process.argv.includes("--baseline")){
    const failures=baselineFailures(results as {name:string;outcome:string;ocrGroundTruth?:{passed:boolean}}[]);
    await writeFile(path.join(directory,`baseline${suffix}.json`),JSON.stringify({passed:!failures.length,failures},null,2));
    if(failures.length){console.error(JSON.stringify({regressions:failures}));process.exitCode=1;}
  }
  if(process.argv.includes("--strict")&&!summary.allChecked)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Regression suite failed");process.exitCode=1;});
