# Robustez PDF → Word — 24/10/2026

## Objetivo e limite

Ampliar a cobertura e impedir aprovação indevida de arquivos com perdas. Não há evidência de 100% de fidelidade em todo tipo de PDF. `checked` significa aprovação pelos critérios automatizados, não identidade universal nem validação em todas as versões do Microsoft Word.

## Correções implementadas

1. Conferência separada dos números no XML editável e no PDF renderizado, por página. Valores presentes no XML, mas invisíveis na renderização, não passam como corretos.
2. Preservação dos sinais e separadores na comparação; não confundir valores negativos com positivos ou números com os mesmos dígitos em formatos diferentes.
3. Detecção de valores extras/duplicados por precisão numérica, além da cobertura dos valores de referência.
4. Leitura somente do texto Word efetivo, ignorando coordenadas de desenhos, instruções de campos, revisões excluídas e duplicação de `mc:AlternateContent`.
5. Coordenadas numéricas transformadas para a orientação visual correta de páginas giradas.
6. Correção da inversão dupla das dimensões de páginas em paisagem pela biblioteca docx.
7. Uso das dimensões visuais do pdftohtml quando o pdftotext já girou coordenadas, mas mantém dimensões sem rotação. Tamanhos fracionários normais continuam preservados.
8. Digitalizações com camada OCR invisível ou transparente são sinalizadas para revisão. Quando detectada camada transparente sobre imagem de página inteira, o fluxo refaz OCR e limpa a região reconhecida do fundo, evitando texto rasterizado duplicado sob a edição.
9. Entrega bloqueada quando a conferência não está disponível, há perda de valores, tamanho/paginação incorretos, texto praticamente invisível ou desvio visual grosseiro. OCR permanece em revisão, sem aprovação automática irrestrita.

O SDK continua comparando candidatos; não altera o texto para forçar igualdade nas métricas. O importador alternativo do LibreOffice foi experimentado para texto girado, mas não preservou sua posição e não foi incorporado ao fluxo.

## Pesquisa e arquivos públicos

