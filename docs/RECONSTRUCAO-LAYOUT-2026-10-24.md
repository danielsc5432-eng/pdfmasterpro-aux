# Reconstrução de layout — melhoria medida em 24/10/2026

## Pesquisa e implementação

Referências públicas consultadas:

- [pdf2docx / análise de layout](https://github.com/ArtifexSoftware/pdf2docx/blob/master/pdf2docx/layout/Layout.py): fluxo, alinhamentos e espaçamento vertical.
- [pdfplumber](https://github.com/jsvine/pdfplumber): interpretação geométrica do alinhamento de palavras e limites de células.
- [docx / tabelas](https://github.com/dolanmiu/docx/blob/master/docs/usage/tables.md): recursos nativos de altura de linhas e largura fixa.
- [Apryse / saída estruturada](https://apryse.com/blog/webviewer/accurate-header-footer-extraction): referência de comportamento, não acesso ao código proprietário.

Foi escrito um renderizador próprio em `lib/pdf-sdk/page-grid.ts`. Não foi copiado código proprietário de Solid Documents/Apryse nem incorporado código de clones AGPL. TypeScript monta o DOCX; os componentes existentes Python e nativos continuam responsáveis por extração e conferência. Nenhuma nova API paga, modelo de IA ou linguagem adicional foi instalado sem necessidade.

## Mudança concreta

Antes: quadros flutuantes por linha. O DOCX tinha o conteúdo, mas a renderização LibreOffice escondia ou deslocava parte dos campos.

Agora: fluxo nativo por página, com uma tabela de organização de uma coluna, linhas de altura controlada e tabulações nas coordenadas originais. Essa tabela preserva a disposição; não significa que todas as tabelas financeiras já tenham células semânticas separadas. Textos permanecem editáveis e os elementos gráficos são reutilizados.

Fontes diferentes na mesma linha são agrupadas pela linha de base, não pelo topo. A primeira tentativa usava o topo e cortava rótulos; a inspeção visual encontrou isso, o algoritmo foi corrigido e foi adicionado teste de regressão. Espaçamento do texto e altura de faixa são tratados separadamente.

O candidato foi incluído tanto no SDK quanto no fluxo automático. Só substitui o resultado anterior quando a avaliação de fidelidade o considera melhor. Falhas retornam ao candidato previamente medido.

## Comparação real

Mesmos PDFs de referência e cópias de extração usados nos testes anteriores. Renderização via LibreOffice; comparação com PyMuPDF/OpenCV:

| Métrica | DTC antes (pdf2docx) | DTC novo | INSS antes (pdf2docx) | INSS novo |
| --- | --- | --- | --- | --- |
| Páginas | 3 | 3 | 2 | 2 |
| Tamanho das páginas preservado | Sim | Sim | Sim | Sim |
| Texto editável no DOCX | 100% | 100% | 100% | 100% |
| Termos numéricos editáveis | 100% | 100% | 100% | 100% |
| Cobertura textual da renderização | 93,32% | 100% | 98,84% | 99,54% |
| Correspondência de posições numéricas | 5,56% | 100% | 12,12% | 100% |
| Similaridade visual | 38,99% | 98,23% | 55,60% | 98,29% |

A comparação com o motor posicional anterior também mostra aumento visual: DTC 55,52% → 98,23%; INSS 57,55% → 98,29%.

Esses percentuais são métricas do projeto, com tolerância de rasterização, não uma porcentagem universal de identidade. Não comprovam equivalência ao Apryse nem garantem qualquer PDF. Há diferenças residuais e a validação no Microsoft Word ainda precisa ser concluída. A inspeção visual local da primeira página dos dois documentos confirmou campos, rótulos e valores legíveis após a correção.

Artefatos privados ignorados: `.vercel/review/SDK-grid-DTC.docx`, `SDK-grid-INSS.docx`, `sdk-grid-benchmark.json`, `grid-proof/`. Não publicar documentos pessoais no GitHub.

## Publicação

- Commit publicado: `6b38584`.
- 93 testes aprovados, TypeScript e builds local, Vercel e Render aprovados.
- Vercel: `dpl_44ntTRFSUNhZkVau6bA6gstgVJhq`, Ready e domínio www.pdfmasterpro.com.br atualizado.
- Render: `dep-dbefn5tg1s2s739cail0`, Live, serviço existente `srv-dbakp36q1p3s73c2er70`.
- Conversão real pelo domínio público: DTC HTTP 200, fidelity checked, 3 → 3 páginas, DOCX usando o novo fluxo nativo.
- Conversão real pelo domínio público: INSS HTTP 200, fidelity checked, 2 → 2 páginas, DOCX usando o novo fluxo nativo.
- A publicação não ativou serviços externos Docling/Stirling, não contratou plano pago e não enviou documentos pessoais ao repositório.
