import Link from "next/link";
import { History } from "lucide-react";
import { cookies } from "next/headers";
import { listProcessingTasks, sessionHash } from "@/lib/db/tasks";

import { AccountNavigation } from "@/components/account-navigation";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { getTool } from "@/lib/tools/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Histórico", description: "Histórico de tarefas PDF Master Pro." };

function formatBytes(value: number | null) { if (value === null) return "—"; if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
function formatDate(value: Date) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(value); }
function labelStatus(status: string) { return status === "completed" ? "Concluída" : status === "failed" ? "Falhou" : "Processando"; }

export default async function HistoryPage() {
  const jar = await cookies();
  const user = readSessionToken(jar.get(SESSION_COOKIE)?.value);
  const token = jar.get("pdfmaster_session")?.value;
  const tasks = token ? await listProcessingTasks(sessionHash(token)).catch(() => null) : [];
  return <div className="page-shell"><div className="page-header"><span className="eyebrow"><span className="eyebrow-dot" /> Histórico privado</span><h1>O que você processou nesta sessão.</h1><p>Guardamos somente metadados técnicos — nunca o conteúdo ou o nome dos seus documentos. Registros expiram logicamente após 2 horas.</p></div>{user && <AccountNavigation active="historico" />}{tasks === null ? <div className="empty-panel"><History size={24} /><h2>Histórico temporariamente indisponível</h2><p>A conexão com o banco não respondeu. Seus arquivos continuam não sendo persistidos.</p></div> : tasks.length === 0 ? <div className="empty-panel"><History size={24} /><h2>Nenhuma tarefa nesta sessão</h2><p>Quando você processar um arquivo, o status, a ferramenta e os tamanhos aparecerão aqui.</p><Link className="button button-primary" href="/ferramentas">Explorar ferramentas</Link></div> : <div className="history-list" aria-label="Tarefas processadas">{tasks.map((task) => <article className="history-row" key={task.id}><div><strong>{getTool(task.tool_slug)?.name ?? task.tool_slug}</strong><span>{formatDate(new Date(task.created_at))} · {task.file_count} arquivo(s) · entrada {formatBytes(task.input_bytes)}</span></div><div className="history-result"><span className={`tool-status status-${task.status === "completed" ? "ready" : task.status === "failed" ? "needs-config" : "coming-soon"}`}>{labelStatus(task.status)}</span><small>{formatBytes(task.output_bytes)}</small></div></article>)}</div>}</div>;
}
