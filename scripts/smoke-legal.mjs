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
  await navigate("/juridico");assert.equal(await evaluate("document.querySelectorAll('.legal-roadmap-grid a').length"),7);
  await evaluate("(()=>{const marker=document.createElement('script');marker.type='application/json';marker.src='https://pagead2.googlesyndication.com/inactive-test-marker';document.head.appendChild(marker);document.querySelector('.legal-roadmap-grid a').click();return true;})()");
  await waitFor("document.readyState==='complete' && !!document.querySelector('#legal-compare') && !document.querySelector('script[src*=\"googlesyndication\"]')",30000);
  assert.equal(await evaluate("!!document.querySelector('script[src*=\"googlesyndication\"]')"),false);
  await upload("original.pdf","atualizado.pdf");await run().then(()=>{throw Error("Quota denial should block comparison");},error=>assert.match(error.message,/Cota/));
  assert.equal(await evaluate("!!document.querySelector('#legal-results-title')"),false);denied=false;await run();
  const findingText=await evaluate("document.querySelector('.legal-findings').innerText");for(const category of ['Valores','Percentuais','Datas','Prazos','Nomes e partes'])assert.ok(findingText.includes(category),category);
  await evaluate("document.querySelector('[data-legal-finding]').click()");await waitFor("Array.from(document.querySelectorAll('.legal-viewer canvas')).every(canvas=>canvas.width>10&&canvas.dataset.legalRendered==='true')");
  assert.equal(await evaluate("document.querySelectorAll('.legal-highlight').length"),2);
  await setSelect("[data-legal-review]","reviewed");await evaluate("(()=>{const note=document.querySelector('[data-legal-note]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(note,'Conferido no original');note.dispatchEvent(new Event('input',{bubbles:true}));})()");
  for(const format of ['txt','csv','docx','pdf']){
    await evaluate(`document.querySelector('[data-legal-export="${format}"]').click()`);
    const deadline=Date.now()+30000;let bytes;
    while(Date.now()<deadline){try{bytes=await readFile(path.join(downloads,`timemachine-juridico.${format}`));if(bytes.length>30)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(bytes?.length,format+' download');await writeFile(path.join(fixtures,`relatorio-browser.${format}`),bytes);
    if(format==='txt')for(const value of ['1.200,00','2.500,00','12 meses','24 meses','25/11/2026','Conferido no original'])assert.ok(bytes.toString().includes(value),value);
    if(format==='docx')assert.ok((await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')).includes('2.500,00'));
    if(format==='pdf')assert.ok((await PDFDocument.load(bytes)).getPageCount()>0);
  }
  console.log('PASS real browser PDF extraction, financial/date/party changes, two rendered pages, highlights, quota refusal and four actual report downloads');
  await selectFiles('[data-legal-extra]',[path.join(fixtures,'versao-3.pdf')]);await waitFor("!document.querySelector('#legal-results-title')");await run();assert.equal(await evaluate("document.querySelectorAll('.legal-timeline>div').length"),3);await evaluate("document.querySelectorAll('.legal-timeline button')[1].click()");await waitFor("document.querySelector('.legal-findings').innerText.includes('Valores')");console.log('PASS three versions, consecutive timeline and result invalidation');
  for(const width of [320,390,768,1024,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<700});await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");await waitFor("Array.from(document.querySelectorAll('.legal-viewer canvas')).every(canvas=>canvas.dataset.legalRendered==='true')");assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'overflow '+width);if(width===390||width===1440){const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(fixtures,`legal-${width}.png`),Buffer.from(screenshot.data,'base64'));}}
  await cdp('Emulation.clearDeviceMetricsOverride');
  await clear();await upload('original.pdf','identico.pdf');await run();assert.match(await evaluate("document.querySelector('#legal-results-title').textContent"),/^0 /);console.log('PASS identical real PDFs produce zero findings');
  await clear();await upload('original.pdf','visual.pdf');await setSelect('[data-legal-mode]','visual');await run();assert.ok((await evaluate("document.querySelector('.legal-findings').textContent")).includes('Apresentação'));console.log('PASS actual visual stamp change detected from rendered page samples');
  await clear();await upload('tabela-original.pdf','tabela-atualizada.pdf');await setSelect('[data-legal-mode]','complete');await run();assert.ok((await evaluate("document.querySelector('.legal-findings').textContent")).includes('Possível tabela'));console.log('PASS real PDF table columns and changed row aligned with evidence');
  for(const file of ['corrompido.pdf','protegido.pdf']){await clear();await upload('original.pdf',file);await run().then(()=>{throw Error(file+' should fail');},error=>assert.match(error.message,file==='protegido.pdf'?/protegido/:/corrompido|não foi possível/i));assert.equal(await evaluate("!!document.querySelector('#legal-results-title')"),false);}
  console.log('PASS corrupt and encrypted real PDFs are rejected without fabricated results');
  await clear();await upload('original.pdf','digitalizado.pdf');await setSelect('[data-legal-mode]','complete');await evaluate("document.querySelector('[data-legal-ocr]').click()");await run();assert.ok((await evaluate("document.querySelector('.legal-warnings').textContent")).includes('OCR utilizado'));assert.ok((await evaluate("document.querySelector('.legal-warnings').textContent")).includes('confiança'));console.log('PASS Tesseract.js OCR in the real browser using self-hosted languages and worker');
  await clear();await upload('original.pdf','digitalizado-300dpi.pdf');await run();assert.ok((await evaluate("document.querySelector('.legal-warnings').textContent")).includes('OCR utilizado'));console.log('PASS real 300-DPI scan OCR, beyond four million source pixels');
  await clear();await upload('original.pdf','ocr-baixa-qualidade.pdf');await run();assert.ok((await evaluate("document.querySelector('.legal-warnings').textContent")).includes('OCR'));console.log('PASS low-quality scan has explicit uncertainty warnings');
  await clear();await upload('original.pdf','extenso.pdf');await evaluate("document.querySelector('#legal-compare').click()");await waitFor("Array.from(document.querySelectorAll('.legal-actions button')).some(button=>button.textContent==='Cancelar')");await evaluate("Array.from(document.querySelectorAll('.legal-actions button')).find(button=>button.textContent==='Cancelar').click()");await waitFor("!document.querySelector('#legal-results-title') && document.querySelector('.legal-error')?.textContent.includes('cancelada')");await run();assert.ok((await evaluate("document.querySelector('.legal-warnings').textContent")).includes('20 páginas'));console.log('PASS actual 20-page contract extraction and comparison');
  await clear();assert.ok(posts.length>4);assert.ok(posts.every(post=>post.url==='/api/legal/quota'&&!post.body),'No document upload, only empty quota reservations');assert.deepEqual(external,[],'No external request on legal pages');assert.deepEqual(errors,[],'No uncaught browser exceptions');
  console.log('PASS no document uploads, no external AI/ads/CDN requests, session cleanup and five responsive widths');
  await send('Browser.close').catch(()=>{});
} finally {
  socket?.close();if(child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);}
  await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:500});
}
