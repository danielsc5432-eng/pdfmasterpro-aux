# PDF Master Pro Jurídico — seis ferramentas adicionais

> Atualização posterior: [revisão opcional com IA gratuita](JURIDICO-IA-2026-10-26.md) foi adicionada sem substituir a análise local. A descrição de ausência de modelo neste registro refere-se à etapa inicial da suíte.

Implementação local de 26/10/2026. Não publicada. Complementa o [relatório do TimeMachine](JURIDICO-TIMEMACHINE-2026-10-26.md); as seis ferramentas antes planejadas agora têm fluxos funcionais próprios.

## Arquitetura e dependências

Reutilização do PDF.js, Tesseract.js, comparador de blocos, visualizador, pdf-lib, fontkit, docx e JSZip já presentes. Nenhuma dependência ou API paga nova. O nome comercial ContractCheck AI é preservado, mas sua interface informa expressamente que o processamento atual usa regras locais, sem modelo de linguagem.

O catálogo e o hub usam uma configuração comum. Cinco ferramentas compartilham o componente de envio, extração e navegação por evidência, mas executam analisadores específicos em Web Worker. ProvaCompare reutiliza a comparação textual/visual/estrutural testada do TimeMachine com identificação própria, hashes e metadados declarados pelo PDF. A ordem escolhida dos documentos não comprova cronologia.

## Funcionalidades

| Ferramenta | Comportamento implementado |
|---|---|
| ContractCheck AI | Inventário de cláusulas/seções reconhecidas; valores, percentuais, datas, prazos escritos, possíveis obrigações, rescisão e condições que merecem conferência. Evidência literal por página; não avalia validade ou abusividade. |
| ProcessoTimeline | Datas numéricas e por extenso ordenadas por calendário, possíveis eventos no mesmo bloco e eventos sem data separados. Ano de dois dígitos e data inválida não recebem data presumida. Múltiplas datas no bloco exigem revisão de associação. |
| JurisOrganize | Tipo provável, número CNJ com verificação de dígitos, primeira data mencionada, rótulos de assunto/partes e alerta de bytes duplicados. Agrupamento por processo/tipo, tipo, data mencionada, assunto ou primeira parte. Prévia editável, confirmação obrigatória, caminhos saneados e colisões resolvidas; ZIP de cópias idênticas aos originais, manifesto com hashes e relatório. |
| ProvaCompare | De 2 a 4 documentos; comparação textual, visual e estrutural; visualizadores lado a lado, filtros, OCR opcional, antes/depois, SHA-256 e metadados editáveis declarados pelo PDF. Sem laudo de fraude, autenticidade ou falsificação. |
| PrazoExtractor | Datas expressas, datas incertas/inválidas e durações escritas em números ou palavras usuais; indica dias úteis/corridos somente quando escritos. Não calcula vencimento, termo inicial ou feriados. |
| PetiçãoReview | Checklist de menções estruturais, referências a itens/tópicos, saltos/repetições de numeração, blocos extensos, texto repetido, menções legais literais e múltiplos processos. Ausência no reconhecimento não significa irregularidade nem requisito obrigatório. Não valida legislação ou jurisprudência. |

Todas oferecem relatórios PDF, DOCX, TXT e CSV; cinco analisadores incluem filtros por categoria/busca e abertura da página-fonte com região destacada. ProvaCompare mantém a revisão por achado do comparador existente. O ZIP é exclusivo do organizador. Exportações incluem limitações e distinção entre evidência literal e itens de checklist sem trecho específico.

## Privacidade, segurança e custos

- PDFs, OCR, evidências, classificações, nomes propostos e resultados permanecem em memória no navegador. Não há persistência no histórico ou treinamento com documentos.
- Uma reserva de cota sem corpo é enviada a `/api/legal/quota`. A análise compartilha as 10 tarefas gratuitas por janela de 24 horas; assinantes seguem as regras existentes. Tentativas admitidas podem consumir cota mesmo quando a análise falha.
- As seis rotas não carregam AdSense. Ao entrar pela navegação interna após página com script de anúncio já carregado, o fluxo recarrega antes de permitir os arquivos, como no TimeMachine.
- `/api/v1/process` rejeita os seis slugs, evitando encaminhamento acidental dos documentos ao processador remoto.
- Arquivos de até 5 MB, 4 por análise, 12 MB no conjunto; 30 páginas por arquivo e 60 no total; até 120 mil caracteres/500 blocos por arquivo, 300 registros e 5 páginas OCR compartilhadas. Tempo de análise: 180 segundos. Limpeza manual, ao desmontar a ferramenta ou após 30 minutos.
- ZIP exige revisão; nomes de caminhos são saneados, incluindo diretórios relativos e nomes reservados, colisões recebem sufixo, bytes de cada original são conferidos por SHA-256 antes de gerar. Nenhuma cópia substitui o original.
- CSV neutraliza fórmulas. Texto é renderizado como texto React, sem HTML do PDF. Metadados selecionados são limitados e tratados como informação não confiável.
- Sem custo de inferência por API. Permanecem recursos do dispositivo e tráfego/hospedagem do site; não há promessa de operação de hospedagem ilimitada gratuita.

