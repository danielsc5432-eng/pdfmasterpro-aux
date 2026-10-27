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
    if(message.method==="Fetch.requestPaused"&&message.params.request.url.includes("/api/legal/quota"))cdp("Fetch.fulfillRequest",{requestId:message.params.requestId,responseCode:denied?429:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(denied?{error:"Cota de teste atingida."}:{authorized:true,limit:10})).toString("base64")}).catch(error=>errors.push(error.message));
  });
  await cdp("Target.setAutoAttach",{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  const upload=async(one,two)=>{await selectFiles('[data-legal-upload="0"]',[path.join(fixtures,one)]);await waitFor("document.querySelector('[aria-label=\"Nome da versão 1\"]')");await selectFiles('[data-legal-upload="1"]',[path.join(fixtures,two)]);await waitFor("!document.querySelector('#legal-compare').disabled");};
  const run=async()=>{await evaluate("document.querySelector('#legal-compare').click()");await waitFor("!!document.querySelector('#legal-results-title') || !!document.querySelector('.legal-error')",150000);const error=await evaluate("document.querySelector('.legal-error')?.textContent || ''");if(error)throw Error(error);};
  const clear=async()=>{await evaluate("Array.from(document.querySelectorAll('.legal-actions button')).find(button=>button.textContent.includes('Limpar documentos')).click()");await waitFor("!document.querySelector('#legal-results-title') && document.querySelector('#legal-compare').disabled");};
  const setSelect=async(selector,value)=>evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(selector)});select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  denied=false;let mode='valid';const aiRequests=[];
  await cdp('Fetch.enable',{patterns:[{urlPattern:'*/api/legal/quota',requestStage:'Request'},{urlPattern:'*/api/legal/ai',requestStage:'Request'}]});
  socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method!=='Fetch.requestPaused'||!m.params.request.url.endsWith('/api/legal/ai'))return;const request=m.params.request;let body,status=200;
    if(request.method==='GET')body={available:true,authenticated:true,provider:'Fixture Cloudflare / reserva: Fixture Groq',privacyUrls:['https://developers.cloudflare.com/workers-ai/platform/data-usage/','https://console.groq.com/docs/your-data'],notice:'Fixture: optional review of selected excerpts, not the whole PDF.',limits:{sources:8,characters:6000,sourceCharacters:750,bytes:32768,points:10,timeout:48000}};
    else {const input=JSON.parse(request.postData);aiRequests.push(input);if(mode==='pending')return;if(mode==='failure'){status=503;body={error:'IA temporariamente indisponível. Resultados locais preservados.'};}else{const first=input.sources[0],quote=first.text.slice(0,Math.min(120,first.text.length));body={provider:'Fixture Cloudflare',model:'fixture-local-transport',calls:1,createdAt:new Date().toISOString(),points:[{text:quote,evidence:[{sourceId:first.id,quote}]}],warnings:['Teste com resposta controlada; citações conferidas na fonte selecionada.']};}}
    cdp('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')}).catch(e=>errors.push(e.message));
  });
  const runAI=async()=>{await waitFor("!!document.querySelector('[data-legal-ai-consent]')");assert.equal(await evaluate("document.querySelector('[data-legal-ai-run]').disabled"),true);await evaluate("document.querySelector('[data-legal-ai-consent]').click()");await waitFor("!document.querySelector('[data-legal-ai-run]').disabled");await evaluate("document.querySelector('[data-legal-ai-run]').click()");await waitFor("!!document.querySelector('.legal-ai-result') || !!document.querySelector('.legal-ai .legal-error')");};
  const tools=[['contractcheck-ai','suite-contrato.pdf'],['processo-timeline','suite-processo.pdf'],['juris-organize','suite-contrato.pdf'],['prazo-extractor','suite-processo.pdf'],['peticao-review','suite-peticao.pdf'],['prova-compare',null],['pdf-timemachine-juridico',null]];
  for(const [slug,file]of tools){await navigate('/ferramentas/'+slug);const previous=aiRequests.length;
    if(file){await selectFiles('[data-analysis-upload]',[path.join(fixtures,file)]);await waitFor("!document.querySelector('#legal-analyze').disabled");await evaluate("document.querySelector('#legal-analyze').click()");await waitFor("!!document.querySelector('#analysis-result-title')");}
    else{await upload('original.pdf','atualizado.pdf');await run();}
    await waitFor("!!document.querySelector('[data-legal-ai-run]')");assert.equal(aiRequests.length,previous,'No automatic AI upload');await runAI();assert.ok(await evaluate("document.querySelector('.legal-ai-result').innerText.includes('Fixture Cloudflare')"));assert.equal(aiRequests.length,previous+1);const payload=aiRequests.at(-1);assert.equal(payload.consent,true);assert.equal(payload.tool,slug);assert.ok(payload.sources.length<=8);assert.deepEqual(Object.keys(payload.sources[0]).sort(),['id','page','text']);
    if(slug==='contractcheck-ai'){
      const count=await evaluate("document.querySelector('#analysis-result-title').textContent");await evaluate("document.querySelector('.legal-ai-result button.text-link').click()");await waitFor("document.querySelector('.legal-viewer canvas')?.dataset.legalRendered==='true'");
      for(const format of ['txt','csv','docx','pdf']){await evaluate(`document.querySelector('[data-analysis-export="${format}"]').click()`);let bytes;const deadline=Date.now()+30000;while(Date.now()<deadline){try{bytes=await readFile(path.join(downloads,`contractcheck-ai-relatorio.${format}`));break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(bytes?.length);if(format==='txt'||format==='csv')assert.ok(bytes.toString('utf8').includes('Fixture Cloudflare'));if(format==='docx')assert.ok((await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')).includes('Fixture Cloudflare'));if(format==='pdf')assert.ok((await PDFDocument.load(bytes)).getPageCount()>0);}
      await evaluate("document.querySelector('.legal-ai-preview').open=true;document.querySelector('.legal-ai-preview input').click()");await waitFor("!document.querySelector('.legal-ai-result') && !document.querySelector('[data-legal-ai-consent]').checked");mode='failure';await runAI();assert.ok((await evaluate("document.querySelector('.legal-ai .legal-error').textContent")).includes('indisponível'));assert.equal(await evaluate("document.querySelector('#analysis-result-title').textContent"),count);
      mode='pending';await evaluate("document.querySelector('[data-legal-ai-run]').click()");await waitFor("Array.from(document.querySelectorAll('.legal-ai button')).some(b=>b.textContent==='Cancelar revisão de IA')");await evaluate("Array.from(document.querySelectorAll('.legal-ai button')).find(b=>b.textContent==='Cancelar revisão de IA').click()");await waitFor("document.querySelector('.legal-ai .legal-error').textContent.includes('cancelada')");mode='valid';
      for(const width of [320,390,768,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'AI overflow '+width);}await cdp('Emulation.clearDeviceMetricsOverride');
    }
    if(!file){await evaluate("document.querySelector('.legal-ai-result button.text-link').click()");await waitFor("Array.from(document.querySelectorAll('.legal-viewer canvas')).every(c=>c.dataset.legalRendered==='true')");assert.ok(await evaluate("!!document.querySelector('.legal-highlight')"));}
    console.log('PASS optional AI UI '+slug+': consent, excerpt-only request, citations, local results preserved');
  }
  assert.deepEqual(external,[]);assert.ok(posts.every(p=>p.url==='/api/legal/quota'||p.url==='/api/legal/ai'));assert.deepEqual(errors,[]);console.log('PASS AI controlled transport: report exports, cancellation, service failure, selection invalidation, mobile widths and no external browser requests');await send('Browser.close').catch(()=>{});
}finally{socket?.close();if(child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);}await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:500});}
