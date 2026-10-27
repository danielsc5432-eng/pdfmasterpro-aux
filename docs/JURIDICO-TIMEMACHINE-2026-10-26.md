# PDF Master Pro Jurídico — implementação local de 26/10/2026

> Registro da primeira etapa. As seis ferramentas inicialmente planejadas foram implementadas posteriormente; veja [a entrega da suíte jurídica](JURIDICO-SUITE-2026-10-26.md) para o estado atual, funcionalidades e validação.

## Auditoria e arquitetura proposta

A auditoria foi realizada antes de editar: Next.js 16.4.2/React 19/TypeScript, catálogo com 20 ferramentas, páginas dinâmicas por slug, Vercel para o frontend e Render para conversões nativas. Já havia `pdf-lib`, `docx`, `jszip`, fontes locais, comparação por regras e controles de cota. O comparador existente detectava campos, mas não fazia extração/renderização de PDFs no navegador nem alinhamento de versões por blocos. Não foi removido ou substituído.

O plano apresentado foi criar a categoria, extrair e alinhar texto localmente, integrar visualizador e classificação, gerar relatórios, adicionar versões consecutivas, OCR local e comparação visual, e validar com documentos de diferenças conhecidas. As seis ferramentas futuras seriam apenas planejadas. Nenhuma publicação automática seria feita.

### Componentes entregues

| Responsabilidade | Implementação |
| --- | --- |
| Upload e versões | `components/legal/workspace.tsx`: duas entradas principais, arrastar/soltar, versões adicionais, nomes/datas informados pelo usuário, ordem editável e limites |
| Extração | `lib/legal/pdf.ts` e `extract.ts`: PDF.js, posições dos textos, validação de arquivo/páginas, assinatura SHA-256 dos bytes |
| Estrutura e cláusulas | `structure.ts`: linhas e blocos com coordenadas, cláusulas numeradas, artigos, alguns ordinais e títulos jurídicos; possíveis linhas de tabela por disposição horizontal |
| Alinhamento | `compare.ts`: correspondência exata, número de cláusula ou rótulo único, linhas de tabela com chave única e candidatos por palavras/similaridade; não depende apenas do número da página |
| Texto e classificação | Inclusão, trecho não localizado, modificação, movimentação ou inconclusivo; valores, percentuais, datas, prazos, quantidades, partes, cláusulas e possíveis tabelas |
| Paginação | Correspondências textuais ou visuais, páginas inseridas/removidas quando localizáveis, contagem objetiva; redistribuição de texto idêntico não é apresentada como inclusão/exclusão textual |
| Comparação visual | Amostras em escala de cinza de 96 × 136 pixels, diferença percentual da amostra, região delimitada e alterações de dimensões da página |
| OCR | `LocalOCRProcessor`, Tesseract.js em worker local, idiomas português/inglês, confiança média e avisos; sem fallback remoto |
| Comparação em background | `compare-worker.ts`, encerrado em cancelamento ou tempo limite |
| Evidências | `legalEvidenceValid`: documento, página, bloco, citação e coordenadas conferidos no conteúdo extraído |
| Visualizador | `components/legal/viewer.tsx`: dois canvases, zoom, páginas, realce, navegação por alteração, adaptação à largura e rolagem sincronizada somente com páginas alinhadas de forma não posicional |
| Revisão humana | Situação e observações por achado, preservadas nos relatórios sem alterar as citações originais |
| Relatórios | `report.ts`: PDF, DOCX, TXT e CSV; documentos, ordem/datas informadas, data da análise, totais, categorias, antes/depois, fontes, comentários e limitações; CSV neutraliza fórmulas |
| Integração futura de IA | Somente a interface `LegalSemanticReviewAdapter`, sem modelo ou API externa conectados |

## Categoria e navegação

- `/juridico`: página PDF Master Pro Jurídico / Ferramentas Jurídicas.
- `/ferramentas/pdf-timemachine-juridico`: ferramenta funcional nesta versão local.
- Categoria Jurídico no catálogo, link na navegação e entrada no sitemap.
- ContractCheck AI, ProcessoTimeline, JurisOrganize, ProvaCompare, PrazoExtractor e PetiçãoReview aparecem com “Planejado · ainda não disponível”, sem botões de execução ou rotas fictícias.
- As ferramentas preexistentes continuam no catálogo. A API genérica de processamento recusa o slug do TimeMachine para não encaminhar documentos desta ferramenta ao processador remoto.

## Fluxo de dados e segurança

