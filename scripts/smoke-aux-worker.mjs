import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import JSZip from 'jszip';

const base=process.env.SMOKE_BASE_URL||'http://127.0.0.1:3000';
const secret=process.env.BILLING_SIGNING_SECRET;
if(!secret)throw Error('Provide a synthetic signing secret for the smoke test.');
const results=[];
async function check(name,run){await run();results.push({name,passed:true});console.log('PASS',name);}
function signed(){const payload=`free.${Math.floor(Date.now()/1000)+300}`;return {'x-pdfmaster-plan':payload,'x-pdfmaster-plan-sig':createHmac('sha256',secret).update(payload).digest('base64url')};}
async function call(tool,fields={},copies=1){
 const form=new FormData();for(let i=0;i<copies;i++)form.append('files',new Blob([source],{type:'application/pdf'}),`synthetic-${i}.pdf`);
 for(const [key,value] of Object.entries(fields))form.set(key,value);
 const response=await fetch(`${base}/api/v1/process?tool=${tool}`,{method:'POST',headers:signed(),body:form,signal:AbortSignal.timeout(90000)});
 assert.equal(response.status,200,`${tool}: ${response.status}`);return new Uint8Array(await response.arrayBuffer());
}
const doc=await PDFDocument.create();doc.addPage([400,560]);doc.addPage([500,600]);const source=await doc.save();
let ready=false;for(let i=0;i<90;i++){try{ready=(await fetch(`${base}/api/health`)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,1000));}
assert.ok(ready,'Worker health unavailable');
await check('unsigned request rejected',async()=>assert.equal((await fetch(`${base}/api/v1/process?tool=girar-pdf`,{method:'POST'})).status,403));
await check('tampered signature rejected',async()=>assert.equal((await fetch(`${base}/api/v1/process?tool=girar-pdf`,{method:'POST',headers:{...signed(),'x-pdfmaster-plan-sig':'A'.repeat(43)}})).status,403));
await check('heavy tool rejected',async()=>assert.equal((await fetch(`${base}/api/v1/process?tool=ocr-pdf`,{method:'POST',headers:signed()})).status,403));
await check('merge',async()=>assert.equal((await PDFDocument.load(await call('juntar-pdf',{},2))).getPageCount(),4));
await check('split',async()=>{const zip=await JSZip.loadAsync(await call('dividir-pdf',{mode:'pages'}));assert.equal(Object.keys(zip.files).length,2);for(const file of Object.values(zip.files))assert.equal((await PDFDocument.load(await file.async('uint8array'))).getPageCount(),1);});
await check('rotate',async()=>assert.equal((await PDFDocument.load(await call('girar-pdf',{angle:'90'}))).getPage(0).getRotation().angle,90));
await check('reorder',async()=>assert.equal((await PDFDocument.load(await call('organizar-pdf',{order:'2,1'}))).getPage(0).getWidth(),500));
await check('metadata',async()=>assert.equal((await PDFDocument.load(await call('editar-metadados',{title:'Synthetic auxiliary test'}))).getTitle(),'Synthetic auxiliary test'));
await check('oversized upload rejected',async()=>assert.equal((await fetch(`${base}/api/v1/process?tool=girar-pdf`,{method:'POST',headers:signed(),body:new Uint8Array(8388609),signal:AbortSignal.timeout(30000)})).status,413));
await check('health after processing',async()=>assert.ok((await fetch(`${base}/api/health`)).ok));
await mkdir('.vercel/review/aux-worker',{recursive:true});await writeFile('.vercel/review/aux-worker/results.json',JSON.stringify(results,null,2));
