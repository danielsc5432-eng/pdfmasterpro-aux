"use client";

import { useEffect, useRef, useState } from "react";
import { takeQueuedFiles } from "@/lib/pending-files";
import { ANALYSIS_MODES, CATEGORY_LABELS, CLASS_LABELS, REVIEW_LABELS, type AnalysisMode, type AnalysisResult, type Review, type ReviewStatus, type LocalAiReview } from "@/lib/divergences/types";
import { LocalAiPanel } from "./local-ai";
import "./workspace.css";

// Leave multipart overhead below the serverless ingress limit; dedicated hosts may raise this.
const uploadMb = Math.max(1, Math.min(25, Number(process.env.NEXT_PUBLIC_DIVERGENCE_UPLOAD_MB) || 4));

export function DivergenceWorkspace() {
  const [files, setFiles] = useState<File[]>([]);
  const [modes, setModes] = useState<AnalysisMode[]>(["general"]);
  const [custom, setCustom] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [localAi, setLocalAi] = useState<LocalAiReview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [reportBusy, setReportBusy] = useState(false);
  const [search, setSearch] = useState(""), [category, setCategory] = useState(""), [documentId, setDocumentId] = useState(""), [status, setStatus] = useState(""), [confidence, setConfidence] = useState(""), [page, setPage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setFiles(takeQueuedFiles()); return () => { controller.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); }; }, []);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => { setResult(null); setFiles([]); setReviews({}); urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; setError("A sessão de análise expirou. Envie os arquivos novamente para continuar."); }, Math.max(0, Date.parse(result.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [result]);

  function add(list: FileList | File[] | null) {
    if (!list) return;
    const combined = [...files, ...Array.from(list)];
    if (combined.length > 5 || combined.some(file => !file.name.toLowerCase().endsWith(".pdf") || !file.size || file.size > 10 * 1024 * 1024) || combined.reduce((sum, file) => sum + file.size, 0) > uploadMb * 1024 * 1024) {
      setError(`Envie de 2 a 5 PDFs, até 10 MB por arquivo e ${uploadMb} MB no total nesta hospedagem, sem arquivos vazios.`); return;
    }
    setError(""); setFiles(combined);
  }
  function reset() {
    controller.current?.abort(); setResult(null); setReviews({}); setLocalAi(null); setFiles([]); setError("");
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = [];
  }
  async function analyze() {
    setError(""); setBusy(true); setResult(null); setReviews({}); setLocalAi(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const form = new FormData(); files.forEach(file => form.append("files", file));
      form.append("options", JSON.stringify({ modes, custom, useAi }));
      const response = await fetch("/api/v1/process?tool=detector-divergencias", { method: "POST", body: form, signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Não foi possível concluir a análise.");
      if (data.version !== 1 || !Array.isArray(data.documents) || !Array.isArray(data.findings)) throw Error("O servidor retornou um resultado inválido.");
      urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = files.map(file => URL.createObjectURL(file));
      setResult(data);
    } catch (cause) { setError(abort.signal.aborted ? "Análise cancelada." : cause instanceof Error ? cause.message : "Falha na análise."); }
    finally { setBusy(false); controller.current = null; }
  }
  function download(bytes: Uint8Array | string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], { type }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function report() {
    if (!result) return; setReportBusy(true); setError("");
    try {
      const { divergenceReport } = await import("@/lib/divergences/report");
      const font = await fetch("/fonts/NotoSans-Regular.ttf", { cache: "force-cache" });
      if (!font.ok) throw Error("Não foi possível carregar a fonte do relatório.");
      download(await divergenceReport(result, reviews, new Uint8Array(await font.arrayBuffer()), localAi), "relatorio-divergencias.pdf", "application/pdf");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao gerar relatório."); }
    finally { setReportBusy(false); }
  }
  const filtered = result?.findings.filter(item => (!category || item.category === category) && (!documentId || item.documents.includes(documentId)) && (!status || (reviews[item.id]?.status ?? "pending") === status) && (!confidence || item.confidence === confidence) && (!page || item.evidence.some(source => source.page === Number(page))) && JSON.stringify(item).toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))) ?? [];
  return <section className="workspace divergence-workspace" aria-label="Comparação documental">
    {!result && <>
      <div className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) add(event.dataTransfer.files); }}>
        <h2>Compare seus documentos</h2><p>Arraste de 2 a 5 PDFs ou selecione os arquivos.</p>
        <p>Até 10 MB e 20 páginas por PDF; {uploadMb} MB e 60 páginas no total nesta hospedagem. PDFs com texto selecionável. Páginas digitalizadas serão sinalizadas para OCR.</p>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple aria-label="Selecionar PDFs para comparação" disabled={busy} onChange={event => { add(event.target.files); event.target.value = ""; }} />
      </div>
      <ul className="divergence-files">{files.map((file, index) => <li key={index}><span>{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</span><button type="button" disabled={busy} onClick={() => setFiles(files.filter((_, i) => i !== index))} aria-label={`Remover ${file.name}`}>Remover</button></li>)}</ul>
      <fieldset disabled={busy}><legend>O que deseja conferir?</legend><div className="divergence-modes">{Object.entries(ANALYSIS_MODES).map(([key, label]) => <label key={key}><input type="checkbox" checked={modes.includes(key as AnalysisMode)} onChange={event => setModes(event.target.checked ? [...modes, key as AnalysisMode] : modes.filter(mode => mode !== key))} /> {label}</label>)}</div>
        {modes.includes("custom") && <label>Descreva os campos de interesse<textarea maxLength={600} value={custom} onChange={event => setCustom(event.target.value)} /><small>A seleção personalizada usa palavras dos rótulos dos campos. Não interpreta instruções arbitrárias.</small></label>}
        <label className="divergence-consent"><input type="checkbox" checked={useAi} onChange={event => setUseAi(event.target.checked)} /> Autorizo o envio de até 10 pares de trechos de cláusulas ao serviço de IA configurado pelo site (OpenCode, Ollama ou Transformers Python), para revisão semântica. O provedor pode ter suas próprias políticas de retenção.</label>
      </fieldset>
      <p>Os PDFs são processados no servidor. Arquivos temporários são apagados ao concluir; o resultado permanece na memória desta página, até limpar, fechar ou expirar. O histórico registra metadados da tarefa. Não há diagnóstico jurídico ou comprovação de fraude.</p>
      <div className="divergence-actions"><button className="button button-primary" disabled={busy || files.length < 2 || !modes.length || (modes.includes("custom") && custom.trim().length < 3)} onClick={analyze}>Analisar documentos</button>{busy && <button className="button button-ghost" onClick={() => controller.current?.abort()}>Cancelar</button>}<button className="button button-ghost" onClick={reset} disabled={busy}>Limpar</button></div>
    </>}
    {busy && <p role="status" aria-live="polite">Enviando arquivos, extraindo evidências e comparando documentos… Aguarde a resposta do servidor.</p>}
    {error && <p role="alert" className="divergence-error">{error}</p>}
    {result && <>
      <h2>Resultado da comparação</h2><p>{result.documents.length} documentos · {result.findings.length} achados · {result.findings.filter(item => item.category === "missing").length} campos não localizados · {result.documents.filter(doc => !doc.complete).length} documentos com extração parcial.</p>
      <p>IA: {({ disabled: "não solicitada", not_configured: "não configurada; comparação por regras", used: `revisão de ${result.ai.considered} pares`, unavailable: "indisponível; comparação por regras mantida" })[result.ai.status]}. Revise todas as conclusões nas fontes.</p>
      <details><summary>Documentos, limites e avisos</summary>{result.documents.map(doc => <div key={doc.id}><strong>{doc.name}</strong><p>{doc.pages.length} página(s){doc.duplicateOf ? " · duplicado" : ""}</p>{doc.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>)}{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}{result.truncated && <p>Limite de achados atingido; resultado parcial.</p>}</details>
      <LocalAiPanel findings={result.findings} onComplete={setLocalAi} />
      <div className="divergence-actions"><button className="button button-primary" onClick={report} disabled={reportBusy}>{reportBusy ? "Gerando relatório…" : "Baixar relatório PDF"}</button><button className="button button-ghost" onClick={() => download(JSON.stringify({ ...result, reviews, localAi }, null, 2), "analise-divergencias.json", "application/json")}>Exportar JSON</button><button className="button button-ghost" onClick={reset}>Nova análise / limpar</button></div>
      <p>O relatório contém todos os achados e as suas revisões, independentemente dos filtros.</p>
      <div className="divergence-filters"><label>Pesquisar<input value={search} onChange={event => setSearch(event.target.value)} /></label><label>Categoria<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas</option>{Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Documento<select value={documentId} onChange={event => setDocumentId(event.target.value)}><option value="">Todos</option>{result.documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select></label><label>Revisão<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todas</option>{Object.entries(REVIEW_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Confiança<select value={confidence} onChange={event => setConfidence(event.target.value)}><option value="">Todas</option><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select></label><label>Página<input type="number" min="1" value={page} onChange={event => setPage(event.target.value)} /></label></div>
      <p role="status">{filtered.length} achado(s) exibido(s). Nenhum achado não significa equivalência integral.</p>
      {filtered.map(item => <article className="divergence-finding" key={item.id}><h3>{item.title}</h3><p>{CLASS_LABELS[item.classification]} · {CATEGORY_LABELS[item.category]} · confiança {({ high: "alta", medium: "média", low: "baixa" })[item.confidence]} · {item.origin === "ai" ? "revisão por IA" : "comparação por regras"}</p><p>{item.explanation}</p><div className="divergence-evidence">{item.evidence.map((source, index) => <div key={index}><strong>{source.documentName} · página {source.page}</strong><blockquote>{source.quote}</blockquote><p>Valor: {source.value}</p><a href={`${urls.current[result.documents.findIndex(doc => doc.id === source.documentId)]}#page=${source.page}`} target="_blank" rel="noopener noreferrer">Abrir página original</a></div>)}</div>{item.missingDocumentId && <p>Campo não localizado em {result.documents.find(doc => doc.id === item.missingDocumentId)?.name}; pode existir com outro rótulo.</p>}<label>Revisão deste achado<select value={reviews[item.id]?.status ?? "pending"} onChange={event => setReviews(previous => ({ ...previous, [item.id]: { note: previous[item.id]?.note ?? "", status: event.target.value as ReviewStatus } }))}>{Object.entries(REVIEW_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Observação do revisor<textarea maxLength={1500} value={reviews[item.id]?.note ?? ""} onChange={event => setReviews(previous => ({ ...previous, [item.id]: { status: previous[item.id]?.status ?? "pending", note: event.target.value } }))} /></label></article>)}
    </>}
  </section>;
}
