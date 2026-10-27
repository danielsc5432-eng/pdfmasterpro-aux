"use client";

import { useEffect, useRef, useState } from "react";
import { buildPlan, columnsFor, NaturalLanguageExtractionPlanner, previewRecord } from "@/lib/clonemaster/engine";
import { LIMITS, type BatchResult, type CloneConfig, type Encoding, type Plan, type Preview, type Source, type Template, type WorkerRequest } from "@/lib/clonemaster/types";
import { FREE_MAX_TASKS_PER_DAY } from "@/lib/plans";
import "./workspace.css";

const EXAMPLE = "Extraia apenas os valores da coluna Salário da planilha e substitua o campo salario no TXT. Gere um arquivo por funcionário, sem modificar as outras configurações.";
type Item = { id: string; file: File; encoding: Encoding | "auto"; template?: Template; source?: Source; error?: string };
type Review = { templateId: string; plan: Plan; preview: Preview | null; error?: string };
type RequestPayload = WorkerRequest extends infer Request ? Request extends { id: number } ? Omit<Request, "id"> : never : never;

function defaultConfig(template: Template, source?: Source): CloneConfig {
  const sheet = source?.sheets.find(sheet => !sheet.hidden) ?? source?.sheets[0];
  const headerRow = sheet?.rows[0]?.number ?? 1;
  return { templateId: template.id, sourceId: source?.id ?? "", sheetId: sheet?.id ?? "", headerRow, firstRow: headerRow + 1, lastRow: Math.max(headerRow + 1, ...(sheet?.rows.map(row => row.number) ?? [])), selectedRows: "", mappings: [{ column: "", field: "" }], valueMode: "raw", emptyPolicy: "skip", allowCachedFormulas: false, filter: null, mode: "exact-text" };
}
function SourcePreview({ source, sheetId, header }: { source: Source; sheetId: string; header: number }) {
  const sheet = source.sheets.find(sheet => sheet.id === sheetId);
  if (!sheet) return null;
  try {
    const columns = columnsFor(sheet, header).slice(0, 8);
    return <details className="clone-source-preview"><summary>Visualizar dados da aba (até 8 linhas e 8 colunas)</summary><div className="clone-table-wrap"><table><caption>{source.name} · {sheet.name}</caption><thead><tr><th>Linha</th>{columns.map(c => <th key={c.id}>{c.label} ({c.id})</th>)}</tr></thead><tbody>{sheet.rows.filter(row => row.number > header).slice(0, 8).map(row => <tr key={row.number}><th>{row.number}</th>{columns.map(c => { const cell = row.cells[c.id]; return <td key={c.id}>{cell?.raw.slice(0, 100) ?? "—"}{cell?.formula && <span title={cell.warning}> · fórmula armazenada</span>}</td>; })}</tr>)}</tbody></table></div></details>;
  } catch { return <p className="clone-warning">Escolha uma linha de cabeçalho existente para visualizar os dados.</p>; }
}

