"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, FileSearch, History, RefreshCw, Save, UserRound } from "lucide-react";
import type { AccountData } from "@/lib/account/profile";
import { tools, getTool } from "@/lib/tools/catalog";
import { formatFileSize } from "@/lib/plans";
import { ThemePreferences } from "./theme-preferences";

function date(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
export function AccountWorkspace({ mode }: { mode: "overview" | "profile" }) {
  const [data, setData] = useState<AccountData | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [name, setName] = useState(""), [favorite, setFavorite] = useState("detector-divergencias"), [message, setMessage] = useState(""), [error, setError] = useState(""), [expired, setExpired] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/account/profile", { cache: "no-store", signal });
      if (response.status === 401) { setExpired(true); return; }
      const next = await response.json();
      if (!response.ok) throw Error(next.error || "Não foi possível carregar sua conta.");
      setData(next); setName(next.preferences.displayName); setFavorite(next.preferences.preferredTool);
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar sua conta."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/account/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name, preferredTool: favorite }) });
      const result = await response.json();
      if (response.status === 401) { setExpired(true); return; }
      if (!response.ok) throw Error(result.error || "Não foi possível salvar.");
      setData(previous => previous ? { ...previous, preferences: result.preferences, user: { ...previous.user, name: result.preferences.displayName } } : previous);
      setName(result.preferences.displayName); setMessage("Perfil atualizado com sucesso.");
      window.dispatchEvent(new Event("pdfmaster:account-updated"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  function exportProfile() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile: data.user, preferences: data.preferences, memberSince: data.memberSince, plan: data.plan }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "meu-perfil-pdfmasterpro.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  if (expired) return <div className="empty-panel"><h2>Sua sessão expirou</h2><p>Entre novamente para acessar seus dados.</p><Link className="button button-primary" href="/entrar">Entrar</Link></div>;
  if (loading && !data) return <p role="status" className="account-loading">Carregando sua conta…</p>;
  if (!data) return <div className="empty-panel"><p role="alert">{error}</p><button className="button button-ghost" onClick={() => void load()}>Tentar novamente</button></div>;
  const initials = data.user.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
  const preferred = getTool(data.preferences.preferredTool)!;
  const plan = data.plan;
  return <div className="account-workspace">
    <section className="account-identity"><span className="account-avatar" aria-hidden="true">{initials || <UserRound />}</span><div><h2>{data.user.name}</h2><p>{data.user.email}</p><span>Acesso com {data.user.provider}{data.memberSince ? ` · membro desde ${date(data.memberSince)}` : ""}</span></div><button className="button button-ghost" disabled={loading || saving} onClick={() => void load()}><RefreshCw size={15} /> Atualizar dados</button></section>
    {!data.storageAvailable && <p className="account-notice" role="status">Os dados salvos da conta estão temporariamente indisponíveis. Você pode continuar usando as ferramentas e tentar atualizar esta página depois.</p>}
    {error && <p className="account-error" role="alert">{error}</p>}{message && <p className="account-success" role="status">{message}</p>}
    <div className="account-summary">
      <article className="account-card"><span className="account-label">Seu plano</span><h3>{plan?.name ?? "Não disponível agora"}</h3><p>{plan ? `${formatFileSize(plan.maxFileBytes)} por arquivo · até ${plan.maxFiles} arquivos por tarefa` : "Atualize os dados para consultar o plano."}</p>{plan?.until && <p>Período atual até {date(plan.until)}.</p>}<Link className="text-link" href={plan?.premium ? "/configuracoes" : "/precos"}>{plan?.premium ? "Gerenciar assinatura" : "Conhecer os planos"} <ArrowRight size={14} /></Link></article>
      <article className="account-card"><span className="account-label">Uso da cota gratuita</span><h3>{data.usage === null ? "Não disponível agora" : `${data.usage} tarefa${data.usage === 1 ? "" : "s"}`}</h3><p>Na janela de 24 horas{plan ? plan.dailyLimit === null ? " · sem limite diário no plano" : ` · cota de ${plan.dailyLimit}` : ""}.</p>{plan?.dailyLimit && data.usage !== null ? <progress aria-label="Uso da cota de tarefas" max={plan.dailyLimit} value={Math.min(data.usage, plan.dailyLimit)} /> : null}<Link className="text-link" href="/historico">Ver histórico <History size={14} /></Link></article>
      <article className="account-card"><span className="account-label">Seu atalho</span><h3>{preferred.name}</h3><p>Escolha sua ferramenta preferida em Meu perfil.</p><Link className="button button-primary" href={`/ferramentas/${preferred.slug}`}>Abrir ferramenta <ArrowRight size={15} /></Link></article>
    </div>
    {mode === "profile" ? <div className="account-columns"><section className="account-card"><h3>Dados e preferências</h3><form className="profile-form" onSubmit={save}><label htmlFor="profile-name">Como você quer ser chamado?</label><input id="profile-name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required disabled={!data.storageAvailable || saving} autoComplete="name" /><label htmlFor="profile-email">E-mail da conta</label><input id="profile-email" value={data.user.email} readOnly type="email" aria-describedby="email-help" /><small id="email-help">O endereço é confirmado no cadastro ou pelo provedor de login. Ele não pode ser alterado por este formulário.</small><label htmlFor="profile-favorite">Ferramenta preferida</label><select id="profile-favorite" value={favorite} onChange={event => setFavorite(event.target.value)} disabled={!data.storageAvailable || saving}>{tools.map(tool => <option key={tool.slug} value={tool.slug}>{tool.name}{tool.premium ? " · Premium" : ""}</option>)}</select><button className="button button-primary" type="submit" disabled={!data.storageAvailable || saving}><Save size={15} /> {saving ? "Salvando…" : "Salvar alterações"}</button></form></section><section className="account-card"><h3>Privacidade e acesso</h3><p>Seu perfil guarda o nome de exibição e a ferramenta preferida. O histórico desta sessão registra metadados técnicos; os registros ficam visíveis por até duas horas.</p><p>A exportação abaixo contém os dados exibidos do seu perfil e plano. Seus PDFs e relatórios não fazem parte desse arquivo.</p><button className="button button-ghost" onClick={exportProfile}><Download size={15} /> Exportar dados do perfil</button><div className="account-links"><Link href="/privacidade">Política de privacidade</Link><Link href="/contato">Falar com o suporte</Link></div><form action="/api/auth/logout" method="post"><button className="button button-ghost" type="submit">Sair da conta neste dispositivo</button></form></section></div>
      : <div className="account-columns"><section className="account-card"><h3>Continue seu trabalho</h3><Link className="account-feature-link" href="/ferramentas/detector-divergencias"><FileSearch size={24} /><span><strong>Compare seus PDFs</strong><small>Confira valores, datas e cláusulas com evidências.</small></span><ArrowRight size={17} /></Link><div className="account-links"><Link href="/perfil">Personalizar meu perfil</Link><Link href="/ferramentas">Explorar ferramentas</Link></div></section><section className="account-card"><h3>Atividade recente</h3>{data.recent === null ? <p>Não foi possível carregar o histórico agora.</p> : !data.recent.length ? <p>Sua próxima tarefa aparecerá aqui. O histórico é restrito a esta sessão.</p> : <ul className="account-recent">{data.recent.map(task => <li key={task.id}><strong>{task.tool}</strong><span>{task.status === "completed" ? "Concluída" : task.status === "failed" ? "Falhou" : "Processando"} · {date(task.createdAt)}</span></li>)}</ul>}<Link className="text-link" href="/historico">Abrir histórico completo <ArrowRight size={14} /></Link></section></div>}
    {mode === "profile" && <ThemePreferences />}
  </div>;
}
