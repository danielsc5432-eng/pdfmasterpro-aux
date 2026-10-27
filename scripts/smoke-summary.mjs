import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

// Uses an installed Chromium browser, without adding a browser automation dependency.
const base = process.env.SMOKE_BASE_URL || "http://localhost:3100";
const candidates = [process.env.SMOKE_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error("Set SMOKE_BROWSER to an installed Chromium executable.");
const directory = await mkdtemp(path.join(os.tmpdir(), "pdfmaster-ui-"));
const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(directory, "profile")}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Browser startup timed out")), 20000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.stderr.on("data", (data) => { output += data; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await once(socket, "open");
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const item = pending.get(message.id); if (item) { pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); } }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error("CDP timeout: " + method)); }, 15000); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  const evaluate = async (expression) => { const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const waitFor = async (expression, timeout = 15000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 150)); } throw new Error("UI timeout: " + expression + "\n" + await evaluate("document.body.innerText.slice(-1500)")); };
  const navigate = async (route) => { await cdp("Page.navigate", { url: base + route }); await waitFor("document.readyState === 'complete' && !!document.querySelector('header')"); await new Promise((resolve) => setTimeout(resolve, 400)); };
  const selectFiles = async (selector, files) => { const { root } = await cdp("DOM.getDocument"); const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector }); assert.ok(nodeId, "File input missing"); await cdp("DOM.setFileInputFiles", { nodeId, files }); };


  assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Run only on an isolated local server');
  const fixtures=path.resolve('.vercel/review/resumomaster');await mkdir(fixtures,{recursive:true});const downloads=path.join(directory,'downloads');await mkdir(downloads);
  const pdf=await PDFDocument.create();pdf.addPage([595,842]).drawText('Maria deve pagar R$ 1.200,00 em 25/10/2026.',{x:40,y:750,size:12});const file=path.join(fixtures,'financeiro.pdf');await writeFile(file,await pdf.save());
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  await send('Browser.grantPermissions',{origin:base,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await navigate('/ferramentas/resumir-pdf-ia');await waitFor('!!document.querySelector("#summary-run")');
  assert.equal(await evaluate('document.querySelector("#summary-run").disabled'),true);assert.equal(await evaluate('document.querySelector("input[value=advanced]").disabled'),true);
  await selectFiles('[data-summary-file]',[file]);await waitFor('!!document.querySelector(".summary-file")');assert.equal(await evaluate('document.querySelector("#summary-run").disabled'),true);
  let mode='success',uploads=0,held=null;
  const defaults={length:'medium',mode:'standard',instructions:'',pages:'',consent:true};
  const result={version:1,id:'a829c53e-171f-4b78-9400-dfc829c53e17',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1800000).toISOString(),name:'financeiro.pdf',options:defaults,provider:'Test fixture only',model:'test-small',totalPages:1,analyzedPages:[1],unreadPages:[],warnings:['Confira o documento original.'],points:[{text:'Maria deve pagar R$ 1.200,00 em 25/10/2026.',evidence:[{sourceId:'p1s1',quote:'Maria deve pagar R$ 1.200,00 em 25/10/2026.'}]}],sources:[{id:'p1s1',page:1,text:'Maria deve pagar R$ 1.200,00 em 25/10/2026.'}],usage:{calls:1,chunks:1}};
  const capabilities={available:true,provider:'Test fixture only',models:{standard:'test-small',advanced:'test-large'},costNotice:'Resposta controlada apenas para testar interface.',limits:{uploadBytes:4194304,pages:120,characters:60000,chunkCharacters:7500,chunks:8,ocrPages:10,durationMs:230000,resultCharacters:16000},ocr:true,authenticated:true,jobsPerDay:3};
  await cdp('Fetch.enable',{patterns:[{urlPattern:'*/api/summary/capabilities',requestStage:'Request'},{urlPattern:'*/api/v1/process?tool=resumir-pdf-ia',requestStage:'Request'}]});
  socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method!=='Fetch.requestPaused')return;const req=m.params.request;const cap=req.url.includes('/capabilities');if(!cap)uploads++;if(!cap&&mode==='cancel'){held=m.params.requestId;return;}const payload=cap?JSON.stringify(capabilities):mode==='error'?JSON.stringify({error:'Limite de teste atingido.'}):mode==='truncated'?'data: {"type":"progress","stage":"extracting","message":"Extraindo"}\n\ndata: {"type":"res':'data: '+JSON.stringify({type:'progress',stage:'summarizing',message:'Trecho concluido',current:1,total:1})+'\n\ndata: '+JSON.stringify({type:'result',result})+'\n\n';cdp('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:!cap&&mode==='error'?429:200,responseHeaders:[{name:'Content-Type',value:cap||mode==='error'?'application/json':'text/event-stream'}],body:Buffer.from(payload).toString('base64')}).catch(e=>errors.push(e.message));});
  const click=async text=>evaluate('Array.from(document.querySelectorAll(".summary-workspace button")).find(b=>b.textContent.includes('+JSON.stringify(text)+')).click()');
  await click('Atualizar status');await waitFor('!document.querySelector("#summary-consent").disabled');assert.equal(uploads,0);assert.equal(await evaluate('document.querySelector("#summary-run").disabled'),true);
  await evaluate('document.querySelector("#summary-consent").click()');await waitFor('!document.querySelector("#summary-run").disabled');await click('Resumir PDF');await waitFor('!!document.querySelector("#summary-editor")');assert.equal(uploads,1);
  await click('Copiar');await waitFor('document.body.innerText.includes("Resumo copiado")');assert.ok((await evaluate('navigator.clipboard.readText()')).includes('1.200,00'));
  await evaluate('(()=>{const f=document.querySelector("#summary-editor");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(f,f.value+'+JSON.stringify('\n\nNota revisada pelo usuario.')+');f.dispatchEvent(new Event("input",{bubbles:true}));})()');await waitFor('document.body.innerText.includes("Texto editado por")');
  const waitDownload=async name=>{const destination=path.join(downloads,name);const deadline=Date.now()+25000;while(Date.now()<deadline){try{return await readFile(destination);}catch{await new Promise(r=>setTimeout(r,150));}}throw Error('Missing download '+name+' '+await evaluate('document.body.innerText.slice(-1500)'));};
  await click('TXT');const txt=await waitDownload('resumo-pdfmasterpro.txt');assert.ok(txt.toString().includes('1.200,00'));assert.ok(txt.toString().includes('Texto editado pelo'));
  await click('DOCX');const docx=await waitDownload('resumo-pdfmasterpro.docx');assert.ok((await(await JSZip.loadAsync(docx)).file('word/document.xml').async('string')).includes('1.200,00'));
  await click('PDF');const exported=await waitDownload('resumo-pdfmasterpro.pdf');assert.ok((await PDFDocument.load(exported)).getPageCount()>0);
  for(const width of [390,768,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'Overflow '+width);if(width!==768){const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(fixtures,'ui-'+width+'.png'),Buffer.from(shot.data,'base64'));}}
  mode='truncated';await click('Gerar novamente');await waitFor('document.body.innerText.includes("interrompido antes da")');assert.equal(await evaluate('!!document.querySelector("#summary-editor")'),false);
  mode='error';await click('Resumir PDF');await waitFor('document.body.innerText.includes("Limite de teste atingido")');
  mode='cancel';await click('Resumir PDF');await waitFor('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Cancelar")');await click('Cancelar');await waitFor('document.body.innerText.includes("Resumo cancelado")');if(held)await cdp('Fetch.failRequest',{requestId:held,errorReason:'Aborted'}).catch(()=>{});assert.equal(await evaluate('!!document.querySelector("#summary-editor")'),false);
  assert.deepEqual(errors,[]);console.log('PASS browser: unconfigured provider, consent gate, real file selection, controlled streamed result, copy/edit, actual PDF/DOCX/TXT downloads, truncation/API error/cancel and three responsive widths; no real AI contacted');
  await send('Browser.close').catch(()=>undefined);
} finally {
  socket?.close();
  if (child.exitCode === null) { child.kill(); await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]); }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
