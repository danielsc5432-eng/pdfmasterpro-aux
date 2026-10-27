import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
let api: Promise<typeof import("pdfjs-dist")> | null = null;
export function pdfApi() {
  return api ||= import("pdfjs-dist").then(module => { module.GlobalWorkerOptions.workerSrc = "/legal-assets/pdfjs/pdf.worker.min.mjs"; return module; });
}
export async function loadLegalPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<{ task: PDFDocumentLoadingTask; document: PDFDocumentProxy }> {
  const pdfjs = await pdfApi();
  signal?.throwIfAborted();
  const task = pdfjs.getDocument({ data: bytes, verbosity: 0, enableXfa: false, useSystemFonts: false, stopAtErrors: true, disableAutoFetch: true, maxImageSize: 16000000, cMapUrl: "/legal-assets/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/legal-assets/pdfjs/standard_fonts/", wasmUrl: "/legal-assets/pdfjs/wasm/", iccUrl: "/legal-assets/pdfjs/iccs/", isOffscreenCanvasSupported: false });
  const cancel = () => { void task.destroy(); }; signal?.addEventListener("abort",cancel,{once:true});
  try { return { task, document: await task.promise }; }
  catch (error) { await task.destroy(); if (error instanceof Error && error.name === "PasswordException") throw Error("PDF protegido por senha. Envie uma cópia desbloqueada autorizada."); if(error instanceof Error&&["InvalidPDFException","UnexpectedResponseException","UnknownErrorException"].includes(error.name))throw Error("Não foi possível abrir este PDF. Ele pode estar corrompido, incompleto ou usar recursos não suportados."); throw error; }
  finally { signal?.removeEventListener("abort",cancel); }
}
