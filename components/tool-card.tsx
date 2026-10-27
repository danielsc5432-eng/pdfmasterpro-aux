import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock3, Settings2 } from "lucide-react";
import type { ToolDefinition } from "@/lib/tools/catalog";
import { ToolIcon } from "@/components/icons";

const statusLabel = { ready: "Disponível", "needs-config": "Requer configuração", "coming-soon": "Em preparação" } as const;

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const StatusIcon = tool.status === "ready" ? CheckCircle2 : tool.status === "needs-config" ? Settings2 : Clock3;
  return (
    <Link className="tool-card" href={`/ferramentas/${tool.slug}`} aria-label={`Abrir ${tool.name}`}>
      <div className="tool-card-icon"><ToolIcon name={tool.icon} /></div>
      <h3>{tool.name}</h3>
      <p>{tool.description}</p>
      <div className="tool-card-footer"><span className="tool-card-formats">{tool.formats.join(" · ")}</span>{tool.premium ? <span className="tool-card-premium">Premium</span> : null}<span className={`tool-status status-${tool.status}`}><StatusIcon size={12} />{statusLabel[tool.status]}</span></div>
      <ArrowUpRight className="card-arrow" size={16} aria-hidden="true" />
    </Link>
  );
}
