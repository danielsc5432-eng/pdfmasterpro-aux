"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UploadCloud, Sparkles, FileText, X, Copy, Download, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { SUMMARY_LIMITS, summaryResultSchema, type SummaryCapabilities, type SummaryEvent, type SummaryOptions, type SummaryResult } from "@/lib/summary/types";
import { takeQueuedFiles } from "@/lib/pending-files";
import "./workspace.css";

export function SummaryWorkspace() {
  const [file, setFile] = useState<File | null>(null), [caps, setCaps] = useState<SummaryCapabilities | null>(null);
  const [length, setLength] = useState<SummaryOptions["length"]>("medium"), [mode, setMode] = useState<SummaryOptions["mode"]>("standard");
  const [instructions, setInstructions] = useState(""), [pages, setPages] = useState(""), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Extract<SummaryEvent, { type: "progress" }> | null>(null);
  const [result, setResult] = useState<SummaryResult | null>(null), [edited, setEdited] = useState(""), [original, setOriginal] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null), abort = useRef<AbortController | null>(null), capsAbort = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  useEffect(() => { const queued = takeQueuedFiles(); if (queued.length) add(queued); void loadCaps(); return () => { abort.current?.abort(); capsAbort.current?.abort(); }; }, []); // Files remain only in this page's memory.
  useEffect(() => { if (!result) return; const timer = setTimeout(() => { setResult(null); setEdited(""); setOriginal(""); setFile(null); setConsent(false); setNotice("A sessão do resumo expirou após 30 minutos. Envie o PDF novamente."); }, Math.max(0, Date.parse(result.expiresAt) - Date.now())); return () => clearTimeout(timer); }, [result]);
  async function loadCaps() {
    capsAbort.current?.abort(); const controller = new AbortController(); capsAbort.current = controller; setLoading(true);
    try { const response = await fetch("/api/summary/capabilities", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }); if (!response.ok) throw Error(); const data = await response.json(); if (typeof data.available !== "boolean" || !data.models || !data.limits) throw Error(); setCaps(data); }
    catch { if (!controller.signal.aborted) setCaps({ available: false, provider: "Não consultado", models: { standard: null, advanced: null }, limits: SUMMARY_LIMITS, ocr: false, authenticated: false, jobsPerDay: 3, costNotice: "", warning: "Não foi possível consultar o serviço. Atualize o status para tentar novamente." }); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function add(files: File[] | FileList | null) {
    if (!files || !files.length || busy) return;
    if (files.length !== 1) { setError("Selecione somente um PDF por resumo."); return; }
    const item = files[0];
    if (!/\.pdf$/i.test(item.name) || (item.type && item.type !== "application/pdf") || !item.size || item.size > SUMMARY_LIMITS.uploadBytes) { setError("Envie um PDF não vazio de até 4 MB."); return; }
    setFile(item); setResult(null); setEdited(""); setOriginal(""); setConsent(false); setError(""); setNotice("");
  }
  function clear() { abort.current?.abort(); requestNumber.current++; setBusy(false); setFile(null); setResult(null); setEdited(""); setOriginal(""); setConsent(false); setProgress(null); setError(""); setNotice(""); }
  async function run() {
    if (!file || !consent || busy || !caps?.available || !caps.models[mode]) return;
    if (!caps.authenticated) { setError("Entre na sua conta e atualize o status antes de resumir."); return; }
    setBusy(true); setError(""); setNotice(""); setResult(null); setEdited(""); setOriginal("");
    const controller = new AbortController(); abort.current = controller; const number = ++requestNumber.current;
    setProgress({ type: "progress", stage: "validating", message: "Enviando e validando o PDF. O percentual de envio não é estimado." });
    let received: SummaryResult | null = null;
    try {
      const form = new FormData(); form.append("files", file); form.append("options", JSON.stringify({ length, mode, instructions, pages, consent }));
      const response = await fetch("/api/v1/process?tool=resumir-pdf-ia", { method: "POST", body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(250000)]) });
      if (!response.ok) { const data = await response.json(); throw Error(data.error || "Não foi possível iniciar o resumo."); }
      if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw Error("O processador não retornou o fluxo de progresso esperado.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "", size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 512 * 1024) throw Error("O resultado excedeu o limite seguro.");
          buffer += decoder.decode(part.value, { stream: true }); let index;
          while ((index = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2); if (!frame.startsWith("data: ")) continue;
            const event = JSON.parse(frame.slice(6)) as SummaryEvent;
            if (event.type === "error") throw Error(event.message);
            if (event.type === "progress" && number === requestNumber.current) setProgress(event);
            if (event.type === "result") { if (received) throw Error("O processador retornou resultados duplicados."); received = summaryResultSchema.parse(event.result); }
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!received || buffer.trim()) throw Error("O resumo foi interrompido antes da conclusão. Nenhum resultado parcial foi apresentado.");
      if (number !== requestNumber.current) return;
      const { summaryText } = await import("@/lib/summary/export"); const text = summaryText(received); setResult(received); setEdited(text); setOriginal(text);
    } catch (reason) { if (number === requestNumber.current) setError(controller.signal.aborted ? "Resumo cancelado. Nenhum resultado parcial foi entregue." : reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "O tempo disponível foi excedido. Tente menos páginas."); }
    finally { if (number === requestNumber.current) { setBusy(false); setProgress(null); abort.current = null; } }
  }
  async function download(format: "txt" | "pdf" | "docx") {
    if (!result || !edited.trim() || exporting) return; setExporting(true); setError("");
    try {
      const exporter = await import("@/lib/summary/export"); const changed = edited !== original; let bytes: Uint8Array | string;
      if (format === "pdf") { const font = await fetch("/fonts/NotoSans-Regular.ttf", { cache: "force-cache" }); if (!font.ok) throw Error("Não foi possível carregar a fonte do PDF. Use TXT ou DOCX."); bytes = await exporter.summaryPdf(result, edited, changed, new Uint8Array(await font.arrayBuffer())); }
      else bytes = format === "docx" ? await exporter.summaryDocx(result, edited, changed) : exporter.exportText(result, edited, changed);
      const url = URL.createObjectURL(new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], { type: format === "pdf" ? "application/pdf" : format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `resumo-pdfmasterpro.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha na exportação."); } finally { setExporting(false); }
  }
  return <section className="summary-workspace" aria-labelledby="summary-title">
    <div className="summary-heading"><span className="eyebrow"><Sparkles size={14} /> ResumoMaster AI</span><h2 id="summary-title">Do documento aos pontos essenciais.</h2><p>Um PDF por vez, com citações para você conferir.</p></div>
    <div className={`summary-dropzone ${dragging ? "dragging" : ""}`} role="button" tabIndex={busy ? -1 : 0} aria-label="Selecionar PDF para resumir" aria-disabled={busy} onClick={() => !busy && input.current?.click()} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (!busy) input.current?.click(); } }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); add(event.dataTransfer.files); }}><input ref={input} data-summary-file type="file" accept="application/pdf,.pdf" hidden onChange={event => { add(event.target.files); event.target.value = ""; }} disabled={busy} /><UploadCloud size={34} /><strong>Selecione ou arraste um PDF</strong><span>Até 4 MB · 120 páginas · 60.000 caracteres extraídos</span></div>
    {file && <div className="summary-file"><FileText size={20} /><span>{file.name}<small>{(file.size / 1024).toFixed(1)} KB</small></span><button type="button" className="icon-button" aria-label="Remover PDF" onClick={clear} disabled={busy}><X size={18} /></button></div>}
    <fieldset className="summary-options" disabled={busy}><legend>Como você quer o resumo?</legend><div><span className="summary-label">Tamanho</span><div className="summary-segments">{([['short','Curto','Até 5 tópicos'],['medium','Médio','Até 10 tópicos'],['long','Longo','Até 18 tópicos']] as const).map(([value,label,help]) => <label key={value} className={length === value ? "selected" : ""}><input type="radio" name="summary-length" value={value} checked={length === value} onChange={() => { setLength(value); setConsent(false); }} /><strong>{label}</strong><small>{help}</small></label>)}</div></div><div><span className="summary-label">Processamento</span><div className="summary-segments">{([['standard','IA padrão'],['advanced','IA avançada']] as const).map(([value,label]) => <label key={value} className={`${mode === value ? "selected" : ""} ${!caps?.models[value] ? "unavailable" : ""}`}><input type="radio" name="summary-mode" value={value} checked={mode === value} disabled={!caps?.models[value]} onChange={() => { setMode(value); setConsent(false); }} /><strong>{label}</strong><small>{caps?.models[value] || "Não configurada"}</small></label>)}</div><small>O modo avançado só fica disponível com outro modelo configurado.</small></div><label htmlFor="summary-pages">Páginas <small>Opcional — exemplo: 1-5, 8, 10-20</small></label><input id="summary-pages" value={pages} maxLength={300} placeholder="Todas as páginas dentro dos limites" onChange={event => { setPages(event.target.value); setConsent(false); }} /><label htmlFor="summary-instructions">Instruções personalizadas <small>Opcional</small></label><textarea id="summary-instructions" value={instructions} maxLength={1200} rows={3} placeholder="Destaque os prazos, valores e responsáveis." onChange={event => { setInstructions(event.target.value); setConsent(false); }} /></fieldset>
    <div className="summary-service"><div><strong>{loading ? "Consultando o processador…" : caps?.available ? `Provedor: ${caps.provider}` : "IA ainda não disponível"}</strong><p>{caps?.warning || caps?.costNotice || "A ferramenta não gera resultados fictícios enquanto o provedor não estiver configurado."}</p>{(caps?.privacyUrl === "https://console.groq.com/docs/your-data" || caps?.privacyUrl === "https://ollama.com/privacy" || caps?.privacyUrl === "https://developers.cloudflare.com/workers-ai/platform/data-usage/") && <p><a className="text-link" href={caps.privacyUrl} target="_blank" rel="noreferrer">Tratamento de dados pelo provedor</a></p>}{caps?.fallbackPrivacyUrl && ["https://console.groq.com/docs/your-data", "https://ollama.com/privacy", "https://developers.cloudflare.com/workers-ai/platform/data-usage/"].includes(caps.fallbackPrivacyUrl) && <p><a className="text-link" href={caps.fallbackPrivacyUrl} target="_blank" rel="noreferrer">Tratamento de dados pela IA de reserva</a></p>}<small>{caps?.jobsPerDay || 3} tentativas de resumo por janela de 24 horas, além dos limites do seu plano. Cada nova geração consome outra tentativa. OCR: {caps?.ocr ? "disponível, até 10 páginas por tarefa" : "não confirmado neste processador"}.</small></div><button className="button button-ghost" type="button" onClick={loadCaps} disabled={loading || busy}><RefreshCw size={15} /> Atualizar status</button></div>
    {caps && !caps.authenticated && <p className="summary-login"><Link href="/entrar">Entre na sua conta</Link> para resumir PDFs. Depois, atualize o status nesta página.</p>}
    <label className="summary-consent"><input id="summary-consent" type="checkbox" checked={consent} disabled={busy || !caps?.available} onChange={event => setConsent(event.target.checked)} /><span>Autorizo o envio do PDF ao processador do PDF Master Pro e do texto extraído das páginas escolhidas ao provedor {caps?.provider || "de IA informado acima"} para gerar este resumo. Não enviarei documentos sem autorização. <Link href="/privacidade">Privacidade</Link></span></label>
    <div className="summary-actions"><button id="summary-run" className="button button-primary" type="button" onClick={run} disabled={busy || !file || !consent || !caps?.available || !caps.models[mode] || !caps.authenticated}><Sparkles size={17} /> {busy ? "Resumindo…" : result ? "Gerar novamente" : "Resumir PDF"}</button>{busy && <button className="button button-ghost" type="button" onClick={() => abort.current?.abort()}>Cancelar</button>}<button className="button button-ghost" type="button" onClick={clear} disabled={busy}>Limpar sessão</button></div>
    {busy && progress && <div className="summary-progress" role="status"><p>{progress.message}</p>{progress.total ? <progress aria-label="Trechos realmente concluídos" max={progress.total} value={progress.current || 0} /> : <progress aria-label="Etapa em andamento" />}</div>}
    {error && <div className="alert alert-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}{notice && <p role="status">{notice}</p>}
    {result && <div className="summary-result"><div className="summary-result-heading"><CheckCircle2 size={22} /><div><h3>Seu resumo</h3><p>{result.analyzedPages.length} páginas analisadas · {result.model} · {result.points.length} tópicos</p></div></div>{result.warnings.map((warning,index) => <p className="summary-warning" key={index}>{warning}</p>)}{result.unreadPages.length > 0 && <p className="summary-warning">Páginas não analisadas: {result.unreadPages.join(", ")}.</p>}<label htmlFor="summary-editor">Revise e edite o resultado</label><textarea id="summary-editor" value={edited} maxLength={20000} rows={14} onChange={event => setEdited(event.target.value)} />{edited !== original && <p className="summary-warning">Texto editado por você. As citações originais podem não sustentar as alterações; esse aviso também será incluído na exportação.</p>}<div className="summary-actions"><button className="button button-ghost" type="button" disabled={!edited.trim()} onClick={async () => { try { await navigator.clipboard.writeText(edited); setNotice("Resumo copiado."); } catch { setError("O navegador bloqueou a cópia. Selecione o texto no campo e copie manualmente."); } }}><Copy size={16} /> Copiar</button>{(["pdf", "docx", "txt"] as const).map(format => <button key={format} className="button button-ghost" type="button" disabled={exporting || !edited.trim()} onClick={() => download(format)}><Download size={16} /> {format.toUpperCase()}</button>)}</div><details className="summary-evidence"><summary>Conferir citações e páginas do resultado original</summary>{result.points.map((point,index) => <div key={index}><strong>Tópico {index + 1}</strong>{point.evidence.map((item,key) => <blockquote key={key}><span>Página {result.sources.find(source => source.id === item.sourceId)?.page}</span><p>{item.quote}</p></blockquote>)}</div>)}</details></div>}
  </section>;
}