## Arquivos principais

Criados: `lib/legal/suite-config.ts`, `analyze.ts`, `analysis-worker.ts`, `analysis-report.ts`, `organize.ts`; `components/legal/analysis-workspace.tsx`; `tests/unit/legal-suite.test.ts`; `scripts/smoke-legal-suite.mjs`.

Atualizados: hub `app/juridico/page.tsx`, página dinâmica de ferramentas, catálogo, bloqueio de processamento remoto, rota de cotas jurídicas, isolamento de anúncios, privacidade, tipos/extração/relatórios/visualizador compartilhados e CSS jurídico. Scripts de fixtures, smoke de rotas, catálogo e comandos de testes foram ampliados.

## Validação

Evidências locais em `.vercel/review/legal/`, sem documentos de clientes. Fixtures reais sintéticas: contratos, processo com datas fora de ordem, data inválida, ano ambíguo, petição com salto de numeração/repetição/referência sem destino, scans, PDF de 20 páginas, vazio, corrompido e criptografado.

Os testes dos analisadores conferem evidência vinculada aos blocos reais, datas bissextas/por extenso/ISO, ausência de inferência de século, prazos sem vencimento, CNJ, colisões, checklist sem fonte fictícia, limites e extração parcial. PDF/DOCX/TXT/CSV são abertos/inspecionados; ZIP verifica os bytes originais e o manifesto. Um falso positivo de data dentro de número CNJ foi encontrado na inspeção e corrigido com teste de regressão.

Testes no Chrome usam extração, comparação e OCR reais. Somente a resposta de autorização de cota é controlada para não consumir tarefas reais. A rede da página e dos workers é monitorada para comprovar a ausência de upload de documentos, APIs de IA, anúncios e CDNs. Incluem recusa de cota, cancelamento/reutilização, fonte destacada, downloads, revisão do ZIP e larguras 320/390/768/1440.

Resultados finais: **249 testes automatizados passaram, zero falhas e zero ignorados**; **75 verificações de rotas passaram**; compilação Next.js concluída com TypeScript. O Chrome concluiu os fluxos reais das seis ferramentas, as quatro exportações de cada uma, agrupamento por data, edição/confirmação do ZIP, OCR, arquivos inválidos, cancelamento e reutilização. O modo de teste do catálogo foi separado dos fluxos antigos que precisam de banco: os dez filtros, os 27 cartões, busca combinada, estado vazio e histórico de navegação foram verificados sem usar credenciais de produção.

A primeira execução da bateria completa usou o alias Python da Microsoft Store e falhou em sete testes preexistentes de resumo. Foi repetida com o Python real do ambiente do projeto (`PDF_TO_WORD_PYTHON`), com os 249 aprovados. A inspeção do catálogo também exigiu atualizar as expectativas do teste de voltar/avançar após a inclusão da categoria Jurídico. Nenhuma falha foi mascarada com resultados fictícios ou remoção dos testes.

## Limitações

Não há modelo semântico de IA conectado. Regras em português não reconhecem universalmente todos os contratos, processos, tabelas, títulos, prazos ou petições. Datas e eventos no mesmo bloco podem não estar relacionados; a timeline não atesta ocorrência. Dias úteis, feriados, suspensões e regras processuais não são calculados.

Classificações e nomes são sugestões. Um CNJ com dígitos consistentes pode não corresponder a processo existente. Metadados são editáveis e não estabelecem origem, autoria ou data verdadeira. Formatação é verificada apenas pelos sinais de estrutura/segmentação disponíveis, não pela conformidade com normas de tribunais. Trechos repetidos podem ser intencionais, e subseções podem parecer saltos de numeração.

Páginas digitalizadas dependem da qualidade do OCR e do limite de cinco páginas; extração incompleta é avisada. O comparador visual mantém a amostra reduzida em tons de cinza e as demais limitações documentadas no relatório inicial. PDF de relatório com glifo não suportado oferece erro explícito e alternativas TXT/DOCX; texto original não é substituído silenciosamente.

Essas ferramentas apoiam a conferência documental. Não são parecer jurídico, validação de petição, autenticação de prova ou serviço de cálculo oficial de prazo.

## Publicação

Sem deploy, push ou publicação automática. A versão deve ser revisada localmente e só pode ser publicada com autorização do usuário.
