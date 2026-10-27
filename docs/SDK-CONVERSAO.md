# PDF Master Pro SDK — versão experimental interna

Atualização: o novo candidato de fluxo nativo por página melhorou os dois formulários de referência. Resultados e limites em `RECONSTRUCAO-LAYOUT-2026-10-24.md`. As limitações de IA descritas abaixo continuam válidas; a melhora veio de reconstrução determinística própria, sem API paga.

## Entrega implementada

`lib/pdf-sdk` oferece API TypeScript reutilizável para registrar motores, reconstruir DOCX editável e conferir candidatos. Implementação própria sobre componentes existentes, sem APIs comerciais e sem copiar código dos clones de avaliação. Ainda não é um pacote npm publicado nem substituto comprovado de Apryse/Solid Documents.

- `model.ts`: modelo de páginas e palavras com IDs, geometria e estilo. Propostas contêm somente referências, não textos substitutos. Referências inventadas, repetidas, fora da página ou com ordem física invertida são recusadas. Campos extras são descartados.
- `render.ts`: reconstrução experimental de tabelas nativas do Word, colunas fixas e posicionamento por página. Demais palavras e elementos gráficos são preservados pelo renderizador existente. Dimensões e valores vêm da fonte; não são gerados pela IA.
- `docling-planner.ts`: adaptador para geometria de tabelas reconhecida pelo Docling, um modelo gratuito que pode ser executado em infraestrutura própria. Consome JSON já produzido pelo modelo; não chama serviço remoto nem treina um modelo novo. Células mescladas e geometrias ambíguas não são suportadas nesta versão.
- `index.ts`: registro de motores, candidatos posicionais/OCR e pdf2docx, classificação de fidelidade, auditoria sem conteúdo do documento e rejeição de perdas medidas de texto/números/páginas. Candidato com IA só substitui outro após avaliação. Nenhum endpoint externo ou provedor de IA é habilitado implicitamente.

Foi adicionado um ponto de extensão opcional a `pdfToDocx` para reutilizar a extração de fontes, geometria, imagens, vetores e OCR antes da reconstrução. Sem esse argumento, o fluxo existente permanece igual.

## Uso programático

```ts
import { createPdfMasterSdk } from "../lib/pdf-sdk";
import { doclingTablePlanner } from "../lib/pdf-sdk/docling-planner";

const sdk = createPdfMasterSdk({
  // Opcional: JSON da inferência real do Docling, em coordenadas da página.
  planner: doclingTablePlanner(doclingJson),
});
const result = await sdk.convert(pdfBytes, { name: "documento.pdf" });
// result.output: DOCX; result.report e result.audit: evidências de qualidade.
// status review exige revisão; unavailable significa conferência indisponível.
```

Sem `planner`, o SDK usa os motores atuais. Não representa uma conversão feita por IA. O adaptador de Docling conecta previsões de um modelo existente à reconstrução restrita; não há treinamento próprio de LLM ou visão nesta entrega.

## Linha de comando

```sh
pnpm convert:sdk origem.pdf resultado.docx
pnpm convert:sdk origem.pdf resultado.docx --docling-layout resultado-docling.json
```

Gera DOCX e relatório `resultado.docx.quality.json`; não sobrescreve arquivos existentes. Requer Poppler, Ghostscript, Tesseract, Python/pdf2docx e LibreOffice conforme a configuração existente. Não garante prazo rígido de cancelamento durante processos nativos: o sinal é observado entre etapas, e cada processo usa seu próprio timeout.

## Validação em 24/10/2026

- 91 testes aprovados, TypeScript e build de produção aprovados.
- Reconstrução de tabela sintética: valor `1.234,56` mantido exatamente uma vez no texto editável; dimensões de página preservadas; tabela nativa presente no DOCX.
- SDK completo com DTC: 3 páginas, cobertura de texto e números 100%, status review. Selecionou pdf2docx. O JSON real do Docling tinha zero tabelas: nenhuma melhoria de IA foi aceita.
- SDK completo com INSS: 2 páginas, cobertura de texto e números 100%, status review. Selecionou pdf2docx.
- Um renderizador alternativo com VML foi experimentado, mas reduziu a paginação na renderização LibreOffice; foi descartado e não faz parte da API entregue.

As coberturas acima medem conteúdo do DOCX, não identidade visual universal. Os desvios visuais previamente documentados continuam. Não houve melhora comprovada de layout nesses formulários por IA. O SDK está disponível para testes internos; não foi ativado na rota de produção nem foi feito deploy nesta entrega.

## Limitações e próximos critérios

Antes de ativar a reconstrução assistida, validar com o Microsoft Word, ampliar os casos de teste sem expor documentos pessoais, tratar células mescladas, ajustar geometria vertical e validar o mapeamento de coordenadas da versão específica do modelo. Qualquer modelo futuro deve fornecer propostas de estrutura, nunca substituir textos ou valores. Um modelo livre continua exigindo recursos de processamento; não implica hospedagem gratuita ilimitada.

Componentes e licenças de dependências continuam aplicáveis, incluindo PyMuPDF. Clones AGPL de comparação permanecem ignorados. Não declarar todo o conjunto como código próprio ou como licença MIT sem verificar as licenças das dependências.

## Atualização posterior: candidato Unicode e direcional

O SDK e a seleção automática do site agora incluem `native-unicode-layout`: extração PyMuPDF com caracteres, baseline e direções; tabelas Word com direção nativa para 90°/270°; fallback posicionado em geometria incompatível. Os resultados continuam sendo medidos antes da seleção. Não há rasterização de páginas inteiras para simular texto editável.

O OCR possui pré-processamento limitado de contraste, binarização e deskew com transformação inversa de coordenadas. A substituição de uma tentativa de OCR não pode alterar silenciosamente os termos numéricos da tentativa original. OCR continua exigindo revisão.

O histórico de validação acima descreve versões anteriores. Os resultados mais recentes e as limitações estão em [ROBUSTEZ-CONVERSAO-2026-10-24.md](./ROBUSTEZ-CONVERSAO-2026-10-24.md). O adaptador de Docling continua opcional; esta atualização não representa treinamento de um modelo de IA nem ativação de um serviço externo.

## Roteamento por página e recuperação

O candidato nativo agora decide a montagem por página, preservando documentos mistos em um único pacote Word. A rota automática identifica formulários, digitalizações e texto girado antes da primeira tentativa; falhas individuais podem seguir para alternativas verificadas. Resultados aprovados têm prioridade sobre candidatos em revisão. Testes, resultados e limites estão em [AUTONOMIA-CONVERSAO-2026-10-24.md](./AUTONOMIA-CONVERSAO-2026-10-24.md).
