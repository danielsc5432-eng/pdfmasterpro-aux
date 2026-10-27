"use client";

import { useEffect, useRef, useState } from "react";
import { localAiPairs, validatedLocalReview } from "@/lib/divergences/browser-ai";
import type { Finding, LocalAiReview } from "@/lib/divergences/types";

export function LocalAiPanel({ findings, onComplete }: { findings: Finding[]; onComplete: (review: LocalAiReview) => void }) {
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [review, setReview] = useState<LocalAiReview | null>(null);
  const worker = useRef<Worker | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pairs = localAiPairs(findings);
  function stop() { worker.current?.terminate(); worker.current = null; if (timer.current) clearTimeout(timer.current); timer.current = null; }
  useEffect(() => () => { worker.current?.terminate(); if (timer.current) clearTimeout(timer.current); }, []);
  function start() {
    setBusy(true); setMessage("Carregando a IA no navegador…");
    try {
      stop(); const instance = new Worker("/ai/divergence-worker.js", { type: "module" }); worker.current = instance;
      const fail = () => { stop(); setBusy(false); setMessage("A IA local não concluiu. Verifique a conexão ou a memória disponível. Os achados originais foram preservados."); };
      timer.current = setTimeout(fail, 300000);
      instance.onerror = event => { event.preventDefault(); fail(); };
      instance.onmessage = ({ data }) => {
        if (worker.current !== instance) return;
        if (data?.status === "loading") setMessage("Baixando e preparando o modelo. O primeiro uso pode levar alguns minutos…");
        else if (data?.status === "download") setMessage(`Download do arquivo atual: ${data.progress}%. Os trechos permanecem no navegador.`);
        else if (data?.status === "analyzing") setMessage(`Comparando trechos: ${data.completed} de ${data.total} pares concluídos.`);
        else if (data?.status === "done") {
          try { const checked = validatedLocalReview(data, findings); setReview(checked); onComplete(checked); stop(); setBusy(false); setMessage("IA local concluída. Confira os trechos e as diferenças objetivas."); }
          catch { fail(); }
        } else if (data?.status === "error") fail();
      };
      instance.postMessage({ pairs });
    } catch { stop(); setBusy(false); setMessage("Este navegador não conseguiu iniciar a IA local. A comparação por regras continua disponível."); }
  }
  return <section className="divergence-local-ai" aria-label="IA gratuita no navegador"><h3>IA gratuita no navegador</h3>
    <p>Transformers.js + MiniLM multilíngue comparam a semelhança entre até 10 pares de cláusulas/textos já identificados. Não é uma probabilidade de acerto: frases com valores ou negações diferentes podem ter pontuação alta. A IA não altera evidências nem confirma equivalência.</p>
    {!review && <><label className="divergence-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /> Autorizo baixar o modelo e o runtime da Hugging Face/jsDelivr (aproximadamente 150 MB no primeiro uso) e usar a memória/processador deste dispositivo. Esses serviços recebem a solicitação de download; os trechos usados por esta IA ficam no navegador. O modelo pode permanecer no cache do navegador.</label>
      <p>O download inicial pode consumir cerca de 150–200 MB. Dispositivos com pouca memória podem não conseguir executar o modelo.</p><button className="button button-primary" disabled={!accepted || busy || !pairs.length} onClick={start}>Executar IA local gratuita</button></>}
    {!pairs.length && <p>Não há pares de cláusulas ou textos elegíveis nesta análise. Valores e datas continuam sendo conferidos pelas regras.</p>}
    {busy && <button className="button button-ghost" onClick={() => { stop(); setBusy(false); setMessage("IA local cancelada; comparação original preservada."); }}>Cancelar IA local</button>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    {review && <><p>Similaridade vetorial (escala -1 a 1), sem conclusão jurídica ou de equivalência:</p><ul>{review.items.map(item => <li key={item.findingId}>{findings.find(finding => finding.id === item.findingId)?.title}: {item.similarity.toFixed(3)}</li>)}</ul><p>Os indicadores serão incluídos no relatório e no JSON. Revise manualmente cada fonte.</p></>}
  </section>;
}
