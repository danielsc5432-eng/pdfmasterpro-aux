import { Search } from "lucide-react";
import Link from "next/link";
import { ToolCard } from "@/components/tool-card";
import { categories, tools } from "@/lib/tools/catalog";

export const metadata = { title: "Ferramentas para PDF", description: "Explore o catálogo de ferramentas do PDF Master Pro." };

type SearchParams = Promise<{ busca?: string | string[]; categoria?: string | string[] }>;

export default async function ToolsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = typeof params.busca === "string" ? params.busca.trim() : "";
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const query = normalize(search);
  const selectedCategory = typeof params.categoria === "string" && categories.includes(params.categoria) ? params.categoria : "Todos";
  const categoryUrl = (category: string) => {
    const next = new URLSearchParams();
    if (search) next.set("busca", search);
    if (category !== "Todos") next.set("categoria", category);
    return `/ferramentas${next.size ? `?${next}` : ""}`;
  };
  const filtered = tools.filter(tool => (selectedCategory === "Todos" || tool.category === selectedCategory) && (!query || normalize(`${tool.name} ${tool.description} ${tool.category}`).includes(query)));
  return <div className="page-shell">
    <div className="page-header"><span className="eyebrow"><span className="eyebrow-dot" /> Catálogo de ferramentas</span><h1>Encontre o fluxo certo para o seu PDF.</h1><p>Do primeiro upload ao arquivo final, cada ferramenta explica seus formatos, capacidades e limites antes de começar.</p></div>
    <nav className="category-row" style={{ marginTop: 32 }} aria-label="Filtrar ferramentas por categoria">{categories.map(category => <Link className={`category-pill${selectedCategory === category ? " active" : ""}`} key={category} href={categoryUrl(category)} scroll={false} aria-current={selectedCategory === category ? "page" : undefined}>{category}</Link>)}</nav>
    <p className="catalog-result-count" role="status">{filtered.length} ferramenta{filtered.length === 1 ? "" : "s"}{selectedCategory !== "Todos" ? ` em ${selectedCategory}` : " disponíveis"}{search ? ` para “${search}”` : ""}.</p>
    {filtered.length > 0 ? <div className="tool-grid">{filtered.map(tool => <ToolCard key={tool.slug} tool={tool} />)}</div> : <div className="empty-panel"><Search size={24} color="var(--muted)" /><h2>Nenhuma ferramenta encontrada</h2><p>Tente outra categoria ou outro termo de busca.</p><Link className="button button-ghost" href="/ferramentas" scroll={false}>Limpar filtros e busca</Link></div>}
  </div>;
}
