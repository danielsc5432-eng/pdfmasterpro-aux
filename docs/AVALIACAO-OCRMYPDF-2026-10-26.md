# Avaliação isolada de OCRmyPDF

Data: 26/10/2026. **Conclusão: viável como melhoria seletiva de OCR, com validação e fallback; não aprovado como substituição direta e irrestrita.** Nenhum arquivo de aplicação, dependência de produção, configuração do servidor ou deploy foi alterado.

## Ambiente e compatibilidade

- OCRmyPDF **17.13.0**, versão efetivamente disponível no PyPI durante a instalação; Python **3.11.17**, PyMuPDF **1.26.7**, pypdfium2 **5.14.0**, pikepdf **10.17.0**. A documentação online também apresenta 17.13.1; não tratei a versão da documentação como versão instalada.
- Ambiente separado: `.vercel/tools/ocrmypdf-tests`, ignorado pelo Git. Bibliotecas existentes de Word não foram atualizadas.
- Tesseract instalado no Windows, idiomas por/eng do mesmo conjunto usado nas duas estratégias e arquivo OSD/configurações do Tesseract. Concorrência limitada a um job e uma thread de OpenMP.
- O processador existente no Render foi consultado apenas para leitura: serviço Docker, plano **Free**, uma instância. Não foi alterado nem usado para este benchmark.
- Não requer GPU, conta em provedor de IA ou chamada paga de API. CPU/RAM/armazenamento e condições das dependências continuam relevantes.

## Método

Comparei a função `ocrPdf` atual, sem modificá-la, com perfis do OCRmyPDF. A função atual renderiza em 144 DPI e reconstrói as páginas com Tesseract. O perfil conservador testado foi:

```text
--mode skip --output-type pdf --optimize 0 --jobs 1
--oversample 300 --rasterizer pypdfium -l por+eng
```

Oito PDFs inteiramente sintéticos: scan de 300 DPI, fonte de 6 pontos, PDF misto com página nativa e página escaneada, PDF já textual, rotação de 90°, inclinação de 3°, arquivo corrompido e arquivo protegido por senha. Foram **24 execuções comparativas**, incluindo investigação da regressão de rotação. Isso não significa 24 resultados aprovados: falhas de reconhecimento e erros esperados estão registrados.

Medições: tempo decorrido, soma aproximada de RSS dos subprocessos amostrada a cada 50 ms, páginas/dimensões, texto extraído, cinco campos conhecidos, vetores/imagens e diferença visual renderizada em escala de cinza. A métrica de presença de palavras ignora ordem e repetições; não é precisão universal. A comparação visual usa renderização a 72 DPI, permitindo rotações ortogonais na avaliação do caso de orientação; não certifica preservação de todas as propriedades do PDF.

## Resultados principais

| Caso | OCR atual | OCRmyPDF | Interpretação |
|---|---|---|---|
| Scan normal, 300 DPI | 2,751 s; cinco campos encontrados | 4,640 s; cinco campos encontrados | Sem ganho de campos nesse exemplo; OCRmyPDF foi mais lento e manteve a imagem na amostra visual |
| Fonte pequena, 6 pt | 2,573 s; 34 de 35 palavras distintas esperadas localizadas | 4,506 s; 35 de 35 palavras distintas localizadas | Recuperou uma palavra adicional; os cinco campos já eram encontrados pelos dois motores |
| PDF misto, duas páginas | 3,440 s; página nativa rasterizada, texto não idêntico ao original | 4,676 s; página nativa com texto exatamente mantido e desenho vetorial preservado | Ganho estrutural concreto, embora mais lento neste arquivo |
| PDF já textual | 2,020 s; resultado 50.444 bytes, página convertida em imagem | 1,879 s; resultado 2.728 bytes, texto e desenho vetorial mantidos | Evitou OCR/rasterização desnecessários |
| Inclinação de 3° | Campos conhecidos encontrados | Campos encontrados; perfil com deskew levou 8,097 s | Não comprovou ganho de reconhecimento nesse exemplo; tratamento adiciona trabalho e pode alterar aparência |
| Corrompido e protegido | Rejeitados | Rejeitados | Nenhum resultado vazio foi interpretado como conversão aprovada |

O perfil conservador de OCRmyPDF mediu aproximadamente **200–204 MiB de RSS agregado de subprocessos** nos scans desta máquina Windows. Isso exclui o processo Next.js do serviço e não mede a cobrança de memória de um contêiner Linux. Não comprova que documentos grandes ou operações simultâneas caibam no Render Free.

### Regressão de rotação e configuração alternativa

