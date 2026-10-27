import path from "node:path";
import { z } from "zod";
import { execFile } from "@/lib/processing/system";
import { withNativeJob } from "@/lib/processing/native-job";
import { requestedPages, selectedPages, SUMMARY_LIMITS, type SummaryOptions, type SummaryPage } from "./types";

const pageSchema = z.object({ number: z.number().int().min(1).max(120), text: z.string().max(12000), ocr: z.boolean(), warning: z.string().max(300).optional() }).strict();
export async function extractSummary(input: Uint8Array, options: SummaryOptions, signal: AbortSignal, ocr = true): Promise<{ totalPages: number; pages: SummaryPage[] }> {
  signal.throwIfAborted();
  const selection = requestedPages(options);
  // Parse in the bounded native child, not in the frontend's Node process.
  const raw = await withNativeJob(input, "pdf", async ({ inputPath }) => {
    const python = process.env.PDF_TO_WORD_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const { stdout } = await execFile(python, [path.join(process.cwd(), "scripts/extract-summary.py"), inputPath, selection, ocr ? "1" : "0"], { timeout: 45000, signal, windowsHide: true, maxBuffer: 3 * 1024 * 1024, env: { ...process.env, OMP_NUM_THREADS: "1", OMP_THREAD_LIMIT: "1" } });
    return JSON.parse(stdout);
  });
  const errors: Record<string, string> = { protected: "O PDF está protegido por senha. Envie uma cópia desbloqueada autorizada.", pages: "Envie um PDF de 1 a 120 páginas.", selection: "O intervalo de páginas é inválido ou inclui páginas inexistentes.", characters: "O texto excede os limites deste fluxo. Selecione menos páginas antes de resumir.", unreadable: "O PDF está corrompido ou não pôde ser analisado." };
  if (raw.error) throw Error(errors[raw.error] || errors.unreadable);
  const parsed = z.object({ totalPages: z.number().int().min(1).max(SUMMARY_LIMITS.pages), pages: z.array(pageSchema).min(1).max(SUMMARY_LIMITS.pages) }).strict().parse(raw);
  const expected = selectedPages(selection, parsed.totalPages);
  if (parsed.pages.some((page, index) => page.number !== expected[index]) || parsed.pages.length !== expected.length || parsed.pages.reduce((sum, page) => sum + page.text.length, 0) > SUMMARY_LIMITS.characters) throw Error("A extração retornou páginas incompletas ou excedeu o limite de texto.");
  if (!parsed.pages.some(page => page.text.trim())) throw Error("Não foi possível extrair texto. O PDF está vazio ou necessita de OCR disponível no servidor.");
  return parsed;
}