- [PyMuPDF: coordenadas e rotação](https://pymupdf.readthedocs.io/en/latest/page.html).
- [pdf2docx: arquivos de teste oficiais](https://github.com/ArtifexSoftware/pdf2docx/tree/3e1c2319d6a3fbf2ae4d46c3ab734b7fc87bd9b4/test/samples).
- [pdfplumber: PDFs de regressão](https://github.com/jsvine/pdfplumber/tree/4c64b92d5caccd71c645e98e0fabb0c4dba7ff45/tests/pdfs).
- [docx: implementação pública](https://github.com/dolanmiu/docx).

Foram usados arquivos públicos de tabelas, colunas, imagens sobrepostas e anotações giradas. Downloads fixados por revisão, com URL e SHA-256 registrados. Os PDFs ficam em diretório ignorado; não foram redistribuídos no repositório do projeto.

## Bateria ampliada

| Caso | Resultado observado |
| --- | --- |
| Valores positivos e negativos | Aprovado, números preservados |
| Duas colunas sintéticas com linhas desencontradas | Aprovado |
| Tamanhos mistos, paisagem e página em branco | Aprovado após correção de dimensões |
| Texto efetivamente girado | Bloqueado por divergência visual |
| Digitalização sem texto | Revisão OCR |
| Digitalização com OCR invisível | Revisão OCR |
| Digitalização com OCR transparente | Revisão OCR; reconhecido novamente e fundo limpo |
| Tabela asiática pública | Bloqueada por perdas numéricas e de texto |
| Colunas públicas | Revisão: sem perda numérica, diferenças de texto/layout |
| Imagens sobrepostas públicas | Revisão OCR |
| Anotações giradas públicas | Revisão: divergência visual residual |

Total dos onze casos públicos/sintéticos: **3 aprovados, 6 em revisão, 2 bloqueados**. Não equivale a onze conversões perfeitas. A revisão dos dois PDFs pessoais de referência também foi repetida, mantendo aprovação automatizada, páginas e valores preservados.

Validação de código: **95 testes TypeScript e nove testes nativos aprovados**, TypeScript e build aprovados. Os onze hashes do manifesto foram conferidos contra os arquivos usados. Essas aprovações de testes não transformam os seis casos em revisão e os dois bloqueados em conversões corretas.

O reconhecimento de texto em imagens não oferece referência textual independente para garantir que nomes e valores estão corretos. Os termos numéricos com fonte vazia têm cobertura matemática 1, mas não devem ser apresentados como comprovação de exatidão; `ocrReview=true` impede `checked`.

## Como repetir

Com Python e dependências nativas do worker configuradas:

```sh
python scripts/test-pdf-fidelity.py
pnpm test
pnpm typecheck
pnpm test:conversion
pnpm test:conversion --public
pnpm test:conversion --public --strict
pnpm test:conversion --case=transparent-searchable
```

`--strict` termina com erro se qualquer caso não alcançar `checked`. Com as limitações atuais, o corpus completo não passa nesse modo. A execução exploratória gera resultados detalhados; seu exit code zero não significa que todos os arquivos foram aprovados.

Arquivos sintéticos são gerados sem identificadores aleatórios de PDF. Manifesto, hashes, resultados e DOCX ficam em `.vercel/regression-pdf/`, nunca no repositório público. Execuções filtradas usam relatórios separados, preservando o histórico do conjunto completo.

## Limitações abertas

Reconstrução de texto em ângulos arbitrários, tabelas/fontes asiáticas complexas, anotações, segmentação de palavras e validação específica no Microsoft Word ainda exigem trabalho. Nenhum critério foi reduzido para declarar 100%. A confiança do resultado deve continuar visível e candidatos com perdas medidas permanecem bloqueados.

## Publicação e prova remota

- Commit `4eebeee` publicado no repositório do projeto.
- Vercel `dpl_AefqLurffufrAyjmhURoeBZ7P9jv`: Ready, domínio www.pdfmasterpro.com.br atualizado.
- Render `dep-dbegc22jnfac73dqcqog`: Live, worker existente atualizado.
- DTC real: HTTP 200, checked, 3 → 3 páginas, fluxo nativo confirmado no DOCX.
- INSS real: HTTP 200, checked, 2 → 2 páginas, fluxo nativo confirmado no DOCX.
- Caso sintético com texto girado e layout reprovado: HTTP 422 com mensagem da conferência; nenhum Word incorreto entregue como sucesso.
- Nenhum recurso pago contratado. PDFs pessoais e corpus de teste permaneceram fora do repositório público.

## Nova rodada: Unicode, direções, fontes e OCR

Implementado um candidato adicional com extração Unicode e coordenadas de caracteres pelo PyMuPDF. A seleção automática continua comparando conteúdo editável, PDF renderizado, paginação, posição dos números e aparência. Um candidato novo não substitui um resultado melhor apenas por usar outro motor.

- Texto de 90°/270° utiliza direção nativa de células Word, mantendo texto editável. Blocos independentes preservam a posição de colunas e anotações; ângulos oblíquos ainda usam o fallback conservador e precisam de revisão.
- Geometria nativa inclui baseline, bloco de origem e posições verticais de palavras, além das coordenadas horizontais. Linhas incompatíveis usam o renderizador posicionado como alternativa.
- O Docker instala fontes Noto gerais e CJK, com aliases abertos para famílias chinesas. Não são redistribuídas fontes proprietárias extraídas de PDFs. A fonte substituta pode mudar a aparência e continua sujeita à conferência.
- OCR ganha um candidato de escala de cinza, binarização adaptativa, correção de inclinação com canvas expandido e segmentação alternativa. As quatro extremidades de cada palavra retornam ao espaço original pela transformação inversa. A escolha exige aumento de confiança e preservação dos termos numéricos já reconhecidos; confiança não comprova exatidão.
- Comparação CJK verifica ideogramas individualmente: espaços inseridos por diferentes extratores não simulam perda. Um teste separado confirma que um caractere realmente ausente continua reduzindo a cobertura. Os critérios e limiares de aprovação não foram reduzidos.
- OpenCV usa uma thread no pré-processamento e limita as dimensões das imagens. Falhas de preparação mantêm o OCR original. Digitalizações continuam marcadas para revisão.

### Evidências desta rodada

Os onze casos anteriores foram executados novamente. Após a correção final do fallback nativo, o caso de tabela asiática foi repetido separadamente:

| Caso | Resultado final medido | Similaridade visual |
|---|---|---|
| Texto girado 90° | checked; antes bloqueado | 0,9965 |
| Anotações giradas | checked; antes revisão | 0,9431 |
| Colunas públicas | checked; antes revisão | 0,9802 |
| Tabela asiática | review; antes bloqueada; texto e números completos | 0,8448 |
| DTC fornecido pelo usuário | checked; 3 → 3 páginas | 0,9823 |
| INSS fornecido pelo usuário | checked; 2 → 2 páginas | 0,9829 |

A tabela asiática ainda tem posição numérica de 0,90: preservação de conteúdo não significa identidade de layout. As quatro digitalizações/imagens do corpus anterior permanecem em revisão. Nos onze casos originais, o resultado consolidado final é **6 checked, 5 review, 0 bloqueados**. O primeiro relatório integral ainda registra o fallback anterior para a tabela; `results-public-lattice.json` contém sua repetição final e deve ser considerado na consolidação.

Foram adicionados casos sintéticos de 270° e digitalização inclinada com baixo contraste. O caso de 270° foi aprovado, com similaridade visual 1,00 nessa métrica. A digitalização inclinada exige revisão, com similaridade visual 0,7238; o processamento não garante que cada caractere reconhecido corresponda à imagem. Consolidando os onze casos anteriores, a repetição final CJK e os dois casos novos: **13 casos, 7 checked, 6 review, 0 bloqueados**. Esse resultado não é 100% de conversões perfeitas.

Validação de código: 98 testes TypeScript e 13 testes Python (10 de fidelidade e 3 de geometria/pré-processamento) aprovados. Build e verificação TypeScript aprovados. A comparação visual usa LibreOffice; não comprova renderização idêntica em todas as versões do Microsoft Word.

Fontes técnicas consultadas: [PyMuPDF TextPage](https://pymupdf.readthedocs.io/en/latest/textpage.html), [direções no docx](https://docx.js.org/api/variables/index.TextDirection.html), [qualidade no Tesseract](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) e [Noto CJK](https://github.com/notofonts/noto-cjk). Nenhuma API paga ou modelo comercial foi adicionado.

### Compatibilidade Linux

O teste remoto revelou uma diferença importante em relação ao Windows: LibreOffice 7.4, fornecido pelo Debian bookworm, deixou em branco a tabela com texto vertical. O DOCX continha o texto, mas sua renderização antiga não o mostrava. A conferência bloqueou a entrega; o teste automatizado em Debian reproduziu a falha.

Foi criada uma bateria GitHub Actions com documentos sintéticos/públicos, sem credenciais nem PDFs particulares. O teste isolado com `node:22-trixie-slim` e LibreOffice 25 passou nas duas rotações, mantendo o mesmo código e os mesmos critérios. O Docker passa a usar essa base nas três etapas. Referências: [pacote oficial Debian](https://packages.debian.org/trixie/libreoffice-writer) e [imagem oficial Node](https://github.com/nodejs/docker-node/blob/main/22/trixie-slim/Dockerfile).

O workflow também mede o corpus completo, mantém aprovação estrita nos casos de rotação e conserva artefatos sintéticos por sete dias para diagnosticar diferenças futuras. Relatórios de revisão continuam sendo revisões, mesmo que o comando exploratório termine com exit code zero.

O worker inicia o Next diretamente com Node, preservando o `PORT` fornecido pelo Render. Isso elimina a tentativa de baixar pnpm durante cada inicialização. A mesma inicialização foi verificada localmente em porta isolada, com HTTP 200 e encerramento do processo de teste.

O corpus Linux identificou ainda substituição de `Arial-BoldMT` por uma fonte serifada e palavras unidas por diferenças de largura. A extração nativa agora normaliza nomes de fonte, usa substituta conhecida para Trebuchet e ajusta a largura dos runs latinos à largura original do PDF. Espaços explícitos preservam a separação das palavras. Texto e valores permanecem os da fonte; não são recriados por um modelo.

Resultado final do [workflow Debian completo](https://github.com/danielsc5432-eng/pdfmasterpro/actions/runs/40138107814): 98 testes TypeScript, 13 testes Python, TypeScript e build aprovados. Corpus integral de 13 PDFs: **7 checked, 6 review, 0 bloqueados**. Rotação 90°: 0,9976; 270°: 1,0000; colunas: 0,9946; anotações: 0,9501 de similaridade visual. O texto renderizado das colunas tem cobertura de 0,9905, portanto o status checked não significa identidade de todos os pixels ou aprovação manual.

A tabela CJK permanece em review: conteúdo e números completos, posição numérica 0,90 e similaridade visual 0,8382 no Linux. Os cinco casos restantes em review envolvem OCR/imagens. Não são convertidos em aprovações apenas porque o workflow exploratório fica verde.
