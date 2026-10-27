"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, Send, RotateCcw } from "lucide-react";
import { supportGuidance, supportTopics, type SupportTicket } from "@/lib/support-chat";
import "./support-chat.css";

const questions = ["Qual ferramenta você estava usando? Se não se aplicar, escreva ‘Minha conta’.", "O que aconteceu e qual resultado você esperava? Copie a mensagem de erro, se houver, sem dados confidenciais.", "Em qual navegador e dispositivo aconteceu? Para arquivos, informe apenas formato e tamanho aproximado, sem o conteúdo.", "O que você já tentou para resolver? Se ainda não tentou, informe isso."];
const keys = ["tool", "description", "environment", "attempted"] as const;
const limits = [100, 3000, 300, 1000];
const minimums = [2, 15, 3, 3];
type Message = { role: "bot" | "user"; text: string };
const initial: Message[] = [{ role: "bot", text: "Olá! Sou o assistente automático do PDF Master Pro. Vou orientar você e organizar seu pedido para a equipe. Este atendimento usa respostas guiadas, sem atendente ao vivo. Qual é o assunto?" }];

export function SupportChat({ deliveryReady, email }: { deliveryReady: boolean; email: string | null }) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [topic, setTopic] = useState<SupportTicket["topic"] | null>(null);
  const [stage, setStage] = useState<"topic" | "guidance" | "collect" | "review" | "done">("topic");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [protocol, setProtocol] = useState("");
  const requestId = useRef("");
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, stage]);
  useEffect(() => { if (stage === "collect") field.current?.focus(); }, [stage, step]);
  function add(...items: Message[]) { setMessages(previous => [...previous, ...items]); }
  function reset() { setMessages(initial); setTopic(null); setStage("topic"); setStep(0); setAnswers({}); setInput(""); setConsent(false); setError(""); setProtocol(""); requestId.current = ""; }
  function choose(value: SupportTicket["topic"]) { setTopic(value); add({ role: "user", text: value }, { role: "bot", text: supportGuidance(value) }); setStage("guidance"); }
  function begin() { add({ role: "user", text: "Ainda preciso de ajuda." }, { role: "bot", text: questions[0] }); setStage("collect"); }
  function answer(event: FormEvent) {
    event.preventDefault(); const value = input.trim();
    if (value.length < minimums[step]) { setError(`Escreva pelo menos ${minimums[step]} caracteres para descrever esta informação.`); return; }
    setError(""); setAnswers(previous => ({ ...previous, [keys[step]]: value })); setInput(""); setConsent(false);
    add({ role: "user", text: value }, { role: "bot", text: step < 3 ? questions[step + 1] : "Reuni as informações abaixo. Revise antes de autorizar o envio ao suporte. Sua resposta será enviada para o e-mail da conta conectada." });
    if (step < 3) setStep(step + 1); else { requestId.current = crypto.randomUUID(); setStage("review"); }
  }
  async function send() {
    if (sending || !consent || !deliveryReady) return;
    setSending(true); setError("");
    try {
      const response = await fetch("/api/support/ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: requestId.current, topic, ...answers, consent: true }), signal: AbortSignal.timeout(25000) });
      const result = await response.json();
      if (!response.ok || !result.sent || !result.protocol) throw new Error(result.error || "Não foi possível confirmar o envio.");
      setProtocol(result.protocol); setStage("done"); add({ role: "bot", text: `Seu resumo foi aceito pelo serviço de e-mail para encaminhamento ao suporte. Protocolo: ${result.protocol}. A equipe responderá pelo e-mail da sua conta. Não há prazo de resposta garantido.` });
    } catch (reason) { setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "O envio não foi confirmado. O resumo continua disponível; você pode tentar novamente."); }
    finally { setSending(false); }
  }
  return <section className="support-chat" aria-labelledby="support-chat-title">
    <div className="support-chat-heading"><div><span className="eyebrow">Atendimento guiado</span><h2 id="support-chat-title"><MessageCircle size={23} /> Vamos resolver juntos</h2><p>Orientações automáticas e encaminhamento para a equipe.</p></div><button className="button button-ghost" onClick={reset} disabled={sending} type="button"><RotateCcw size={16} /> Reiniciar</button></div>
    <p className="support-chat-notice">Não envie senhas, cartões, tokens ou conteúdo dos documentos. A conversa fica apenas nesta página até você autorizar o envio do resumo. Ao sair ou reiniciar, ela é apagada.</p>
    {!deliveryReady && <p className="support-chat-notice">Você já pode receber orientações. O envio automático está em configuração.{email && <> Para falar com a equipe, use <a href={`mailto:${email}`}>{email}</a>.</>}</p>}
    <div className="support-chat-log" role="log" aria-label="Conversa de atendimento" aria-live="polite" aria-relevant="additions" ref={log}>{messages.map((message, index) => <div key={index} className={`support-message support-message-${message.role}`}><strong>{message.role === "bot" ? "Assistente" : "Você"}</strong><p>{message.text}</p></div>)}</div>
    {stage === "topic" && <div className="support-chat-choices">{supportTopics.map(value => <button type="button" key={value} className="button button-ghost" onClick={() => choose(value)}>{value}</button>)}</div>}
    {stage === "guidance" && <div className="support-chat-choices"><button className="button button-primary" type="button" onClick={begin}>Ainda preciso de ajuda</button><button className="button button-ghost" type="button" onClick={() => { add({ role: "user", text: "Isso resolveu, obrigado!" }, { role: "bot", text: "Que bom! Nenhum e-mail foi enviado. Você pode iniciar outro atendimento quando precisar." }); setStage("done"); }}>Isso resolveu</button></div>}
    {stage === "collect" && <form onSubmit={answer} className="support-chat-form"><label htmlFor="support-answer">Resposta {step + 1} de 4</label><textarea id="support-answer" ref={field} value={input} onChange={event => setInput(event.target.value)} maxLength={limits[step]} rows={3} required aria-describedby="support-input-limit" /><small id="support-input-limit">{input.length}/{limits[step]} caracteres</small><button className="button button-primary" type="submit"><Send size={16} /> Continuar</button></form>}
    {stage === "review" && <div className="support-chat-review"><h3>Resumo do atendimento</h3><dl><dt>Assunto</dt><dd>{topic}</dd>{keys.map((key,index) => <div key={key}><dt>{["Ferramenta", "Problema e resultado esperado", "Navegador e contexto", "Tentativas realizadas"][index]}</dt><dd>{answers[key]}</dd></div>)}</dl><label className="support-chat-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={sending} /> Revisei e autorizo enviar este resumo e os dados de contato da minha conta ao suporte por e-mail.</label><p>É necessário <Link href="/entrar">entrar na sua conta</Link> para enviar. Até cinco tentativas por dia.</p><div className="support-chat-choices"><button className="button button-primary" type="button" disabled={!consent || sending || !deliveryReady} onClick={send}>{sending ? "Enviando…" : "Enviar resumo ao suporte"}</button><button className="button button-ghost" type="button" disabled={sending} onClick={() => { setConsent(false); setAnswers({}); setStep(0); setStage("collect"); setError(""); add({ role: "bot", text: "Vamos corrigir as informações. " + questions[0] }); }}>Corrigir informações</button></div></div>}
    {error && <p role="alert" className="support-chat-error">{error}</p>}
    {stage === "done" && <div className="support-chat-choices">{protocol && <p role="status">Protocolo: <strong>{protocol}</strong></p>}<button className="button button-ghost" type="button" onClick={reset}>Iniciar outro atendimento</button></div>}
  </section>;
}