export function CloneMasterWorkspace() {
  const [models, setModels] = useState<Item[]>([]), [sources, setSources] = useState<Item[]>([]);
  const [configs, setConfigs] = useState<Record<string, CloneConfig>>({}), [activeId, setActiveId] = useState("");
  const [instruction, setInstruction] = useState(EXAMPLE), [interpretation, setInterpretation] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [progress, setProgress] = useState({ done: 0, total: 0 });
  const [reviews, setReviews] = useState<Review[] | null>(null), [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null), [downloads, setDownloads] = useState<{ name: string; url: string }[]>([]), [zipUrl, setZipUrl] = useState("");
  const [encoding, setEncoding] = useState<Encoding | "auto">("auto");
  const [drag, setDrag] = useState<"models" | "sources" | null>(null);
  const modelInput = useRef<HTMLInputElement>(null), sourceInput = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null), nextId = useRef(0), urls = useRef<string[]>([]), alive = useRef(true), operation = useRef(0);
  const pending = useRef(new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>());
  const quotaAbort = useRef<AbortController | null>(null), generationLock = useRef(false);

  function revoke() { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; }
  function invalidate() { setReviews(null); setConfirmed(false); setResult(null); setDownloads([]); setZipUrl(""); revoke(); }
  function stopWorker(message = "Operação cancelada. Nenhum resultado deste lote foi disponibilizado.") {
    quotaAbort.current?.abort(); quotaAbort.current = null; generationLock.current = false;
    worker.current?.terminate(); worker.current = null;
    for (const request of pending.current.values()) request.reject(Error(message)); pending.current.clear();
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current++; stopWorker(); revoke(); }; }, []);
  useEffect(() => {
    if (!models.length && !sources.length) return;
    const timer = setTimeout(() => { operation.current++; stopWorker("Sessão local expirada."); revoke(); setModels([]); setSources([]); setConfigs({}); setReviews(null); setConfirmed(false); setResult(null); setDownloads([]); setZipUrl(""); setBusy(false); setError("Sessão local encerrada após duas horas. Selecione os arquivos novamente."); }, 2 * 60 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [models.length, sources.length]);

  function request<T>(payload: RequestPayload): Promise<T> {
    if (!worker.current) {
      worker.current = new Worker(new URL("../../lib/clonemaster/worker.ts", import.meta.url), { type: "module" });
      worker.current.onmessage = event => {
        const message = event.data;
        if (message.progress) { if (alive.current) setProgress(message.progress); return; }
        const item = pending.current.get(message.id); if (!item) return;
        pending.current.delete(message.id); message.error ? item.reject(Error(message.error)) : item.resolve(message.result);
      };
      worker.current.onerror = () => stopWorker("O processamento local foi interrompido. Tente arquivos menores ou recarregue a página.");
    }
    return new Promise((resolve, reject) => { const id = ++nextId.current; pending.current.set(id, { resolve: value => resolve(value as T), reject }); worker.current!.postMessage({ ...payload, id }); });
  }
  async function add(area: "models" | "sources", files: FileList | File[] | null) {
    if (!files || busy) return;
    const list = Array.from(files), current = area === "models" ? models : sources;
    const extensions = area === "models" ? /\.(txt|ini|cfg)$/i : /\.xlsx$/i;
    if (!list.length) return;
    if (current.length + list.length > LIMITS.filesPerArea || list.some(file => !extensions.test(file.name) || file.size < 1 || file.size > (area === "models" ? LIMITS.templateBytes : LIMITS.sourceBytes)) || [...models, ...sources].reduce((sum, item) => sum + item.file.size, 0) + list.reduce((sum, file) => sum + file.size, 0) > LIMITS.totalInputBytes) { setError("Envie até 5 arquivos por área: modelos TXT/INI/CFG de até 256 KB, fontes XLSX de até 8 MB e 20 MB no total."); return; }
    const items: Item[] = list.map(file => ({ id: crypto.randomUUID(), file, encoding }));
    const setItems = area === "models" ? setModels : setSources;
    setItems(previous => [...previous, ...items]); invalidate(); setError(""); setProgress({ done: 0, total: 0 }); setBusy(true);
    const currentOperation = ++operation.current;
    try {
      for (const item of items) {
        if (currentOperation !== operation.current) break;
        try {
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          if (currentOperation !== operation.current) break;
          const data = area === "models" ? await request<Template>({ command: "template", fileId: item.id, name: item.file.name, bytes, encoding: item.encoding }) : await request<Source>({ command: "source", fileId: item.id, name: item.file.name, bytes });
          if (currentOperation !== operation.current || !alive.current) break;
          setItems(previous => previous.map(previousItem => previousItem.id === item.id ? { ...previousItem, ...(area === "models" ? { template: data as Template } : { source: data as Source }) } : previousItem));
          if (area === "models") setActiveId(previous => previous || item.id);
        } catch (cause) { if (currentOperation === operation.current && alive.current) setItems(previous => previous.map(previousItem => previousItem.id === item.id ? { ...previousItem, error: cause instanceof Error ? cause.message : "Falha ao ler arquivo." } : previousItem)); }
      }
    } finally { if (currentOperation === operation.current && alive.current) setBusy(false); }
  }
  function remove(area: "models" | "sources", id: string) {
    if (busy) return;
    if (area === "models") { setModels(previous => previous.filter(item => item.id !== id)); if (id === activeId) setActiveId(models.find(item => item.id !== id)?.id ?? ""); }
    else setSources(previous => previous.filter(item => item.id !== id));
    invalidate(); setInterpretation("");
  }
  const templates = models.flatMap(item => item.template ? [item.template] : []), dataSources = sources.flatMap(item => item.source ? [item.source] : []);
  const active = templates.find(template => template.id === activeId) ?? templates[0];
  const config = active ? configs[active.id] ?? defaultConfig(active, dataSources[0]) : null;
  const source = dataSources.find(source => source.id === config?.sourceId), sheet = source?.sheets.find(sheet => sheet.id === config?.sheetId);
  let columns: ReturnType<typeof columnsFor> = [];
  try { if (sheet && config) columns = columnsFor(sheet, config.headerRow); } catch { /* Explicitly reported when reviewing the plan. */ }
  function update(patch: Partial<CloneConfig>) { if (!active || !config || busy) return; setConfigs(previous => ({ ...previous, [active.id]: { ...config, ...patch } })); invalidate(); setInterpretation(""); }
  function analyze() {
    invalidate(); setError("");
    if (!active || !source || !config) { setError("Selecione um modelo, uma fonte e uma aba antes de analisar."); return; }
    try { const interpreted = new NaturalLanguageExtractionPlanner().analyze(instruction, active, source, config); setInterpretation([interpreted.explanation, ...interpreted.issues].join(" ")); if (interpreted.config) setConfigs(previous => ({ ...previous, [active.id]: interpreted.config! })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível interpretar."); }
  }
  function prepare() {
    invalidate(); setError("");
    try {
      if (!templates.length || !dataSources.length || models.some(item => !item.template) || sources.some(item => !item.source)) throw Error("Adicione modelos e fontes válidos. Remova ou corrija os arquivos com erro.");
      const next = templates.map(template => {
        const config = configs[template.id] ?? defaultConfig(template, dataSources[0]), source = dataSources.find(source => source.id === config.sourceId);
        if (!source) throw Error(`Associe uma fonte ao modelo ${template.name}.`);
        const plan = buildPlan(template, source, config); let preview: Preview | null = null, error: string | undefined;
        for (const row of plan.records) { try { preview = previewRecord(template, source, config, row).preview; break; } catch (cause) { error = cause instanceof Error ? cause.message : "Prévia indisponível."; } }
        return { templateId: template.id, plan, preview, ...(!preview ? { error } : {}) };
      });
      if (next.reduce((sum, review) => sum + review.plan.records.length, 0) > LIMITS.outputs) throw Error("O lote completo excede 500 arquivos. Reduza a seleção.");
      setReviews(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível revisar o plano."); }
  }
  function changePreview(templateId: string, row: number) {
    if (!reviews || busy) return;
    const review = reviews.find(review => review.templateId === templateId), template = templates.find(template => template.id === templateId);
    const source = dataSources.find(source => source.id === review?.plan.config.sourceId);
    if (!review || !template || !source || !review.plan.records.includes(row)) return;
    let preview: Preview | null = null, error: string | undefined;
    try { preview = previewRecord(template, source, review.plan.config, row).preview; }
    catch (cause) { error = cause instanceof Error ? cause.message : "Prévia indisponível."; }
    setReviews(previous => previous?.map(item => item.templateId === templateId ? { ...item, preview, error } : item) ?? null);
    setConfirmed(false);
  }
  async function generate() {
    if (!reviews || !confirmed || busy || generationLock.current) return;
    generationLock.current = true;
    setBusy(true); setError(""); setProgress({ done: 0, total: reviews.reduce((sum, review) => sum + review.plan.records.length, 0) });
    const currentOperation = ++operation.current; revoke(); setDownloads([]); setZipUrl(""); setResult(null);
    try {
      const controller = new AbortController(); quotaAbort.current = controller;
      const response = await fetch("/api/clonemaster/quota", { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const authorization = await response.json();
      if (!response.ok || authorization.authorized !== true) throw Error(authorization.error || "Não foi possível autorizar o lote. Tente novamente.");
      if (currentOperation !== operation.current || !alive.current) return;
      quotaAbort.current = null;
      const generated = await request<BatchResult>({ command: "generate", templates, sources: dataSources, configs: reviews.map(review => review.plan.config) });
      if (currentOperation !== operation.current || !alive.current) return;
      if (generated.cancelled) throw Error("Lote cancelado.");
      const create = (bytes: Uint8Array, type: string) => { const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type })); urls.current.push(url); return url; };
      const nextDownloads = generated.outputs.map(output => ({ name: output.filename, url: create(output.bytes, "application/octet-stream") }));
      if (generated.zip) setZipUrl(create(generated.zip, "application/zip"));
      setDownloads(nextDownloads); setResult(generated);
    } catch (cause) { if (currentOperation === operation.current && alive.current) setError(cause instanceof Error ? cause.message : "Falha ao gerar o lote."); }
    finally { if (currentOperation === operation.current && alive.current) { generationLock.current = false; quotaAbort.current = null; setBusy(false); } }
  }
  function cancel() { operation.current++; stopWorker(); setModels(previous => previous.filter(item => item.template || item.error)); setSources(previous => previous.filter(item => item.source || item.error)); invalidate(); setBusy(false); setError("Operação cancelada. Os resultados deste lote foram descartados."); }
  function clear() { operation.current++; stopWorker(); invalidate(); setModels([]); setSources([]); setConfigs({}); setActiveId(""); setInterpretation(""); setError(""); setBusy(false); }

  return <section className="clone-workspace workspace" aria-labelledby="clone-title">
    <div className="workspace-header"><div><h2 id="clone-title">CloneMaster AI</h2><p>Modelos TXT, INI e CFG + fontes XLSX. Somente os campos confirmados serão alterados.</p></div><span className="tool-status status-ready">Processamento local</span></div>
    <p className="clone-notice">Os arquivos ficam neste navegador. Não há envio para APIs, execução de macros ou cobrança de IA. Interpretação local por regras, sem modelo generativo; revise sempre o plano. Limites: 5 modelos, 5 fontes, 20 MB de entrada e 500 resultados por lote.</p>
    <p className="clone-notice" id="clone-quota">Plano gratuito: até {FREE_MAX_TASKS_PER_DAY} tarefas por janela de 24 horas, compartilhadas com as outras ferramentas. Cada geração de lote consome uma tarefa, mesmo se cancelada depois da autorização. Prévia e downloads do lote pronto não consomem novas tarefas. A cota é validada online, sem enviar o conteúdo dos arquivos. Premium sem cota diária de tarefas.</p>
    <div className="clone-upload-grid">{(["models", "sources"] as const).map(area => <section className="clone-card" key={area}>
      <h3>{area === "models" ? "A · Arquivos modelo" : "B · Fontes de informações"}</h3>
      {area === "models" && <label className="clone-label">Codificação dos próximos modelos<select value={encoding} disabled={busy} onChange={event => setEncoding(event.target.value as Encoding | "auto")}><option value="auto">Automática (UTF-8 / UTF-16 com BOM)</option><option value="windows-1252">Windows-1252</option><option value="utf-16le">UTF-16 LE sem BOM</option><option value="utf-16be">UTF-16 BE sem BOM</option></select></label>}
      <button type="button" className={`clone-drop ${drag === area ? "dragging" : ""}`} disabled={busy} onClick={() => (area === "models" ? modelInput : sourceInput).current?.click()} onDragOver={event => { event.preventDefault(); if (!busy) setDrag(area); }} onDragLeave={() => setDrag(null)} onDrop={event => { event.preventDefault(); setDrag(null); void add(area, event.dataTransfer.files); }}>Arraste ou escolha {area === "models" ? "modelos TXT, INI ou CFG (até 256 KB cada)" : "planilhas XLSX (até 8 MB cada)"}</button>
      <input ref={area === "models" ? modelInput : sourceInput} data-clone-upload={area} className="file-input" type="file" multiple accept={area === "models" ? ".txt,.ini,.cfg" : ".xlsx"} onChange={event => { void add(area, event.target.files); event.target.value = ""; }} />
      <ul className="clone-file-list" aria-label={area === "models" ? "Modelos selecionados" : "Fontes selecionadas"}>{(area === "models" ? models : sources).map(item => <li key={item.id}><div><strong>{item.file.name}</strong><small>{(item.file.size / 1024).toFixed(1)} KB · {item.template ? item.template.encoding : item.source ? `${item.source.sheets.length} aba(s)` : item.error ? "Leitura não concluída" : "Lendo…"}</small>{item.error && <p role="alert">{item.error} Remova e adicione novamente com as opções corretas.</p>}</div><button type="button" className="button button-ghost" disabled={busy} aria-label={`Remover ${item.file.name}`} onClick={() => remove(area, item.id)}>Remover</button></li>)}</ul>
    </section>)}</div>
    {active && config && <section className="clone-card clone-config"><h3>Configuração independente por modelo</h3>
      <label className="clone-label">Modelo em edição<select id="clone-model" value={active.id} disabled={busy} onChange={event => { setActiveId(event.target.value); setInterpretation(""); }}>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <details><summary>Pré-visualizar modelo original · {active.fields.length} campo(s)</summary><pre>{active.text}</pre></details>
      <div className="clone-form-grid"><label className="clone-label">Fonte associada<select id="clone-source" value={config.sourceId} disabled={busy} onChange={event => { const selected = dataSources.find(source => source.id === event.target.value); update({ ...defaultConfig(active, selected), sourceId: event.target.value }); }}><option value="">Selecione uma fonte</option>{dataSources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <label className="clone-label">Aba<select id="clone-sheet" value={config.sheetId} disabled={busy || !source} onChange={event => { const sheet = source?.sheets.find(sheet => sheet.id === event.target.value), headerRow = sheet?.rows[0]?.number ?? 1; update({ sheetId: event.target.value, headerRow, firstRow: headerRow + 1, lastRow: Math.max(headerRow + 1, ...(sheet?.rows.map(row => row.number) ?? [])), selectedRows: "", mappings: [{ column: "", field: "" }], filter: null }); }}>{source?.sheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.name}{sheet.hidden ? " (oculta)" : ""}</option>)}</select></label>
      <label className="clone-label">Linha do cabeçalho<input id="clone-header" type="number" min={1} max={5000} disabled={busy} value={config.headerRow} onChange={event => { const headerRow = Number(event.target.value); update({ headerRow, firstRow: headerRow + 1, mappings: [{ column: "", field: "" }] }); }} /></label>
      <label className="clone-label">Modo de clonagem<select value="exact-text" disabled><option value="exact-text">Texto exato · disponível</option><option>Visual · adaptador ainda não implementado</option><option>Estrutural · adaptador ainda não implementado</option><option>Combinado · adaptador ainda não implementado</option></select></label></div>
      {source && <SourcePreview source={source} sheetId={config.sheetId} header={config.headerRow} />}
      <div className="clone-mappings"><h4>Mapeamento dos campos</h4><p>Escolha somente as colunas que devem preencher o modelo. Seções, linhas e ocorrências distinguem chaves repetidas.</p>{config.mappings.map((mapping, index) => <div className="clone-mapping" key={index}><label className="clone-label">Coluna de origem<select data-clone-column value={mapping.column} disabled={busy} onChange={event => update({ mappings: config.mappings.map((mapping, i) => i === index ? { ...mapping, column: event.target.value } : mapping) })}><option value="">Selecione a coluna</option>{columns.map(column => <option key={column.id} value={column.id}>{column.label} ({column.id})</option>)}</select></label><label className="clone-label">Campo de destino<select data-clone-field value={mapping.field} disabled={busy} onChange={event => update({ mappings: config.mappings.map((mapping, i) => i === index ? { ...mapping, field: event.target.value } : mapping) })}><option value="">Selecione a chave</option>{active.fields.map(field => <option key={field.id} value={field.id}>{field.section ? `[${field.section}] → ` : ""}{field.key} · linha {field.line} · ocorrência {field.occurrence}</option>)}</select></label><button className="button button-ghost" disabled={busy || config.mappings.length === 1} onClick={() => update({ mappings: config.mappings.filter((_, i) => i !== index) })}>Remover campo</button></div>)}<button className="button button-ghost" disabled={busy || config.mappings.length >= LIMITS.fields} onClick={() => update({ mappings: [...config.mappings, { column: "", field: "" }] })}>Adicionar campo</button></div>
      <div className="clone-form-grid"><label className="clone-label">Primeira linha de dados<input id="clone-first" type="number" min={config.headerRow + 1} max={5000} value={config.firstRow} disabled={busy} onChange={event => update({ firstRow: Number(event.target.value) })} /></label><label className="clone-label">Última linha<input id="clone-last" type="number" min={config.firstRow} max={5000} value={config.lastRow} disabled={busy} onChange={event => update({ lastRow: Number(event.target.value) })} /></label><label className="clone-label">Linhas específicas (opcional)<input id="clone-rows" placeholder="2,4,6-10" value={config.selectedRows} disabled={busy} onChange={event => update({ selectedRows: event.target.value })} /></label><label className="clone-label">Valores a extrair<select id="clone-values" value={config.valueMode} disabled={busy} onChange={event => update({ valueMode: event.target.value as CloneConfig["valueMode"] })}><option value="raw">Brutos (4500.5)</option><option value="displayed">Formatados pelo adaptador (conferir prévia)</option></select></label><label className="clone-label">Células vazias<select value={config.emptyPolicy} disabled={busy} onChange={event => update({ emptyPolicy: event.target.value as CloneConfig["emptyPolicy"] })}><option value="skip">Ignorar a linha</option><option value="error">Registrar erro da linha</option></select></label></div>
      {config.valueMode === "displayed" && <p className="clone-warning">A formatação é calculada pelo código da célula. Separadores regionais e detalhes de exibição podem diferir do Excel; confira a prévia antes de confirmar.</p>}<label className="clone-check"><input type="checkbox" disabled={busy} checked={config.allowCachedFormulas} onChange={event => update({ allowCachedFormulas: event.target.checked })} /> Autorizo valores armazenados de fórmulas; entendo que podem estar desatualizados e não serão recalculados.</label>
      <label className="clone-check"><input type="checkbox" disabled={busy} checked={!!config.filter} onChange={event => update({ filter: event.target.checked ? { column: "", operator: "equals", value: "" } : null })} /> Aplicar filtro explícito nesta fonte</label>
      {config.filter && <div className="clone-form-grid"><label className="clone-label">Coluna do filtro<select value={config.filter.column} disabled={busy} onChange={event => update({ filter: { ...config.filter!, column: event.target.value } })}><option value="">Selecione</option>{columns.map(column => <option key={column.id} value={column.id}>{column.label} ({column.id})</option>)}</select></label><label className="clone-label">Condição<select value={config.filter.operator} disabled={busy} onChange={event => update({ filter: { ...config.filter!, operator: event.target.value as NonNullable<CloneConfig["filter"]>["operator"] } })}>{[["equals", "Igual ao texto"], ["contains", "Contém texto"], ["gt", "Número maior que"], ["lt", "Número menor que"], ["date-before", "Data anterior a (ISO)"], ["date-after", "Data posterior a (ISO)"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="clone-label">Valor do filtro<input value={config.filter.value} maxLength={1000} disabled={busy} onChange={event => update({ filter: { ...config.filter!, value: event.target.value } })} /></label></div>}
    </section>}
    <section className="clone-card"><h3>C · Comando inteligente</h3><label className="clone-label" htmlFor="clone-instruction">Descreva o que você deseja extrair e clonar</label><textarea id="clone-instruction" value={instruction} maxLength={LIMITS.instruction} rows={5} disabled={busy} onChange={event => { setInstruction(event.target.value); setInterpretation(""); invalidate(); }} /><div className="clone-actions"><button className="button button-ghost" disabled={busy} onClick={() => { setInstruction(EXAMPLE); setInterpretation(""); invalidate(); }}>Usar exemplo: somente salário</button><button id="clone-analyze" className="button button-primary" disabled={busy || !active || !source} onClick={analyze}>Analisar instrução</button></div><p>A análise configura apenas o modelo em edição. Filtros, transformações e pedidos não reconhecidos exigem edição manual. A geração executa exclusivamente o plano confirmado abaixo.</p>{interpretation && <p className="clone-interpretation" role="status">{interpretation}</p>}</section>
    <section className="clone-card"><h3>D · Prévia, validação e resultados</h3><div className="clone-actions"><button id="clone-review" className="button button-ghost" disabled={busy || !templates.length || !dataSources.length} onClick={prepare}>Revisar plano e prévia</button><button className="button button-ghost" disabled={!models.length && !sources.length} onClick={clear}>Limpar sessão local</button></div>
      {error && <p className="clone-error" role="alert">{error}</p>}
      {reviews && <div className="clone-reviews"><p><strong>{reviews.reduce((sum, review) => sum + review.plan.records.length, 0)} registro(s) selecionado(s)</strong> · um arquivo por registro válido; linhas com falha serão listadas separadamente. Nomes sequenciais, sem nomes de pessoas.</p>{reviews.map(review => { const template = templates.find(template => template.id === review.templateId)!; const source = dataSources.find(source => source.id === review.plan.config.sourceId)!; return <article className="clone-review" key={review.templateId}><h4>{template.name} ← {source.name} · {source.sheets.find(sheet => sheet.id === review.plan.config.sheetId)?.name}</h4><p>Colunas utilizadas no conteúdo: {review.plan.selectedColumns.join(", ")}. Formato de saída: {review.plan.outputExtension.toUpperCase()} · codificação {template.encoding} · somente Texto exato.</p><p>Cabeçalho: linha {review.plan.config.headerRow}. Intervalo: {review.plan.config.firstRow}–{review.plan.config.lastRow}. {review.plan.config.filter ? `Filtro: ${review.plan.config.filter.column} ${review.plan.config.filter.operator} ${review.plan.config.filter.value}.` : "Sem filtro."} Valores: {review.plan.config.valueMode === "raw" ? "brutos" : "formatados"}.</p><label className="clone-label">Registro para pré-visualizar<select data-clone-preview-row value={review.preview?.row ?? ""} disabled={busy} onChange={event => changePreview(review.templateId, Number(event.target.value))}><option value="" disabled>Escolha uma linha</option>{review.plan.records.map(row => <option key={row} value={row}>Linha {row}</option>)}</select></label>{review.plan.warnings.map(warning => <p key={warning} className="clone-warning">{warning}</p>)}{review.error && <p className="clone-error">Prévia indisponível: {review.error}</p>}{review.preview && <><p>Prévia do registro: linha {review.preview.row}.</p><ul className="clone-changes">{review.preview.changes.map(change => <li key={change.field}>{change.field}: <del>{change.before || "(vazio)"}</del> → <mark>{change.after}</mark> (coluna {change.column})</li>)}</ul><div className="clone-before-after"><div><h5>Antes</h5><pre>{review.preview.before}</pre></div><div><h5>Depois</h5><pre>{review.preview.after}</pre></div></div></>}</article>; })}<label className="clone-check"><input id="clone-confirm" type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> Conferi modelos, fontes, campos e registros. Confirmo este plano, inclusive ajustes manuais, e autorizo a geração local.</label><button id="clone-generate" className="button button-primary" disabled={!confirmed || busy} onClick={() => void generate()}>Gerar arquivos confirmados</button></div>}
      {busy && <div className="clone-progress" role="status"><p>{progress.total ? `Gerando ${progress.done} de ${progress.total} registro(s)…` : "Lendo e validando arquivos no navegador…"}</p>{progress.total > 0 && <progress value={progress.done} max={progress.total} aria-label="Progresso do lote" />}<button className="button button-ghost" onClick={cancel}>Cancelar operação</button></div>}
      {result && <div className="clone-results"><h4>{result.outputs.length} arquivo(s) gerado(s) · {result.errors.length} erro(s)</h4><p>Trechos fora dos campos selecionados foram verificados byte a byte. Os originais não foram modificados.</p>{zipUrl && <a id="clone-zip" className="button button-primary" href={zipUrl} download="clonemaster-resultados.zip">Baixar todos em ZIP</a>}<ul>{downloads.map(output => <li key={output.name}><a href={output.url} download={output.name.split("/").pop()}>{output.name}</a></li>)}</ul>{result.errors.length > 0 && <details open><summary>Relatório de erros do lote</summary><ul>{result.errors.map((error, i) => <li key={i}>{templates.find(template => template.id === error.templateId)?.name} · linha {error.row}: {error.message}</li>)}</ul></details>}</div>}
    </section>
  </section>;
}
