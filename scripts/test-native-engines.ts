import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {nativeExtractText,engineEnvironment,renderEnginePages,pdfbox,enginePython,boundedFile} from '../lib/processing/native-engines';
import {withNativeJob} from '../lib/processing/native-job';
import {renderPdfToZip} from '../lib/processing/pdf';
import {ocrPdf} from '../lib/processing/extended';
import JSZip from 'jszip';
async function main(){
 const root=path.resolve('.vercel/review/ocrmypdf-benchmark/fixtures');
 const results:unknown[]=[];
 async function check(name:string,run:()=>Promise<void>){console.log('START',name);const start=Date.now();await run();results.push({name,passed:true,ms:Date.now()-start});console.log('PASS',name);}
 const native=new Uint8Array(await readFile(path.join(root,'native-text.pdf')));
 for(const engine of ['pdfbox','pdfium','poppler']){
  await check(`${engine} text`,async()=>{
   process.env.PDF_TEXT_ENGINE=engine;assert.ok(new TextDecoder().decode(await nativeExtractText(native)).trim().length>30);
   if(engine!=='poppler')await withNativeJob(native,'pdf',async({directory,inputPath})=>{
    const output=path.join(directory,'direct.txt');
    if(engine==='pdfbox')await pdfbox(['export:text','-encoding=UTF-8','-sort',`-i=${inputPath}`,`-o=${output}`],directory);
    else await enginePython(['text',inputPath,output],directory);
    assert.ok((await boundedFile(output)).length>30);
   });
  });
  await check(`${engine} render`,async()=>{
   process.env.PDF_RASTERIZER=engine;
   await withNativeJob(native,'pdf',async({directory,inputPath})=>{assert.equal((await renderEnginePages(inputPath,directory,1,1)).engine,engine);});
   const zip=await JSZip.loadAsync(await renderPdfToZip(native,1,1));assert.equal(Object.keys(zip.files).length,1);
  });
 }
 await check('missing Poppler automatic fallback',async()=>{
  process.env.PDF_TEXT_ENGINE='auto';process.env.PDF_TEXT_EXTRACTOR='pdfmaster-missing-executable';
  process.env.PDF_RASTERIZER='auto';process.env.PDF_RENDERER='pdfmaster-missing-executable';
  try{assert.ok((await nativeExtractText(native)).length>30);assert.ok((await renderPdfToZip(native,1,1)).length>100);}finally{delete process.env.PDF_TEXT_EXTRACTOR;delete process.env.PDF_RENDERER;}
 });
 await check('credentials excluded',async()=>{process.env.RESEND_API_KEY='synthetic-secret';assert.equal(engineEnvironment(root).RESEND_API_KEY,undefined);delete process.env.RESEND_API_KEY;});
 await check('native OCR byte preservation',async()=>{assert.deepEqual(await ocrPdf(native,'por+eng'),native);});
 for(const fixture of ['scan-300dpi','small-print-6pt','mixed-native-scan','rotated-90deg'])await check(`${fixture} verified OCR`,async()=>{
  const bytes=new Uint8Array(await readFile(path.join(root,`${fixture}.pdf`)));const output=await ocrPdf(bytes,'por+eng');assert.ok(output.length>100);
  const text=new TextDecoder().decode(await nativeExtractText(output));
  for(const value of ['2.500,00','10%','30/11/2026','15','30'])assert.ok(text.includes(value),`${fixture}: missing synthetic value ${value}`);
  await writeFile(path.join(root,`integrated-${fixture}.pdf`),output);
 });
 for(const fixture of ['corrupt','protected'])await check(`${fixture} rejected`,async()=>{const bytes=new Uint8Array(await readFile(path.join(root,`${fixture}.pdf`)));await assert.rejects(()=>ocrPdf(bytes,'por+eng'));});
 await check('invalid upload rejected',async()=>{await assert.rejects(()=>nativeExtractText(new Uint8Array([1,2,3])));});
 await writeFile('.vercel/review/pdf24-research/integration-results.json',JSON.stringify(results,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
