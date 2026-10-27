import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { commandExists, execFile } from "./system";
import { extractionPdf } from "./pdf-visible-text";

/** Native structural conversion, isolated from sessions, credentials and the DB. */
export async function structuralPdfToDocx(input: Uint8Array, timeout = 240000) {
  const python = process.env.PDF_TO_WORD_PYTHON || (process.platform === "win32" ? "python" : "python3");
  if (!(await commandExists(python))) throw new Error("O motor de tabelas editáveis não está configurado neste servidor. Selecione preservar layout.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "pdfmaster-pdf2docx-"));
  try {
    const source = path.join(directory, "input.pdf"), output = path.join(directory, "output.docx");
    await writeFile(source, await extractionPdf(input));
    try {
      await execFile(python, [path.join(process.cwd(), "scripts", "pdf2docx-convert.py"), source, output], { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1" } });
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr || "");
      if (stderr.includes("PDF digitalizado")) throw new Error("Este PDF precisa de OCR. Selecione o modo preservar layout para reconhecer o texto digitalizado.");
      throw new Error("O motor de tabelas não conseguiu concluir a conversão. Tente o modo preservar layout.");
    }
    const bytes = await readFile(output);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml || !/<w:t(?:\s[^>]*)?>[^<\s]/.test(xml)) throw new Error("O motor de tabelas não produziu texto editável. Tente o modo preservar layout.");
    return new Uint8Array(bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export type ConversionProfile={mode:"layout"|"tables";primary:"layout"|"page-grid"|"native"|"tables";scan:boolean};
export async function inspectConversionProfile(input: Uint8Array): Promise<ConversionProfile> {
  const python = process.env.PDF_TO_WORD_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const directory = await mkdtemp(path.join(os.tmpdir(), "pdfmaster-inspect-"));
  try {
    const source = path.join(directory, "input.pdf");
    await writeFile(source, await extractionPdf(input));
    const { stdout } = await execFile(python, [path.join(process.cwd(), "scripts", "pdf2docx-convert.py"), source, "--analyze"], { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout) as { mode?: string;primary?:string;reason?:string };
    const mode=result.mode==="tables"?"tables":"layout";
    const primary=["layout","page-grid","native","tables"].includes(result.primary??"")?result.primary as ConversionProfile["primary"]:mode;
    return {mode,primary,scan:result.reason==="scan"};
  } catch {
    return {mode:"layout",primary:"layout",scan:false};
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function inspectConversionMode(input:Uint8Array):Promise<"layout"|"tables">{return(await inspectConversionProfile(input)).mode;}
