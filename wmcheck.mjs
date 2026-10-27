// Verificacao objetiva de marca d'agua: o texto realmente aparece na pagina renderizada?
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PNG } from "pngjs";

const run = promisify(execFile);
const Q = path.join(process.env.TEMP, "opencode", "quality");

async function textOf(pdf, label) {
  const dir = path.join(Q, `txt-${label}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const f = path.join(dir, "x.pdf");
  await writeFile(f, pdf);
  const { stdout } = await run("pdftotext", ["-layout", f, "-"], { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

async function pixels(pdf, label) {
  const dir = path.join(Q, `px-${label}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const f = path.join(dir, "x.pdf");
  await writeFile(f, pdf);
  await run("pdftoppm", ["-png", "-r", "100", "-f", "1", "-l", "1", f, path.join(dir, "p")]);
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".png"));
  const png = PNG.sync.read(await readFile(path.join(dir, names[0])));
  return png;
}

const base = await readFile(path.join(Q, "base3.pdf"));
const wm = await readFile(path.join(Q, "wm.pdf"));

console.log("=".repeat(70));
console.log("MARCA D'AGUA — o texto esta realmente no PDF?");
console.log("=".repeat(70));

const tBase = await textOf(base, "base");
const tWm = await textOf(wm, "wm");
console.log("");
console.log("1) TEXTO EXTRAIVEL (pdftotext)");
console.log("   original contem 'CONFIDENCIAL':", tBase.includes("CONFIDENCIAL"));
console.log("   com marca contem 'CONFIDENCIAL':", tWm.includes("CONFIDENCIAL"));
if (tWm.includes("CONFIDENCIAL")) {
  const line = tWm.split("\n").find((l) => l.includes("CONFIDENCIAL"));
  console.log("   linha encontrada:", JSON.stringify(line));
}

console.log("");
console.log("2) DIFERENCA DE PIXELS (o visual mudou?)");
const pBase = await pixels(base, "base");
const pWm = await pixels(wm, "wm");
let diff = 0;
const total = Math.min(pBase.data.length, pWm.data.length) / 4;
for (let i = 0; i < Math.min(pBase.data.length, pWm.data.length); i += 4) {
  const d = Math.abs(pBase.data[i] - pWm.data[i]) + Math.abs(pBase.data[i + 1] - pWm.data[i + 1]) + Math.abs(pBase.data[i + 2] - pWm.data[i + 2]);
  if (d > 30) diff++;
}
console.log(`   pixels diferentes: ${diff} de ${total} (${((diff / total) * 100).toFixed(2)}%)`);
console.log("   dimensoes:", pBase.width + "x" + pBase.height, "->", pWm.width + "x" + pWm.height);

console.log("");
console.log("3) CONCLUSao");
const hasInText = tWm.includes("CONFIDENCIAL");
const hasInPixels = diff > 100;
if (hasInPixels && hasInText) console.log("   OK: a marca aparece visual E no texto.");
else if (hasInPixels && !hasInText) console.log("   OK: a marca aparece VISUALMENTE (desenhada como vetor, sem texto extraivel).");
else if (!hasInPixels && hasInText) console.log("   SUSPEITO: texto presente mas renderizacao identica.");
else console.log("   BUG: a marca d'agua NAO aparece de forma alguma.");
