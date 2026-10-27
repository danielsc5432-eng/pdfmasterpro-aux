import { pdfToDocx } from "./docx";
import { inspectConversionProfile, structuralPdfToDocx } from "./pdf2docx";
import { betterFidelity, checkDocxFidelity, fidelityStatus, unsafeFidelity } from "./docx-fidelity";
import { configuredExtraEngines, extraEngineToWord } from "./extra-engines";
import { renderPageGrid } from "../pdf-sdk/page-grid";
import { nativePdfToDocx } from "../pdf-sdk/native";
import { tryVerifiedConversion } from "./conversion-policy";
import { cliConvert, configuredCli } from "./cli-engine";

/** Preserve form geometry; OCR scanned pages; rebuild native flow when appropriate. */
export async function checkedPdfToDocx(input: Uint8Array, name: string) {
  const deadline = Date.now() + 260000;
  const profile=await inspectConversionProfile(input);
  const mode=profile.mode;
  const primary=await tryVerifiedConversion(budget=>profile.primary==="native"?nativePdfToDocx(input,name):profile.primary==="page-grid"?pdfToDocx(input,name,"por+eng",renderPageGrid):profile.primary==="tables"?structuralPdfToDocx(input,budget):pdfToDocx(input,name,"por+eng"),{deadline,verify:(output,budget)=>checkDocxFidelity(input,output,budget)});
  let output=primary?.output;
  let report=primary?.report??null;
  console.info("[pdfmaster] Word fidelity",JSON.stringify({engine:profile.primary,report}));
  if ((!report||fidelityStatus(report) === "review") && profile.primary!=="page-grid" && deadline-Date.now()>60000) {
    try {
      const grid = await pdfToDocx(input,name,"por+eng",renderPageGrid);
      const measured = await checkDocxFidelity(input,grid,Math.min(60000,deadline-Date.now()));
      console.info("[pdfmaster] Word fidelity",JSON.stringify({engine:"page-grid",report:measured}));
      if (measured && (!report||betterFidelity(measured,report))) { output=grid; report=measured; }
    } catch { /* Retain the measured baseline if flow reconstruction cannot preserve geometry. */ }
  }
  if(profile.primary!=="native"&&(fidelityStatus(report)!=="checked"||(report?.visualSimilarity??0)<.98)&&deadline-Date.now()>60000){
    try{
      const candidate=await nativePdfToDocx(input,name);
      const measured=await checkDocxFidelity(input,candidate,Math.min(60000,deadline-Date.now()));
      console.info("[pdfmaster] Word fidelity",JSON.stringify({engine:"native-unicode-layout",report:measured}));
      if(measured&&(!report||betterFidelity(measured,report))){output=candidate;report=measured;}
    }catch{/* Preserve the measured baseline when Unicode reconstruction is incompatible. */}
  }
  if(profile.primary!=="layout"&&(!report||fidelityStatus(report)==="review")&&deadline-Date.now()>60000){
    const fallback=await tryVerifiedConversion(()=>pdfToDocx(input,name,"por+eng"),{deadline,verify:(candidate,budget)=>checkDocxFidelity(input,candidate,budget)});
    if(fallback&&(!report||betterFidelity(fallback.report,report))){output=fallback.output;report=fallback.report;}
  }
  if(configuredCli("pdf-to-word")&&(!report||fidelityStatus(report)==="review")&&deadline-Date.now()>60000){
    const cli=await tryVerifiedConversion(budget=>cliConvert("pdf-to-word",input,budget),{deadline,verify:(candidate,budget)=>checkDocxFidelity(input,candidate,budget)});
    if(cli&&(!report||betterFidelity(cli.report,report))){output=cli.output;report=cli.report;}
  }
  const extras = configuredExtraEngines();
  for (let index = 0; index < extras.length; index++) {
    if (fidelityStatus(report) === "checked") break;
    const budget = Math.floor((deadline-Date.now()) / (extras.length-index));
    if (budget < 15000) break;
    try {
      const candidate = await extraEngineToWord(extras[index], input, Math.min(60000, Math.floor(budget/2)));
      const measured = await checkDocxFidelity(input,candidate,Math.min(60000,deadline-Date.now(),Math.floor(budget/2)));
      // An unmeasured external result must never replace the existing conversion.
      if (measured && (!report || betterFidelity(measured,report))) { output=candidate; report=measured; }
    } catch { /* An unavailable optional service must not interrupt local conversion. */ }
  }
  if ((!report||fidelityStatus(report) === "review") && !profile.scan && deadline-Date.now()>60000) {
    try {
      const alternate = mode === "layout" ? await structuralPdfToDocx(input, Math.min(120000,Math.floor((deadline-Date.now())/2))) : await pdfToDocx(input,name,"por+eng");
      const measured = await checkDocxFidelity(input,alternate,Math.min(90000,deadline-Date.now()));
      if (measured && (!report||betterFidelity(measured,report))) { output=alternate; report=measured; }
    } catch { /* Keep the candidate whose fidelity was actually measured. */ }
  }
  if (!report||!output) throw new Error("A conferência de qualidade não pôde ser concluída. Tente novamente para gerar um Word verificado.");
  if (unsafeFidelity(report)) throw new Error("A conferência detectou diferenças nas páginas, textos, números ou layout. Não foi possível gerar um Word confiável para este PDF.");
  return { output, report, status: fidelityStatus(report) };
}

export async function automaticPdfToDocx(input: Uint8Array, name: string) {
  return (await checkedPdfToDocx(input,name)).output;
}