1. O usuário seleciona PDFs e configura a comparação. Nenhuma página é enviada a servidor.
2. Um POST sem corpo em `/api/legal/quota` reserva uma tarefa na cota compartilhada. Reutiliza plano verificado no servidor, cookie assinado de navegador, conta e proteção de rede. Premium segue sem cota diária de tarefas, mantendo limites técnicos.
3. PDF.js extrai e renderiza localmente, com parser em worker. Não há iframe de PDF, camada de links ou gerenciador de scripts PDF; XFA fica desativado. Aparências visíveis de anotações podem ser desenhadas em canvas sem ativar ações interativas.
4. O OCR só é usado quando habilitado e necessário. Worker, WASM e idiomas são carregados do próprio site. Imagens vão apenas ao worker local. O cache persistente de idiomas do Tesseract foi desativado; arquivos de código/modelos públicos podem continuar no cache HTTP normal do navegador.
5. Comparação e relatórios são locais. Não há envio ao Groq, Cloudflare Workers AI ou outros modelos existentes no site.
6. Anúncios não carregam nas rotas jurídicas. Ao entrar no comparador por navegação interna de uma página que já carregou o script de anúncios, a página é recarregada antes de selecionar arquivos para remover o contexto anterior.
7. Limpar, fechar ou expirar descarta dados em memória; workers são encerrados e URLs de download revogadas. Sessão local/resultados expiram em 30 minutos. Downloads já salvos no dispositivo não são apagados pelo site.

Não há log intencional de conteúdo de documentos, modelo remoto, armazenamento de PDFs no banco ou uso para treinamento. O servidor recebe apenas a reserva de cota e requisições de assets. O controle de cota vale para o fluxo oficial; um cliente modificado continua podendo executar código local fora da interface, como já ocorre no CloneMaster. Não se declara bloqueio absoluto desse desvio nem conformidade jurídica formal certificada.

## Limites desta versão

| Recurso | Limite |
| --- | --- |
| Versões | 2 a 4; comparações consecutivas |
| Arquivos | 5 MB por PDF e 12 MB no conjunto |
| Páginas | 30 por arquivo e 60 no conjunto |
| Texto | 120.000 caracteres e 500 blocos por arquivo; páginas com complexidade textual excessiva são recusadas |
| Achados | 300; truncamento informado |
| OCR | 5 páginas por análise, por+eng |
| Renderização | Aproximadamente 2 milhões de pixels por canvas; imagem fonte limitada no parser a 16 milhões de pixels |
| Duração | 180 segundos, com cancelamento |
| Cota gratuita | Uma análise consome uma das dez tarefas compartilhadas por janela de 24 horas; tentativa autorizada não é devolvida em falha/cancelamento |

## Dependências e custos

Novas dependências fixadas: `pdfjs-dist@6.4.299` e `tesseract.js@7.0.0`, ambas Apache-2.0. Foram reutilizados `pdf-lib`, `docx`, `jszip`, `@pdf-lib/fontkit`, a fonte Noto e as funções de normalização existentes. Não foi instalada biblioteca de diff redundante: o alinhamento usa regras limitadas e o destaque mostra prefixo/sufixo comuns com o trecho alterado, preservando Unicode.

PDF.js requer Node 22.13+ ou 24+ para o tooling; o ambiente local usa Node 24, e o Docker existente usa Node 22. O build e TypeScript foram verificados. O postinstall opcional do Tesseract não foi liberado nem necessário para o OCR de navegador testado.

