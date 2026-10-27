# PDF24: tecnologias públicas e aplicação ao PDF Master Pro

Pesquisa de 26/10/2026. Escopo: documentação oficial, observação do HTML público do catálogo e auditoria do código existente. Não foram enviados documentos ao PDF24, chamados endpoints de conversão, copiados seus motores ou executado benchmark contra o serviço. Nenhuma alteração funcional ou publicação foi feita nesta etapa.

## Conclusão

Podemos aproveitar componentes abertos e técnicas semelhantes, mas não tratar o serviço gratuito do PDF24 como backend gratuito do PDF Master Pro. Grande parte da base já está instalada no nosso processador. A oportunidade mais concreta encontrada é melhorar o OCR de servidor; PDFBox é um candidato complementar, não um conversor universal para Word.

## O que foi confirmado e o que não foi

- **Site:** o HTML público de `https://tools.pdf24.org/pt/todas-as-ferramentas` carregou jQuery, Dropzone, utilitários próprios e scripts comuns/anúncios/consentimento. O cabeçalho respondeu `server: cloudflare`. Isso identifica elementos públicos e uma camada de entrega, não a linguagem, hospedagem de origem ou motores internos de cada conversão. Não prova uso de React, PDF.js, PDFium, pdf2docx ou LibreOffice no backend online.
- **Aplicativo Windows PDF24 Creator:** o [manual oficial](https://creator.pdf24.org/manual/11/) documenta Tesseract e componentes como qpdf/Ghostscript, além de operações com PDFBox. O [changelog](https://creator.pdf24.org/changelog/en.html) descreve motor PDF próprio e conversores próprios para Word e outros formatos. Não é correto concluir que o site online usa exatamente a mesma pilha do aplicativo.
- O aplicativo [é oferecido gratuitamente inclusive para empresas e é voltado a Windows](https://tools.pdf24.org/en/creator). Isso não torna seus conversores um SDK aberto disponível para o nosso Docker Linux. Não foi localizado um repositório oficial desses conversores próprios.
- Não encontrei documentação atual de API pública geral de conversão adequada para sustentar outro SaaS. Existe um [artigo antigo de API JavaScript](https://help.pdf24.org/en/pdf24-pdf-api-written-in-javascript/) destinado a gerar PDFs a partir de conteúdo textual; não comprova uma API atual de PDF para Word e todas as ferramentas.

## Gratuidade e integração do serviço

O [FAQ oficial](https://tools.pdf24.org/en/faq) atribui a gratuidade a publicidade e a uma operação otimizada. Gratuito para o usuário não significa servidor ou desenvolvimento sem custos.

Os [termos atuais do serviço online](https://www.pdf24.org/en/terms-of-use) restringem uso automatizado e o uso comercial em que processar documentos seja a atividade principal; também estabelecem condições para integração em outros sites e vedam revenda do serviço. O PDF Master Pro é justamente um produto de processamento documental. Portanto, não proponho automatizar o PDF24 como reserva gratuita de conversão. A análise de licença do Creator é separada, pois os termos online expressamente o excluem.

## Comparação com o nosso código

| Tecnologia | Evidência relativa ao PDF24 | Situação do PDF Master Pro | Aplicação recomendada |
|---|---|---|---|
| Tesseract | Documentado no Creator para OCR | Docker instala por/eng; OCR de servidor e Tesseract.js no navegador | Melhorar preparação da imagem e preservação do PDF, em vez de instalar outro Tesseract redundante |
| qpdf | Documentado no Creator | Instalado; proteção e otimização estrutural | Ampliar verificações estruturais e testar reparação conservadora, preservando o original |
| Ghostscript | Componente documentado do Creator | Instalado no Docker | Manter onde já funciona, medir perda visual e conferir licença |
| PDFBox | Documentado no ecossistema Creator | Não está instalado no Docker auditado | Avaliar como motor independente de extração, páginas, formulários e renderização |
| Conversores PDF24 próprios | Documentados no changelog do Creator | Não disponíveis no projeto | Desenvolver/testar nossa reconstrução; não presumir acesso ao motor proprietário |
| jQuery/Dropzone | Observados no catálogo público | Site usa React/Next.js e componentes próprios | Nenhum motivo identificado para trocar o frontend; não melhora fidelidade dos arquivos |

O Docker atual já contém Poppler, Ghostscript, qpdf, Tesseract por/eng, fontes Noto/Liberation e LibreOffice. `requirements-pdf2docx.txt` fixa pdf2docx 0.5.13, PyMuPDF e OpenCV. Isso é constatação do nosso repositório; não é atribuição dessas bibliotecas ao PDF24 online.

### Pontos concretos da auditoria

1. **OCR da ferramenta tradicional de servidor:** `lib/processing/extended.ts`, funções `renderPdf`/`ocrPdf`, usa 144 DPI e renderiza todas as páginas para reconstruir o resultado. Isso pode prejudicar letras pequenas e remover características vetoriais/estruturais que não deveriam precisar de OCR. Esse achado não se aplica automaticamente ao OCR separado do conversor Word nem ao OCR do navegador.
2. **PDF para Word:** `lib/processing/docx-auto.ts` já escolhe estratégias por perfil, tenta alternativas e mede qualidade antes da entrega. Não faz sentido substituir isso por uma biblioteca de renderização e prometer maior fidelidade. O ganho deve ser medido na reconstrução de tabelas, parágrafos, fontes e formulários.
3. **Otimização:** `lib/processing/optimizer.ts` já testa qpdf/deduplicação, exige verificação e conserva o original quando não há redução comprovada. Isso deve ser preservado. Aumentar compressão indiscriminadamente não é melhorar qualidade.
4. **Recursos:** existe limitação de concorrência em `lib/processing/native-job.ts` para tarefas que usam esse mecanismo. Antes de introduzir Java ou processamento adicional, medir memória, duração e comportamento sob carga no Render. Ter código aberto não elimina custo de CPU/RAM.

## Novas tecnologias que merecem avaliação

### Prioridade 1 — OCRmyPDF

Candidato para aprimorar o OCR de servidor. A [documentação oficial](https://ocrmypdf.readthedocs.io/en/latest/cookbook.html) oferece correção de rotação/inclinação, tratamento de páginas com texto e seleção de páginas. A configuração conservadora deve evitar rasterizar conteúdo nativo sem necessidade; alterações de imagem exigem comparação visual e podem ter efeitos indesejados. Sua [licença é MPL-2.0](https://github.com/ocrmypdf/OCRmyPDF/blob/main/LICENSE), com dependências que precisam de análise separada. Não foi confirmado que o PDF24 use OCRmyPDF.

### Prioridade 2 — Apache PDFBox

Biblioteca Java, [Apache-2.0](https://pdfbox.apache.org/), com ferramentas para texto, páginas, formulários e renderização. Pode servir de segunda leitura ou alternativa em PDFs problemáticos. A [CLI oficial](https://pdfbox.apache.org/3.0/commandline.html) permite avaliar sem reescrever o site em Java. Não é um motor pronto de reconstrução fiel PDF→DOCX; adicionar uma JVM precisa justificar seu consumo de recursos.

### Prioridade 3 — PDFium

Candidato a renderizador independente para conferir páginas que apresentem problemas nos atuais. A [licença do núcleo PDFium](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE) permite reutilização sob suas condições e inclui referências a componentes de terceiros. Não o identifiquei como motor do PDF24 online. Renderizar corretamente uma página não reconstrói, sozinho, um Word editável correto.

### Componentes existentes e licenças

O [qpdf](https://qpdf.readthedocs.io/en/stable/overview.html) trabalha na estrutura do PDF e não converte seu conteúdo para Word. O [pdf2docx 0.5.13](https://pypi.org/project/pdf2docx/0.5.13/) é MIT, mas o projeto informa ausência de manutenção ativa pela Artifex. Sua licença não altera a licença de suas dependências: [PyMuPDF](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright) e [Ghostscript/Artifex](https://artifex.com/licensing) têm condições AGPL/comerciais que precisam ser conferidas para o modelo de distribuição/serviço. Não recomendo tratar a pilha inteira como MIT ou presumir obrigação automática de comprar licença.

## Plano de avaliação antes de mudar produção

1. Criar ramo de melhoria e manter os motores atuais como referência.
2. Testar OCRmyPDF em PDFs sintéticos/autorizados: digitalização normal, inclinada, rotacionada, texto pequeno, página já pesquisável e PDF misto.
3. Comparar palavras, valores/datas, páginas, dimensões, texto nativo e imagem antes/depois; medir tempo e pico de memória. DPI maior deve respeitar orçamento de pixels, não ser aplicado sem limites.
4. Somente depois avaliar PDFBox e PDFium nos casos em que os motores existentes realmente falham. Não instalar todos preventivamente.
5. Para Word, medir texto editável, números exatos, tabelas, quebras de página e aparência após renderizar o DOCX. Não avaliar apenas pela abertura do arquivo.
6. Liberar apenas o que demonstrar ganho sem regressão e dentro do orçamento da hospedagem. Nenhuma estimativa de percentual de ganho ou fidelidade universal foi comprovada nesta pesquisa.

## Resultado desta etapa

Pesquisa e auditoria concluídas. Não removi limites gratuitos, não instalei dependências, não alterei ferramentas e não publiquei nova versão. O investimento técnico com melhor justificativa inicial é o OCR do servidor, seguido de motores complementares escolhidos por evidência de falha.
