import { NextResponse } from "next/server";
import { summaryOptionsSchema, summaryResultSchema, SUMMARY_LIMITS, type SummaryEvent } from "./types";
import { summaryConfig } from "./provider";
import { extractSummary } from "./extract";
import { summarizeExtracted } from "./engine";

const encoder = new TextEncoder();
export const eventBytes = (event: SummaryEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
export function summaryStream(bytes: Uint8Array, name: string, rawOptions: unknown, requestSignal: AbortSignal) {
  const options = summaryOptionsSchema.parse(rawOptions); const config = summaryConfig();
  if (!config.url || !config.standard || (options.mode === "advanced" && !config.advanced)) throw Error("O modo de IA selecionado não está configurado.");
  const cancelled = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancelled.signal, AbortSignal.timeout(SUMMARY_LIMITS.durationMs)]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: SummaryEvent) => { if (!closed && !signal.aborted) controller.enqueue(eventBytes(event)); };
      const pulse = setInterval(() => { if (!closed && !signal.aborted) { try { controller.enqueue(encoder.encode(": aguardando processamento\n\n")); } catch { closed = true; } } }, 10000);
      try {
        emit({ type: "progress", stage: "extracting", message: "Extraindo o texto e verificando a necessidade de OCR. Essa etapa não possui percentual estimado." });
        const extracted = await extractSummary(bytes, options, signal);
        const result = await summarizeExtracted({ name, ...extracted }, options, signal, emit);
        signal.throwIfAborted(); emit({ type: "result", result });
      } catch (error) {
        if (!closed && !cancelled.signal.aborted && !requestSignal.aborted) {
          const message = signal.aborted ? "O resumo excedeu o tempo disponível. Selecione menos páginas e tente novamente." : error instanceof Error && (/^(O |A |As |Envie |Use |Uma |Não |Selecione )/.test(error.message)) ? error.message : "Não foi possível concluir o resumo. Verifique o arquivo, o provedor e tente novamente.";
          try { controller.enqueue(eventBytes({ type: "error", message })); } catch { /* Client already disconnected. */ }
        }
      } finally { clearInterval(pulse); closed = true; try { controller.close(); } catch { /* Already cancelled. */ } }
    },
    cancel() { cancelled.abort(); },
  });
  return new NextResponse(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" } });
}

export function trackSummaryStream(body: ReadableStream<Uint8Array>, completed: () => Promise<void>, failed: () => Promise<void>, abort: () => void) {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = "", result = false, error = false, size = 0, settled = false;
  async function finish(ok: boolean) { if (settled) return; settled = true; await (ok ? completed() : failed()).catch(() => {}); }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const part = await reader.read();
        if (part.done) { await finish(result && !error && !buffer.trim()); controller.close(); return; }
        size += part.value.length;
        if (size > 512 * 1024) throw Error("Summary stream limit");
        buffer += decoder.decode(part.value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          if (frame.startsWith("data: ")) { const event = JSON.parse(frame.slice(6)); if (event.type === "result") { if (result || !summaryResultSchema.safeParse(event.result).success) throw Error("Invalid summary result"); result = true; } if (event.type === "error") error = true; }
        }
        controller.enqueue(part.value);
      } catch (reason) { abort(); await reader.cancel().catch(() => {}); await finish(false); controller.error(reason); }
    },
    async cancel() { abort(); await reader.cancel().catch(() => {}); await finish(false); },
  });
}