Os idiomas são de [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast), revisão fixa `87416418657359cb625c412a48b6e1d6d41c29bd`. `public/legal-assets/ocr/lang/manifest.json` registra hashes, tamanhos e origem. As licenças dos modelos, motores, fontes e decodificadores distribuídos acompanham os assets. Referências: [PDF.js](https://mozilla.github.io/pdf.js/), [Tesseract.js](https://github.com/naptha/tesseract.js), [licença Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/LICENSE.md).

Não há custo de API ou cartão exigido para comparar. Há consumo de CPU/memória do dispositivo e banda da hospedagem atual. Os idiomas somam aproximadamente 6,1 MB; o motor e demais assets aumentam o download inicial. Não há garantia de disponibilidade ilimitada da hospedagem gratuita ou de desempenho em dispositivos fracos.

O build prepara os assets gerados pelo `next.config.ts`, inclusive quando Vercel invoca `next build` diretamente com seu comando personalizado. Isso evita depender de um script do package.json que a hospedagem poderia ignorar. Não é necessário configurar novas chaves ou alterar o serviço de IA.

## Testes executados

- **235 testes automatizados passaram**, sem falhas ou testes ignorados, incluindo regressão das ferramentas anteriores e cotas do CloneMaster.
- TypeScript e build de produção local passaram.
- **63 verificações de rota passaram** em servidor isolado sem banco de produção.
- O Chrome processou PDFs reais sintéticos no fluxo da aplicação: alterações conhecidas em valores, percentuais, datas, prazos, partes, cláusulas movidas, página inserida, múltiplas versões, PDF idêntico e mudança visual de carimbo.
- Os testes do motor também cobrem página removida, cláusulas incluídas/excluídas, redistribuição de texto entre páginas, dimensões alteradas, quantidades, linhas de tabela, evidências adulteradas recusadas e documento extenso limitado.
- Downloads reais PDF, DOCX, TXT e CSV: conteúdo de antes/depois verificado; DOCX aberto como ZIP e XML conferido; PDF aberto como documento; observação humana incluída. Fórmulas CSV, inclusive com espaços iniciais, são neutralizadas.
- OCR real no Chrome: scan normal e scan de aproximadamente 300 DPI, além de imagem degradada com aviso de incerteza. Não foram simuladas respostas do motor PDF, OCR ou comparação. Só a autorização de cota do teste de navegador foi controlada; as cotas têm testes isolados próprios e não consumiram tarefas da conta real.
- PDFs corrompidos e protegidos são recusados com mensagens tratadas, sem resultado inventado. Cancelamento invalida o resultado e uma nova operação pode começar.
- Rede da página e dos workers monitorada: nenhum upload de documento, chamada a IA, CDN ou anúncio; apenas reserva de cota sem corpo e assets da mesma origem.
- Larguras 320, 390, 768, 1024 e 1440 verificadas. O visualizador ajusta a renderização ao redimensionar; capturas desktop/móvel foram inspecionadas.

Evidências e fixtures locais: `.vercel/review/legal/`. Não são documentos de usuários e não são publicados. Scripts reproduzíveis: `scripts/prepare-legal-fixtures.ts` e `scripts/smoke-legal.mjs`; testes do motor em `tests/unit/legal.test.ts`.

### Falhas corrigidas durante os testes

- OCR precisava da variante `relaxedsimd-lstm` do Tesseract 7 no Chrome atual; o build passou a preparar também essa variante.
- Símbolos gerados pelo próprio relatório não disponíveis na fonte impediam o PDF; os avisos gerados foram ajustados, sem alterar citações do usuário.
- Digitalizações comuns em 300 DPI excediam um teto inicial de imagem de quatro milhões de pixels; o teto foi ajustado e páginas sem representação utilizável deixam de ser consideradas texto analisado.
- Visualizador agora recalcula o encaixe ao mudar a largura, não exibe realce antes de renderizar a página e não conserva uma operação cancelada como resultado.
- Campos únicos de partes e linhas de tabela são alinhados antes da similaridade genérica; texto idêntico redistribuído entre páginas não é rotulado como exclusão/inclusão.

## Limitações e próximas etapas

Não há precisão universal, autenticação/falsificação detectada ou interpretação jurídica definitiva. A comparação textual normaliza espaços; a opção “todas” se limita às diferenças detectáveis pelos motores implementados.

Amostras visuais são de baixa resolução e tons de cinza: podem perder detalhes pequenos, cores semelhantes ou mudanças muito localizadas. Pixels são comparados somente em páginas alinhadas. Formulários dinâmicos, XFA, anotações interativas, conteúdo fora da página, camadas especiais, fontes problemáticas e imagens acima do teto podem não ser analisados integralmente. Os originais devem ser conferidos.

Tabelas são identificadas por geometria aproximada, não por compreensão universal de células mescladas. Cláusulas com numeração repetida, reformulações extensas, leitura em várias colunas e redistribuição parcial entre páginas podem exigir revisão manual. A confiança de OCR é um indicador do motor, não uma taxa comprovada de acerto; observações humanas não alteram o texto-fonte extraído. Se o PDF do relatório não suporta algum símbolo do original, há erro explícito e as alternativas TXT/DOCX preservam o texto.

As seis ferramentas futuras continuam planejadas. Prioridades seguintes: ampliar o corpus de contratos autorizados/anonimizados, melhorar alinhamento de cláusulas fragmentadas em documentos que também mudam conteúdo, evolução de tabelas complexas e avaliação de desempenho em aparelhos modestos. Integração semântica só com escolha explícita e fluxo de consentimento específico; não foi conectada nesta etapa.

## Publicação

Implementação e testes locais concluídos. **Nenhum deploy, push ou publicação desta área jurídica foi realizado.** A publicação depende de autorização explícita do usuário.
