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
  const waitFor = async (expression, timeout = 15000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { try { if (await evaluate("Boolean("+expression+")")) return; } catch (error) { if (!/context|navigat/i.test(error.message)) throw error; } await new Promise((resolve) => setTimeout(resolve, 150)); } throw new Error("UI timeout: " + expression + "\n" + await evaluate("document.body.innerText.slice(-1500)")); };
  const navigate = async (route) => { await cdp("Page.navigate", { url: base + route }); await waitFor("document.readyState === 'complete' && !!document.querySelector('header')"); await new Promise((resolve) => setTimeout(resolve, 400)); };
  const selectFiles = async (selector, files) => { const { root } = await cdp("DOM.getDocument"); const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector }); assert.ok(nodeId, "File input missing"); await cdp("DOM.setFileInputFiles", { nodeId, files }); };
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only run this development smoke test locally");
  const fixtures=path.resolve(".vercel/review/legal"), downloads=path.join(directory,"downloads");await mkdir(downloads,{recursive:true});
  await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:downloads,eventsEnabled:true});
  let denied=true;const posts=[], external=[];
  await cdp("Network.enable");await cdp("Fetch.enable",{patterns:[{urlPattern:"*/api/legal/quota",requestStage:"Request"}]});
  socket.addEventListener("message",({data})=>{const message=JSON.parse(data);
    if(message.method==="Target.attachedToTarget"&&message.params.targetInfo.type==="worker"){const childSession=message.params.sessionId;void(async()=>{try{await send("Network.enable",{},childSession);}finally{await send("Runtime.runIfWaitingForDebugger",{},childSession);}})().catch(error=>errors.push(error.message));}
    if(message.method==="Network.requestWillBeSent"){const request=message.params.request;if(request.method==="POST")posts.push({url:new URL(request.url).pathname,body:request.postData||""});if(request.url.startsWith("http")&&!['localhost','127.0.0.1'].includes(new URL(request.url).hostname))external.push(request.url);}
    if(message.method==="Fetch.requestPaused")cdp("Fetch.fulfillRequest",{requestId:message.params.requestId,responseCode:denied?429:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(denied?{error:"Cota de teste atingida."}:{authorized:true,limit:10})).toString("base64")}).catch(error=>errors.push(error.message));
  });
  await cdp("Target.setAutoAttach",{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  const upload=async(one,two)=>{await selectFiles('[data-legal-upload="0"]',[path.join(fixtures,one)]);await waitFor("document.querySelector('[aria-label=\"Nome da versão 1\"]')");await selectFiles('[data-legal-upload="1"]',[path.join(fixtures,two)]);await waitFor("!document.querySelector('#legal-compare').disabled");};
  const run=async()=>{await evaluate("document.querySelector('#legal-compare').click()");await waitFor("!!document.querySelector('#legal-results-title') || !!document.querySelector('.legal-error')",150000);const error=await evaluate("document.querySelector('.legal-error')?.textContent || ''");if(error)throw Error(error);};
  const clear=async()=>{await evaluate("Array.from(document.querySelectorAll('.legal-actions button')).find(button=>button.textContent.includes('Limpar documentos')).click()");await waitFor("!document.querySelector('#legal-results-title') && document.querySelector('#legal-compare').disabled");};
  const setSelect=async(selector,value)=>evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(selector)});select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const suiteUpload=async(file)=>{await selectFiles('[data-analysis-upload]',[path.join(fixtures,file)]);await waitFor("!document.querySelector('#legal-analyze').disabled");};
  const suiteRun=async()=>{await evaluate("document.querySelector('#legal-analyze').click()");await waitFor("!!document.querySelector('#analysis-result-title') || !!document.querySelector('.legal-error')",150000);const error=await evaluate("document.querySelector('.legal-error')?.textContent || ''");if(error)throw Error(error);};
  const suiteClear=async()=>{await evaluate("Array.from(document.querySelectorAll('.legal-actions button')).find(button=>button.textContent.includes('Limpar documentos')).click()");await waitFor("!document.querySelector('#analysis-result-title') && document.querySelector('#legal-analyze').disabled");};
  const downloadSuite=async(slug,format)=>{await evaluate(`document.querySelector('[data-analysis-export="${format}"]').click()`);let bytes;const end=Date.now()+30000;while(Date.now()<end){try{bytes=await readFile(path.join(downloads,`${slug}-relatorio.${format}`));break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(bytes?.length,slug+' '+format+' download');return bytes;};
  await navigate('/juridico');assert.equal(await evaluate("document.querySelectorAll('.legal-roadmap-grid a').length"),7);
  const cases=[['contractcheck-ai','suite-contrato.pdf',['Obrigações','Rescisão','2.500,00']],['processo-timeline','suite-processo.pdf',['2026','Eventos sem data','Datas a conferir']],['juris-organize','suite-contrato.pdf',['Contrato','Maria Silva','Dígitos verificadores consistentes']],['prazo-extractor','suite-processo.pdf',['15 dias úteis','século não presumido','Data inválida']],['peticao-review','suite-peticao.pdf',['Referências internas','Repetições','Salto entre 1 e 3']]];
  for(const [slug,file,expected]of cases){
    await navigate('/ferramentas/'+slug);await suiteUpload(file);
    if(denied){await suiteRun().then(()=>{throw Error('Quota denial required');},error=>assert.match(error.message,/Cota de teste/));denied=false;}
    await suiteRun();const content=await evaluate("document.querySelector('.legal-analysis').innerText");for(const text of expected)assert.ok(content.includes(text),slug+' expected '+text);
    await waitFor("document.querySelector('.legal-viewer canvas')?.dataset.legalRendered==='true'");
    await evaluate("document.querySelector('.analysis-items .text-link').click()");assert.ok(await evaluate("!!document.querySelector('#analysis-source')"));
    for(const format of ['txt','csv','docx','pdf']){const bytes=await downloadSuite(slug,format);if(format==='txt')assert.ok(bytes.toString('utf8').includes('Página 1'));if(format==='csv')assert.equal(bytes[0],0xef);if(format==='docx'){const zip=await JSZip.loadAsync(bytes);assert.ok((await zip.file('word/document.xml').async('string')).includes('PDF MASTER PRO'));}if(format==='pdf')assert.ok((await PDFDocument.load(bytes)).getPageCount()>0);}
    if(slug==='contractcheck-ai')for(const width of [320,390,768,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");await waitFor("document.querySelector('.legal-viewer canvas')?.dataset.legalRendered==='true'");assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'suite overflow '+width);if(width===390){const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(fixtures,'suite-390.png'),Buffer.from(shot.data,'base64'));}}
    await cdp('Emulation.clearDeviceMetricsOverride');
    if(slug==='juris-organize'){
      await setSelect('[data-organize-group]','date');await waitFor("document.querySelector('[data-organized-path]').value.startsWith('2026-11-30/')");

      assert.equal(await evaluate("document.querySelector('[data-analysis-export=zip]').disabled"),true);
      await evaluate("document.querySelector('[data-organized-confirm]').click()");await waitFor("!document.querySelector('[data-analysis-export=zip]').disabled");
      await evaluate("(()=>{const input=document.querySelector('[data-organized-path]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'revisado/contrato.pdf');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()");await waitFor("document.querySelector('[data-analysis-export=zip]').disabled");
      await evaluate("document.querySelector('[data-organized-confirm]').click()");const bytes=await downloadSuite(slug,'zip');const zip=await JSZip.loadAsync(bytes);assert.deepEqual(await zip.file('revisado/contrato.pdf').async('nodebuffer'),await readFile(path.join(fixtures,file)));assert.ok(zip.file('manifesto-organizacao.json'));
    }
    console.log('PASS '+slug+': actual PDF, evidence viewer, four real report exports'+(slug==='juris-organize'?', editable names, confirmation and byte-preserving ZIP':''));
  }
  await navigate('/ferramentas/prova-compare');await upload('original.pdf','atualizado.pdf');await run();assert.ok((await evaluate("document.querySelector('.legal-intro').innerText")).includes('evidências'));await evaluate("document.querySelector('.legal-warnings').open=true");assert.ok((await evaluate("document.querySelector('.legal-warnings').textContent")).includes('Metadados declarados'));for(const format of ['txt','csv','docx','pdf']){await evaluate(`document.querySelector('[data-legal-export="${format}"]').click()`);let bytes;const end=Date.now()+30000;while(Date.now()<end){try{bytes=await readFile(path.join(downloads,`prova-compare-juridico.${format}`));break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(bytes?.length,'ProvaCompare report '+format);if(format==='txt'){assert.ok(bytes.toString('utf8').includes('ProvaCompare'));assert.ok(bytes.toString('utf8').includes('Metadados declarados'));}if(format==='pdf')assert.ok((await PDFDocument.load(bytes)).getPageCount()>0);}
  console.log('PASS ProvaCompare: real document comparison, metadata, fingerprints and evidence');
  await navigate('/ferramentas/prazo-extractor');await suiteUpload('digitalizado.pdf');await evaluate("document.querySelector('[data-analysis-ocr]').click()");await suiteRun();assert.ok((await evaluate("document.querySelector('.legal-warnings').textContent")).includes('OCR utilizado'));assert.ok((await evaluate("document.querySelector('.analysis-items').innerText")).includes('12 meses'));console.log('PASS suite: real scanned PDF through local OCR and deadline extraction');
  for(const file of ['corrompido.pdf','protegido.pdf']){await suiteClear();await suiteUpload(file);await suiteRun().then(()=>{throw Error('Must reject '+file);},error=>assert.match(error.message,/corrompido|protegido|não foi possível/i));assert.equal(await evaluate("!!document.querySelector('#analysis-result-title')"),false);}
  await suiteClear();await suiteUpload('suite-vazio.pdf');await suiteRun();assert.ok((await evaluate("document.querySelector('#analysis-result-title').textContent")).startsWith('0 '));assert.ok((await evaluate("document.querySelector('.legal-warnings').textContent")).includes('nenhum texto'));console.log('PASS suite: corrupt, encrypted and empty PDFs handled honestly');
  await suiteClear();await suiteUpload('extenso.pdf');await evaluate("document.querySelector('#legal-analyze').click()");await waitFor("Array.from(document.querySelectorAll('.legal-actions button')).some(button=>button.textContent==='Cancelar')");await evaluate("Array.from(document.querySelectorAll('.legal-actions button')).find(button=>button.textContent==='Cancelar').click()");await waitFor("document.querySelector('.legal-error')?.textContent.includes('cancelada')");await suiteRun();assert.ok((await evaluate("document.querySelector('#analysis-result-title').textContent")).match(/\d+ registros/));await suiteClear();
  assert.ok(posts.every(p=>p.url==='/api/legal/quota'&&!p.body));assert.deepEqual(external,[]);assert.deepEqual(errors,[]);console.log('PASS suite: cancellation and reuse, 20-page PDF, shared quota, mobile widths, no document uploads/external AI/ads/CDN requests');
  await send('Browser.close').catch(()=>{});
}finally{socket?.close();if(child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);}await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:500});}
