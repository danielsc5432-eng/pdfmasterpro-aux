# CloneMaster AI — entrega local de 25/10/2026

Implementação do primeiro fluxo solicitado: **TXT + XLSX + instrução → múltiplos TXT**, integrado ao PDF Master Pro. Não houve push, deploy ou publicação automática. As alterações de DNS/e-mail anteriores foram preservadas separadamente.

## Etapas, arquivos e evidências

| Etapa | Entrega e arquivos | Evidência / limite |
| --- | --- | --- |
| 1. Auditoria | Catálogo, página dinâmica, workspace, processamento, dependências e regras Next.js inspecionados | Aplicação existente preservada; ferramenta adicionada em `/ferramentas/clonemaster-ai` |
| 2. Adaptadores | `lib/clonemaster/types.ts`, `text-template.ts`, `xlsx-source.ts`, `engine.ts` | Registry e leitores separados; somente adaptadores implementados são anunciados |
| 3. Upload | `components/clonemaster/workspace.tsx` e `.css` | Arrastar/selecionar múltiplos arquivos, remover, identificar formatos e escolher codificação; limites por arquivo e total |
| 4. XLSX | ZIP limitado + XML SAX + SSF | Abas, cabeçalhos, referências de coluna, raw/formatado, strings compartilhadas/inline, células vazias, fórmulas armazenadas, data 1904; fórmulas não executadas |
| 5. Instruções | `NaturalLanguageExtractionPlanner` | Interpretação **por regras locais**, sem LLM. Exemplo obrigatório reconhecido; ambiguidade/filtros/transformações fora da gramática exigem configuração manual |
| 6. Mapeamento | `FieldMapper`, configuração por modelo | Múltiplas colunas/campos, seção, linha e ocorrência; cabeçalhos/chaves ambíguos não são escolhidos silenciosamente |
| 7. TXT | `TemplateRenderer`, `OutputValidator` | Substituição de intervalos de bytes; validação de todos os segmentos não alterados, BOM, espaços, comentários e quebras LF/CRLF/CR |
| 8. Lote | `MultiTemplateManager`, `MultiSourceManager`, `BatchJobManager` | Associação independente, um resultado por registro, erros parciais, progresso e cancelamento |
| 9. Prévia | Workspace + plano confirmado | Antes/depois, campos destacados, seleção da linha de prévia e resumo de filtros/colunas; modificar as opções invalida confirmação e downloads |
| 10. Downloads | `OutputPackageManager`, URLs Blob locais | Arquivos individuais e ZIP reais, nomes sequenciais sem dados pessoais adicionais; URLs revogadas ao limpar/alterar/sair |
| 11. Testes/segurança | `tests/unit/clonemaster.test.ts`, fixtures e scripts de smoke | 38 testes específicos, bateria total 174 testes; controles de ZIP/XML, macros, links externos, cancelamento e isolamento local |
| 12. Expansão | Pontos de adaptação definidos | PDF, DOCX, XLS/XLSM, CSV/TSV, JSON, XML, YAML, HTML, ODF e slides ainda **não são adaptadores disponíveis**. Modos Visual/Estrutural/Combinado também não são anunciados como funcionais |

## Resultado obrigatório medido

Modelo `configuracao.txt` com nome João, cargo Analista e salário 2500; fonte XLSX com Maria/4500, Carlos/3200 e Ana/5800. Instrução solicita exclusivamente Salário → `[FUNCIONARIO]` / `salario`.

- `funcionario_001.txt`: `salario=4500`.
- `funcionario_002.txt`: `salario=3200`.
- `funcionario_003.txt`: `salario=5800`.

Comparação automatizada de **todo o arquivo** com os resultados esperados: todos os demais bytes permanecem iguais, incluindo nome/cargo do modelo. Originais comparados antes/depois e preservados. O ZIP foi aberto e suas três entradas comparadas aos arquivos individuais.

As outras fontes não são combinadas por posição ou por nomes supostos. Cada modelo tem uma única fonte/aba associada explicitamente; junções entre fontes ainda não são implementadas.

## Segurança e privacidade