O PDF rotacionado expôs uma diferença importante: a CLI pode terminar com código zero sem texto útil no resultado. O perfil padrão com PDFium terminou sem os campos esperados. Rotação/deskew, redução do limiar e outros modos de segmentação/renderização também produziram resultados vazios ou parciais em algumas combinações. Essas tentativas não foram ocultadas.

O perfil **Ghostscript + rotação**, mantendo saída PDF normal e otimização desativada, recuperou os cinco campos e as 35 palavras distintas esperadas nesse arquivo:

```text
--mode skip --output-type pdf --optimize 0 --jobs 1
--oversample 300 --rasterizer ghostscript -l por+eng
--rotate-pages --rotate-pages-threshold 5
```

Tempo: **7,345 s**; RSS agregado amostrado: **203,2 MiB**. A página foi corrigida de paisagem/rotação de 90° para retrato. A amostra visual coincidiu após alinhamento ortogonal. O OCR atual já encontrava esses campos em **2,767 s**; portanto o perfil alternativo demonstra possibilidade de recuperação, não vantagem de velocidade sobre o atual.

Não recomendo aplicar limiar 5 a todos os arquivos: a [documentação do OCRmyPDF](https://ocrmypdf.readthedocs.io/en/latest/cookbook.html) alerta que limiares menores aumentam falsos positivos de orientação. A escolha precisa de análise por página e conferência da camada textual.

### Falha inicial do ambiente corrigida

Ao isolar os idiomas com `TESSDATA_PREFIX`, faltaram as pastas de configuração `configs`/`tessconfigs`, exigidas para hOCR. Isso causou erro `Can't open hocr`. As pastas foram copiadas para o ambiente de teste, sem modificar a instalação do sistema. A rodada inicial está separada em `initial-environment-issue.json`; os resultados comparativos finais foram refeitos após a correção.

## Integração recomendada, ainda não executada

1. Instalar OCRmyPDF em um ambiente Python separado no Docker, preservando a versão de PyMuPDF/pdf2docx do conversor Word. A [instalação oficial](https://ocrmypdf.readthedocs.io/en/latest/installation.html) suporta Linux/Debian e Windows.
2. Preservar páginas já textuais; usar OCR somente nas que precisam. Manter PDF normal e evitar otimização/reprocessamento visual desnecessários como padrão inicial.
3. Criar verificação por página: quantidade de páginas, dimensões, representação visual e texto efetivamente pesquisável. Código de saída zero e arquivo que abre não são suficientes.
4. Para páginas com orientação problemática ou OCR insuficiente, testar perfil alternativo dentro de orçamento de tempo. Manter o OCR atual como fallback. Se nenhum candidato for confiável, informar impossibilidade de conclusão.
5. Limitar páginas, pixels, tempo e concorrência. Medir memória dentro do contêiner Linux com o processo Next.js em execução antes de liberar no Render Free.
6. Avaliar formulários, anotações, documentos assinados e scans reais autorizados. Alterar um PDF assinado pode invalidar sua assinatura; os originais devem ser preservados.

Isso melhora o PDF pesquisável e pode preparar melhor scans para outras ferramentas. **Não resolve, sozinho, reconstrução de tabelas/layout de PDF para Word.**

## Arquivos e reprodução

Criados para avaliação: `scripts/benchmark-ocr-baseline.ts` e `scripts/benchmark-ocrmypdf.py`. O primeiro executa o OCR atual; o segundo cria fixtures e mede os perfis, sem alterar a aplicação.

```powershell
.vercel/tools/ocrmypdf-tests/Scripts/python.exe scripts/benchmark-ocrmypdf.py
.vercel/tools/ocrmypdf-tests/Scripts/python.exe scripts/benchmark-ocrmypdf.py --rotation-followup
.vercel/tools/ocrmypdf-tests/Scripts/python.exe scripts/benchmark-ocrmypdf.py --renderer-followup
.vercel/tools/ocrmypdf-tests/Scripts/python.exe scripts/benchmark-ocrmypdf.py --ghostscript-followup
```

Resultados/saídas/logs: `.vercel/review/ocrmypdf-benchmark/`. Versões instaladas: `requirements-tested.txt`. Sintaxe Python e TypeScript do projeto verificadas. Nenhum documento de cliente foi usado ou enviado a terceiros.

## Custos e licença

OCRmyPDF é disponibilizado sob [MPL-2.0](https://github.com/ocrmypdf/OCRmyPDF/blob/main/LICENSE); dependências têm condições próprias. Não foi contratada API, assinatura ou hospedagem adicional. Ainda não foi demonstrada a capacidade de produção do plano gratuito atual para esse fluxo. Esta etapa deixou uma proposta testada e suas limitações para revisão; **não houve publicação**.
