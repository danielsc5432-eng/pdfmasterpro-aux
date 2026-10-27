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
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only run this development smoke test locally");
  const fixtures = path.resolve(".vercel/review/clonemaster");
  const model = path.join(fixtures, "configuracao.txt");
  const source = process.env.CLONEMASTER_XLSX_FIXTURE || path.join(fixtures, "funcionarios.xlsx");
  const posts = [];
  let quotaDenied = true;
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/clonemaster/quota", requestStage: "Request" }] });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method !== "Fetch.requestPaused") return;
    const request = message.params.request;
    assert.equal(request.method, "POST"); assert.ok(!request.postData, "Quota reservation must not contain document bytes");
    cdp("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: quotaDenied ? 429 : 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(quotaDenied ? { error: "A cota de 10 tarefas gratuitas foi atingida." } : { authorized: true, limit: 10 })).toString("base64") }).catch(error => errors.push(error.message));
  });
  socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); if (message.method === "Network.requestWillBeSent" && message.params.request.method === "POST") posts.push(new URL(message.params.request.url).pathname); });
  await cdp("Network.enable");
  await navigate("/ferramentas/clonemaster-ai");
  await waitFor("!!document.querySelector('#clone-analyze')");
  await selectFiles('[data-clone-upload="models"]', [model]);
  await waitFor("!!document.querySelector('#clone-model') && !document.querySelector('#clone-analyze').textContent.includes('Lendo')");
  await selectFiles('[data-clone-upload="sources"]', [source]);
  await waitFor("!document.querySelector('#clone-analyze').disabled");
  await evaluate("document.querySelector('#clone-analyze').click()");
  await waitFor("!!document.querySelector('.clone-interpretation')");
  assert.equal(await evaluate("document.querySelector('[data-clone-column]').value"), "C");
  assert.equal(await evaluate("document.querySelector('[data-clone-field]').value"), "field-2");
  await evaluate("document.querySelector('#clone-review').click()");
  await waitFor("!!document.querySelector('.clone-before-after')");
  assert.ok(await evaluate("document.querySelector('.clone-changes').textContent.includes('4500')"));
  await evaluate("(()=>{const select=document.querySelector('[data-clone-preview-row]');select.value='3';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelector('.clone-changes').textContent.includes('3200')");
  await evaluate("(()=>{const select=document.querySelector('[data-clone-preview-row]');select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelector('.clone-changes').textContent.includes('4500')");
  assert.equal(await evaluate("document.querySelector('#clone-generate').disabled"), true);
  await evaluate("document.querySelector('#clone-confirm').click()");
  await evaluate("document.querySelector('#clone-generate').click()");
  await waitFor("document.querySelector('.clone-error')?.textContent.includes('cota de 10')");
  assert.equal(await evaluate("!!document.querySelector('#clone-zip')"), false);
  assert.equal(await evaluate("document.querySelectorAll('.clone-results a[download]').length"), 0);
  quotaDenied = false;
  await evaluate("document.querySelector('#clone-generate').click()");
  await waitFor("!!document.querySelector('#clone-zip')", 30000);
  const original = await readFile(model, "utf8");
  const outputs = await evaluate("Promise.all(Array.from(document.querySelectorAll('.clone-results a[download]:not(#clone-zip)')).map(async a=>({name:a.download,bytes:Array.from(new Uint8Array(await(await fetch(a.href)).arrayBuffer()))})))");
  assert.equal(outputs.length, 3);
  for (const [index, salary] of [4500, 3200, 5800].entries()) {
    assert.equal(outputs[index].name, `funcionario_${String(index + 1).padStart(3, "0")}.txt`);
    assert.deepEqual(Buffer.from(outputs[index].bytes), Buffer.from(original.replace("salario=2500", "salario=" + salary)));
  }
  const zipBytes = await evaluate("fetch(document.querySelector('#clone-zip').href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))");
  const zip = await JSZip.loadAsync(new Uint8Array(zipBytes));
  assert.equal(Object.keys(zip.files).length, 3);
  console.log("PASS browser worker: actual XLSX + command + selected field -> three exact TXT files, byte-preserved originals, valid ZIP and explicit confirmation");
  await evaluate("(()=>{const input=document.querySelector('#clone-first');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'3');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor("!document.querySelector('#clone-zip') && !document.querySelector('#clone-confirm')");
  assert.equal(await evaluate("document.querySelector('#clone-first').value"), "3");
  console.log("PASS edited options invalidate previews, confirmation and stale downloads");
  for (const width of [320, 390, 768, 920, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: width < 700 });
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "CloneMaster overflow at " + width);
    if (process.env.SMOKE_SCREENSHOT_DIR && [390, 1440].includes(width)) {
      await mkdir(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
      const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(process.env.SMOKE_SCREENSHOT_DIR, `clonemaster-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
  }
  await cdp("Emulation.clearDeviceMetricsOverride");
  await evaluate("Array.from(document.querySelectorAll('.clone-actions button')).find(b=>b.textContent.includes('Limpar')).click()");
  await waitFor("!document.querySelector('#clone-model')");
  await selectFiles('[data-clone-upload="models"]', [model]);
  await waitFor("!!document.querySelector('#clone-model')");
  await selectFiles('[data-clone-upload="sources"]', [path.join(fixtures, "500-registros.xlsx")]);
  await waitFor("!document.querySelector('#clone-analyze').disabled");
  await evaluate("document.querySelector('#clone-analyze').click()");
  await waitFor("document.querySelector('[data-clone-column]').value === 'C'");
  await evaluate("document.querySelector('#clone-review').click()");
  await waitFor("!!document.querySelector('#clone-confirm')");
  await evaluate("document.querySelector('#clone-confirm').click()");
  await waitFor("!document.querySelector('#clone-generate').disabled");
  await evaluate("document.querySelector('#clone-generate').click()");
  await waitFor("!!document.querySelector('.clone-progress')");
  await evaluate("document.querySelector('.clone-progress button').click()");
  await waitFor("!document.querySelector('.clone-progress') && document.querySelector('.clone-error')?.textContent.includes('cancelada')");
  assert.equal(await evaluate("!!document.querySelector('#clone-zip')"), false);
  console.log("PASS cancellation of a 500-record workflow removes its results");
  assert.ok(posts.length >= 2); assert.ok(posts.every(route => route === "/api/clonemaster/quota"), "Only quota reservations are sent; document contents must never be uploaded by CloneMaster");
  assert.deepEqual(errors, [], "Uncaught browser errors");
  console.log("PASS no document upload requests, no uncaught exceptions, five responsive widths and local session cleanup");
  await send("Browser.close").catch(() => undefined);
} finally {
  socket?.close();
  if (child.exitCode === null) { child.kill(); await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]); }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
