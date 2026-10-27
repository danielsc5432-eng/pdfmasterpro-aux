import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Sparkles } from "lucide-react";
import { ToolCard } from "@/components/tool-card";
import { HomeDropzone } from "@/components/home-dropzone";
import { tools } from "@/lib/tools/catalog";
import { DivergencePromo, DivergenceSteps } from "@/components/divergence-promo";
import "./home.css";

export const metadata: Metadata = {
  title: { absolute: "Compare PDFs e encontre divergências — PDF Master Pro" },
  description: "Compare contratos e notas fiscais em PDF com o Detector de Divergências. Confira diferenças em valores e datas, revise as evidências e baixe um relatório.",
  openGraph: {
    title: "Compare PDFs. Encontre diferenças. Confira com evidências.",
    description: "Compare contratos e notas fiscais em PDF com evidências por página e revisão humana no Detector de Divergências do PDF Master Pro.",
    images: [{ url: "/brand/pdfmasterpro-full.png", width: 1536, height: 1024, alt: "PDF Master Pro — Detector de Divergências" }],
  },
};

export default function HomePage() {
  const popular = tools.filter((tool) => tool.popular);
  return (
    <>
      <DivergencePromo />
      <DivergenceSteps />

      <section className="section" aria-labelledby="popular-heading">
        <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> Comece por aqui</span><h2 id="popular-heading">Ferramentas populares</h2><p>Fluxos diretos para as tarefas que mais aparecem no seu dia a dia.</p></div><Link className="text-link" href="/ferramentas">Ver catálogo completo <ArrowRight size={14} style={{ verticalAlign: "middle" }} /></Link></div>
        <div className="tool-grid">{popular.map((tool) => <ToolCard key={tool.slug} tool={tool} />)}</div>
      </section>

      <section className="section" aria-labelledby="utilities-heading">
        <div className="home-utilities"><div><span className="eyebrow"><span className="eyebrow-dot" /> Seus outros fluxos continuam aqui</span><h2 id="utilities-heading">Todas as suas ferramentas de PDF, no mesmo lugar.</h2><p>Além de comparar documentos, você pode juntar, converter, organizar e proteger seus arquivos. Escolha o próximo passo.</p><div className="home-utility-links"><Link href="/ferramentas/juntar-pdf">Juntar PDFs <ArrowRight size={14} /></Link><Link href="/ferramentas/pdf-para-word">PDF para Word <ArrowRight size={14} /></Link><Link href="/ferramentas/comprimir-pdf">Comprimir PDF <ArrowRight size={14} /></Link><Link href="/ferramentas">Ver todas as ferramentas <ArrowRight size={14} /></Link></div></div><HomeDropzone /></div>
      </section>

      <section className="section" aria-labelledby="faq-heading"><div className="section-heading"><div><span className="eyebrow"><Sparkles size={13} /> Perguntas frequentes</span><h2 id="faq-heading">Antes de comparar</h2></div></div><div className="faq-grid"><details><summary>Posso experimentar sem criar conta?</summary><p>Sim. O detector está disponível para visitantes dentro da cota gratuita e dos limites de arquivos indicados na ferramenta.</p></details><details><summary>Posso comparar notas fiscais?</summary><p>Sim. Compare notas fiscais em PDF para conferir diferenças em valores, datas e dados que a ferramenta conseguir identificar, sempre com os trechos para revisão. Prefira PDFs com texto selecionável. A comparação não verifica a autenticidade da nota nem consulta a SEFAZ.</p></details><details><summary>Como a IA ajuda na comparação?</summary><p>Após a comparação, você pode autorizar o download de um modelo que roda no navegador e compara a semelhança entre trechos de cláusulas. A pontuação auxilia sua revisão; ela não confirma equivalência dos documentos.</p></details><details><summary>Posso compartilhar o resultado?</summary><p>Você pode registrar suas decisões e baixar um relatório PDF com todos os achados, trechos, páginas e observações. Confira sempre as fontes antes de concluir a revisão.</p></details></div></section>

      <section className="section"><div className="cta-panel"><div><h2>Descubra o que mudou entre seus PDFs.</h2><p>Compare as versões, confira o que mudou e registre sua revisão.</p></div><Link className="button" style={{ background: "white", color: "#5B5BD6" }} href="/ferramentas/detector-divergencias">Experimentar o detector <ArrowRight size={16} /></Link></div></section>
    </>
  );
}
