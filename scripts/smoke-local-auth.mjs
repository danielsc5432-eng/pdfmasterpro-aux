import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

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


  assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
  const requests=[];
  await cdp('Fetch.enable',{patterns:[{urlPattern:'*/api/auth/local/*',requestStage:'Request'}]});
  socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method!=='Fetch.requestPaused')return;const req=m.params.request;requests.push({url:req.url,body:JSON.parse(req.postData)});const register=req.url.endsWith('/register');cdp('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:register?200:401,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(register?{pending:true,message:'Codigo enviado para teste de interface.'}:{error:'Codigo ou senha invalidos no teste.'})).toString('base64')}).catch(e=>errors.push(e.message));});
  const fill=async(selector,value)=>{await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');await new Promise(r=>setTimeout(r,90));};
  const submit=()=>evaluate('document.querySelector(".local-auth-form").requestSubmit()');
  await navigate('/criar-conta');await waitFor('!!document.querySelector("#local-name")');
  for(const width of [390,768,1440]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'));}
  await fill('#local-name','Pessoa Teste');await fill('#local-email','test@example.com');await fill('#local-password','Minha frase de acesso 123');await fill('#local-confirm','Outra frase diferente 123');
  await evaluate('document.querySelector(".local-auth-terms input").click()');await submit();await waitFor('!!document.querySelector(".local-auth-error")');assert.equal(requests.length,0);
  await fill('#local-confirm','Minha frase de acesso 123');await submit();await waitFor('!!document.querySelector("#local-code")');assert.equal(requests[0].body.name,'Pessoa Teste');assert.equal(requests[0].body.terms,true);assert.equal(await evaluate('!!document.querySelector("#local-password")'),false);
  await fill('#local-code','123456');await submit();await waitFor('!!document.querySelector(".local-auth-error")');assert.equal(requests[1].body.code,'123456');assert.equal('password' in requests[1].body,false);
  await evaluate('document.querySelector(".local-auth-form button.text-link").click()');await waitFor('!!document.querySelector("#local-name")');assert.equal(await evaluate('document.querySelector("#local-password").value'),'');
  await navigate('/entrar');await waitFor('!!document.querySelector("#local-password")');assert.equal(await evaluate('!!document.querySelector("#local-name")'),false);await fill('#local-email','test@example.com');await fill('#local-password','Minha frase de acesso 123');await submit();await waitFor('!!document.querySelector(".local-auth-error")');assert.ok(requests.at(-1).url.endsWith('/login'));
  assert.deepEqual(errors,[]);console.log('PASS browser UI with controlled API responses: signup fields, password mismatch, verification screen, code failure, correction, login, three widths and zero uncaught errors');
  await send('Browser.close').catch(()=>undefined);
} finally {
  socket?.close();
  if (child.exitCode === null) { child.kill(); await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]); }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
