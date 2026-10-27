import Link from "next/link";
import { ArrowRight, FileSearch, FileText, ListChecks, MapPin, Sparkles } from "lucide-react";

const detectorUrl = "/ferramentas/detector-divergencias";

export function DivergencePromo() {
  return (
    <section className="hero flagship-hero" aria-labelledby="flagship-title">
      <div className="hero-grid flagship-grid">
        <div className="flagship-copy">
          <span className="flagship-badge"><FileSearch size={15} aria-hidden="true" /> Conheça nosso destaque</span>
          <p className="flagship-name">Detector de Divergências</p>
          <h1 id="flagship-title">Compare PDFs.<br /><em>Encontre diferenças.</em><br />Confira com evidências.</h1>
          <p className="hero-copy">Um valor mudou? Uma data não bate? Compare contratos e notas fiscais em PDF para encontrar possíveis diferenças em valores, datas e dados descritos nos documentos. Confira os trechos e as páginas de cada achado.</p>
          <div className="hero-actions">
            <Link className="button button-primary flagship-cta" href={detectorUrl}>Comparar meus PDFs <ArrowRight size={17} aria-hidden="true" /></Link>
            <a className="button button-ghost" href="#como-comparar">Ver como funciona</a>
          </div>
          <ul className="flagship-points" aria-label="Recursos do detector">
            <li><FileText size={15} aria-hidden="true" /> De 2 a 5 PDFs</li>
            <li><MapPin size={15} aria-hidden="true" /> Trechos e páginas</li>
            <li><Sparkles size={15} aria-hidden="true" /> IA opcional no navegador</li>
          </ul>
          <p className="flagship-note">Você confere as fontes e decide quais diferenças são relevantes.</p>
        </div>

        <figure className="comparison-preview" aria-labelledby="preview-title">
          <div className="preview-top"><span><FileSearch size={18} aria-hidden="true" /><strong id="preview-title">Uma diferença merece atenção.</strong></span><span className="preview-example">Exemplo ilustrativo</span></div>
          <div className="preview-documents">
            <article className="preview-document" aria-label="Documento de exemplo, versão A">
              <div className="preview-document-label"><FileText size={15} aria-hidden="true" /> VERSÃO A <span>PDF</span></div>
              <h2>Nota fiscal de exemplo</h2><p className="preview-reference">Nota 123 · Página 1</p>
              <div className="preview-rule" /><div className="preview-rule short" />
              <div className="preview-field"><span>Valor total</span><strong>R$ 1.250,00</strong></div>
              <div className="preview-field"><span>Data de emissão</span><strong>15/10/2026</strong></div>
              <div className="preview-rule" /><div className="preview-rule short" />
            </article>
            <article className="preview-document" aria-label="Documento de exemplo, versão B">
              <div className="preview-document-label"><FileText size={15} aria-hidden="true" /> VERSÃO B <span>PDF</span></div>
              <h2>Nota fiscal de exemplo</h2><p className="preview-reference">Nota 123 · Página 1</p>
              <div className="preview-rule" /><div className="preview-rule short" />
              <div className="preview-field changed"><span>Valor diferente</span><strong>R$ 1.520,00</strong></div>
              <div className="preview-field changed"><span>Data diferente</span><strong>20/10/2026</strong></div>
              <div className="preview-rule" /><div className="preview-rule short" />
            </article>
          </div>
          <div className="preview-result"><span className="preview-result-icon"><ListChecks size={21} aria-hidden="true" /></span><div><strong>2 pontos para revisar</strong><span>Confira cada diferença na página original.</span></div><span className="preview-review">Revisão pendente</span></div>
          <figcaption>Dados fictícios para demonstrar a comparação. Os resultados reais dependem dos documentos enviados.</figcaption>
        </figure>
      </div>
    </section>
  );
}

export function DivergenceSteps() {
  return (
    <section className="section flagship-how" id="como-comparar" aria-labelledby="comparison-how-title">
      <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> Da comparação à decisão</span><h2 id="comparison-how-title">A diferença aparece. A fonte também.</h2><p>Um fluxo para comparar, conferir e compartilhar sua revisão.</p></div><Link className="text-link" href={detectorUrl}>Experimentar o detector <ArrowRight size={15} aria-hidden="true" /></Link></div>
      <div className="feature-band">
        <div className="feature-card flagship-step"><span className="flagship-step-number">01</span><h3>Compare os documentos</h3><p>Envie de 2 a 5 PDFs, como contratos ou notas fiscais, e escolha o que conferir: valores, datas, nomes, cláusulas ou campos não localizados.</p></div>
        <div className="feature-card flagship-step"><span className="flagship-step-number">02</span><h3>Confira as evidências</h3><p>Veja os trechos lado a lado e abra as páginas originais. A IA opcional ajuda a comparar a semelhança de cláusulas.</p></div>
        <div className="feature-card flagship-step"><span className="flagship-step-number">03</span><h3>Leve sua revisão com você</h3><p>Registre suas observações e baixe um relatório PDF com os achados, as fontes e as suas decisões.</p></div>
      </div>
      <p className="flagship-how-note">A análise funciona melhor com PDFs de texto selecionável. Arquivos digitalizados podem exigir OCR e gerar resultados parciais.</p>
    </section>
  );
}
