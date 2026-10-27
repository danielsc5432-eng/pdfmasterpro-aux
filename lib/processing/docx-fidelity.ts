import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { commandExists, execFile } from "./system";
import { extractionPdf } from "./pdf-visible-text";

export type FidelityReport = { sourcePages: number; outputPages: number; sameDimensions: boolean; textCoverage: number; numberCoverage: number; numberPrecision: number; renderedNumberCoverage: number; renderedNumberPrecision: number; renderedTextCoverage?: number; numberPositionCoverage?: number; visualSimilarity: number; worstPageSimilarity: number; ocrReview: boolean };

export function fidelityScore(report: FidelityReport): number {
  return report.textCoverage * 20 + report.numberCoverage * 35 + (report.renderedTextCoverage ?? report.textCoverage)*10 + (report.numberPositionCoverage??1)*5 + report.visualSimilarity * 15 + report.worstPageSimilarity * 5 + (report.sourcePages === report.outputPages ? 8 : 0) + (report.sameDimensions ? 2 : 0);
}

export function fidelityStatus(report: FidelityReport | null): "checked" | "review" | "unavailable" {
  if (!report) return "unavailable";
  return report.sourcePages === report.outputPages && report.sameDimensions && report.textCoverage >= 0.98 && (report.renderedTextCoverage ?? report.textCoverage)>=0.98 && (report.numberPositionCoverage??1)>=0.98 && report.numberCoverage === 1 && report.numberPrecision === 1 && report.renderedNumberCoverage === 1 && report.renderedNumberPrecision === 1 && report.visualSimilarity >= 0.9 && report.worstPageSimilarity >= 0.8 && !report.ocrReview ? "checked" : "review";
}

export function unsafeFidelity(report: FidelityReport): boolean {
  return report.sourcePages !== report.outputPages || !report.sameDimensions || report.textCoverage < 0.9 || report.numberCoverage < 1 || report.visualSimilarity < 0.5 || report.worstPageSimilarity < 0.2 || (!report.ocrReview && ((report.renderedTextCoverage ?? report.textCoverage) < 0.9 || report.numberPrecision < 1 || report.renderedNumberCoverage < 1 || report.renderedNumberPrecision < 1));
}

export function betterFidelity(candidate: FidelityReport, current: FidelityReport): boolean {
  if (unsafeFidelity(candidate) !== unsafeFidelity(current)) return !unsafeFidelity(candidate);
  if ((fidelityStatus(candidate)==="checked") !== (fidelityStatus(current)==="checked")) return fidelityStatus(candidate)==="checked";
  return fidelityScore(candidate) > fidelityScore(current);
}

export async function checkDocxFidelity(input: Uint8Array, docx: Uint8Array, budget = 90000): Promise<FidelityReport | null> {
  if (budget < 5000) return null;
  const deadline = Date.now() + budget;
  const python = process.env.PDF_TO_WORD_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const candidates = [process.env.SOFFICE_CONVERTER, "soffice", "libreoffice", ...(process.platform === "win32" ? ["C:/Program Files/LibreOffice/program/soffice.exe"] : [])].filter((value): value is string => Boolean(value));
  let converter: string | undefined;
  for (const candidate of candidates) if (await commandExists(candidate)) { converter = candidate; break; }
  if (!converter || !(await commandExists(python))) return null;
  const directory = await mkdtemp(path.join(os.tmpdir(), "pdfmaster-fidelity-"));
  try {
    const source = path.join(directory, "source.pdf"), word = path.join(directory, "result.docx"), rendered = path.join(directory, "result.pdf");
    await writeFile(source, await extractionPdf(input));
    await writeFile(word, docx);
    await execFile(converter, [`-env:UserInstallation=${pathToFileURL(path.join(directory, "profile")).href}`, "--headless", "--convert-to", "pdf:writer_pdf_Export", "--outdir", directory, word], { timeout: Math.max(1,Math.min(60000,deadline-Date.now())), windowsHide: true, maxBuffer: 1024 * 1024 });
    // Ensure the export exists before attempting comparison.
    await readFile(rendered);
    const { stdout } = await execFile(python, [path.join(process.cwd(), "scripts", "pdf-fidelity.py"), source, rendered, "--docx", word], { timeout: Math.max(1,Math.min(45000,deadline-Date.now())), windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" } });
    const report = JSON.parse(stdout) as FidelityReport;
    const metrics = [report.textCoverage, report.numberCoverage, report.numberPrecision, report.renderedNumberCoverage, report.renderedNumberPrecision, report.renderedTextCoverage, report.numberPositionCoverage, report.visualSimilarity, report.worstPageSimilarity];
    if (!metrics.every(value=>typeof value === "number" && Number.isFinite(value) && value>=0 && value<=1) || !Number.isInteger(report.sourcePages) || !Number.isInteger(report.outputPages) || report.sourcePages<1 || report.outputPages<1) return null;
    return report;
  } catch {
    return null;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