- Leitura e geração em Web Worker no próprio navegador, sem endpoint de upload ou serviço de IA externo. A API genérica recusa o slug com orientação para o fluxo local, antes de consultar plano/cota.
- Até 5 modelos de 256 KB, 5 fontes de 8 MB e 20 MB somados. ZIP: 200 entradas, 24 MB descompactados no total, 8 MB por entrada, estrutura XML limitada globalmente; até 5.000 linhas, 200 colunas e 100.000 células por fonte; até 500 saídas e 32 MB no lote.
- Verificação do diretório ZIP antes da descompactação; checagem do tamanho real e CRC por streaming. Caminhos inseguros, entradas duplicadas, ZIP64, criptografia, DTD, entidades externas, vínculos externos, macros e objetos incorporados são recusados.
- Arquivos são dados, não instruções. Não há `eval`, execução de fórmulas, macros, scripts, comandos do usuário ou conteúdo HTML de arquivos.
- Célula com fórmula exige autorização para usar o valor armazenado, com aviso de possível desatualização. Fórmula sem cache e célula de erro não inventam resultados. Valores brutos numéricos preservam a representação armazenada no XML; formatação pode diferir da localidade do Excel e deve ser conferida.
- Windows-1252 é uma escolha explícita; UTF-8 e UTF-16 com BOM são detectados. Caracteres não representáveis não causam recodificação silenciosa. Novas linhas/controles e valores que criariam comentários ambíguos são recusados.
- Cancelamento termina o worker e descarta os resultados do lote. Limpeza da sessão/saída revoga downloads; arquivos não vão para banco, logs ou armazenamento persistente. Há encerramento local após duas horas sem alteração da lista de arquivos.

## Testes executados

- `pnpm test` com o extrator nativo configurado: **174 aprovados, zero falhas, zero ignorados**.
- TypeScript e build Next.js aprovados; nova rota e worker compilados.
- `scripts/smoke-routes.mjs`: **53 verificações aprovadas**.
- Processadores existentes após a atualização do Zod: **27/27 verificações aprovadas**, incluindo conversões, OCR e entradas inválidas.
- Smoke existente: seleção persistida, ordenação, substituição/remoção, PDF gerado válido, detector/relatório, bloqueios Premium, preços, tema e navegação móvel aprovados.
- Smoke CloneMaster: leitura real em worker, interpretação, mapeamento único, confirmação obrigatória, três downloads exatos, ZIP válido, invalidação de prévias/downloads após edição, cancelamento real de lote de 500 registros, limpeza local, ausência de POST de documentos e zero exceções não tratadas.
- Layout verificado em 320, 390, 768, 920 e 1440 px. Capturas locais em `.vercel/review/clonemaster/`.
- Compatibilidade independente: XLSX gerado por **openpyxl 3.1.5** lido pelo worker no navegador; leitura dos dados do XLSX sintético também conferida pelo openpyxl. Ambiente Python apenas de teste, em `.vercel/tools/clonemaster-tests/`; não necessário em produção.

## Dependências e correções encontradas

- Reutilizados React, TypeScript, JSZip e componentes/estilos existentes.
- Adicionados `saxes@6.0.0` (ISC) para XML com limites e `ssf@0.11.2` (Apache-2.0) para códigos de formatação. O repositório saxes está arquivado; a versão usada foi fixada e sua superfície restrita pelos limites/recusa de DTD, com testes. Reavaliar manutenção ao expandir o leitor.
- Auditoria revelou vulnerabilidade preexistente do Zod: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Atualizado para `4.6.6`, inclusive a dependência compatível de `@langchain/core` por override em `pnpm-workspace.yaml`. Tipos e testes foram repetidos; `pnpm audit --prod --audit-level high` passou sem vulnerabilidades conhecidas reportadas.
- Corrigidos no desenvolvimento: preservação do separador de comentário em campo vazio, limite de XML agregado ao arquivo, parsing de linhas sem varredura quadrática, validação de datas inexistentes, tempo entre cliques automatizados para refletir atualizações React e compatibilidade CJS do script de fixtures.

## Como testar localmente

```powershell
pnpm test:clonemaster:fixtures
pnpm test:clonemaster
pnpm build
# Em outro terminal, iniciar sem banco/worker de produção:
$env:DATABASE_URL=''
$env:PROCESSING_WORKER_URL=''
pnpm exec next start --hostname 127.0.0.1 --port 3100
# Com o servidor iniciado:
pnpm test:clonemaster:ui
```

Abrir `http://localhost:3100/ferramentas/clonemaster-ai`. Selecionar `.vercel/review/clonemaster/configuracao.txt` e `funcionarios.xlsx`; analisar o comando, revisar plano/prévias, confirmar e gerar.

## Limitações e próximos passos

Esta entrega conclui o primeiro fluxo funcional pedido, não todos os formatos e modos da visão de longo prazo. O planejador não é uma IA generativa nem entende qualquer instrução; seu resultado é sempre um plano editável, não código. Não há preservação visual de PDFs/Office, avaliação de fórmulas, junção automática de fontes, leitura de arquivos criptografados ou suporte universal a dialetos INI/configuração. Valores substituídos incluem eventuais aspas do valor original; conferir a sintaxe esperada pelo sistema consumidor. Filtros de data exigem ISO no valor ou no formato calculado.

Próxima expansão deve adicionar cada adaptador com testes de round-trip e preservação específicos, antes de anunciar suporte. Uma camada de LLM opcional dependeria de modelo/infraestrutura e consentimento próprios. Publicação depende de autorização do proprietário, conforme o prompt anexado.
