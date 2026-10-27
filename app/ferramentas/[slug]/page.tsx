import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ToolIcon } from "@/components/icons";
import { ToolWorkspace } from "@/components/tool-workspace";
import { DivergenceWorkspace } from "@/components/divergences/workspace";
import { CloneMasterWorkspace } from "@/components/clonemaster/workspace";
import { SummaryWorkspace } from "@/components/summary/workspace";
import { LegalWorkspace } from "@/components/legal/workspace";
import { LegalAnalysisWorkspace } from "@/components/legal/analysis-workspace";
import { isLegalSuiteSlug } from "@/lib/legal/suite-config";
import { getTool, tools } from "@/lib/tools/catalog";

export async function generateStaticParams() { return tools.map((tool) => ({ slug: tool.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const tool = getTool((await params).slug); return tool ? { title: tool.name, description: tool.description } : { title: "Ferramenta não encontrada" }; }

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const tool = getTool((await params).slug);
  if (!tool) notFound();
  if (isLegalSuiteSlug(tool.slug)) return <><section className="tool-hero"><div className="tool-hero-inner"><div className="breadcrumbs"><a href="/juridico">Ferramentas Jurídicas</a><ChevronRight size={13}/><span>{tool.name}</span></div><div className="tool-title-row"><div className="tool-title-icon"><ToolIcon name={tool.icon} size={26}/></div><div><h1>{tool.name}</h1><p>{tool.description}</p></div></div></div></section>{tool.slug==="prova-compare"?<LegalWorkspace variant="proof"/>:<LegalAnalysisWorkspace key={tool.slug} tool={tool.slug}/>}</>;
  if (tool.slug === "pdf-timemachine-juridico") return <><section className="tool-hero"><div className="tool-hero-inner"><div className="breadcrumbs"><a href="/juridico">Ferramentas Jurídicas</a><ChevronRight size={13}/><span>Comparador de versões</span></div><div className="tool-title-row"><div className="tool-title-icon"><ToolIcon name={tool.icon} size={26}/></div><div><h1>{tool.name}</h1><p>{tool.description}</p></div></div></div></section><LegalWorkspace/></>;
  return <><section className="tool-hero"><div className="tool-hero-inner"><div className="breadcrumbs"><a href="/ferramentas">Ferramentas</a><ChevronRight size={13} /><span>{tool.category}</span></div><div className="tool-title-row"><div className="tool-title-icon"><ToolIcon name={tool.icon} size={26} /></div><div><h1>{tool.name}</h1><p>{tool.description}</p></div></div></div></section><div className="tool-layout">{tool.slug === "resumir-pdf-ia" ? <SummaryWorkspace /> : tool.slug === "clonemaster-ai" ? <CloneMasterWorkspace /> : tool.slug === "detector-divergencias" ? <DivergenceWorkspace /> : <ToolWorkspace tool={tool} />}<aside className="tool-sidebar"><div className="sidebar-card"><h3>O que você pode fazer</h3><ul>{tool.features.map((feature) => <li key={feature}>{feature}</li>)}</ul></div><div className="sidebar-card"><h3>Formatos</h3><p>{tool.formats.join(" · ")}</p></div><div className="sidebar-card"><h3>Privacidade</h3><p>{tool.slug === "resumir-pdf-ia" ? "O PDF vai ao processador e o texto selecionado vai ao provedor de IA somente com seu consentimento. Arquivos temporários são apagados ao fim da extração. O resumo permanece nesta página por até 30 minutos; confira também a retenção do provedor." : tool.slug === "clonemaster-ai" ? "Arquivos e resultados são processados na memória deste navegador, sem envio ao servidor. Limpe a sessão ou feche a página para descartar os dados locais." : tool.slug === "detector-divergencias" ? "Arquivos temporários são apagados ao fim do processamento. O resultado fica na memória desta página até limpar, fechar ou expirar. A IA opcional recebe trechos apenas com seu consentimento." : "Nesta versão o resultado é devolvido na sessão e não fica persistido em histórico. A retenção de 2 horas e a deleção física serão aplicadas quando storage privado e worker forem habilitados."}</p></div></aside></div></>;
}
