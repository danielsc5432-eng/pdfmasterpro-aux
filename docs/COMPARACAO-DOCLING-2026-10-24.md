# Comparação Docling — PDFs de referência

Teste no preview privado, sem alterar o processamento de produção ou contratar recursos pagos. Documentos e respostas estão somente nos artefatos locais ignorados `.vercel/review/`.

## Falhas identificadas e ajustes

1. O PDF sintético simples passou anteriormente, mas os dois formulários reais falharam na configuração com OCR.
2. Logs identificaram escrita dos modelos RapidOCR em diretório somente leitura. Caminho alterado para `/tmp` em um segundo preview.
3. A repetição identificou `No space left on device` durante o download dos modelos OCR.
4. A configuração experimental foi restringida a texto nativo e análise de tabelas (`do_ocr=False`). O OCR de documentos digitalizados permanece responsabilidade do motor existente. Não declarar suporte OCR completo do Docling na Vercel.

## Referência dos motores existentes

Conferência real com LibreOffice, PyMuPDF e OpenCV contra os PDFs de extração, sem texto invisível:

| Arquivo / motor | Páginas | Cobertura de texto editável | Cobertura numérica | Similaridade visual |
| --- | --- | --- | --- | --- |
| DTC / posicional | 3 → 3 | 100% | 100% | 55,5% |
| DTC / pdf2docx | 3 → 3 | 100% | 100% | 39,0% |
| INSS / posicional | 2 → 2 | 100% | 100% | 57,5% |
| INSS / pdf2docx | 2 → 2 | 100% | 100% | 55,6% |
| DTC / Docling nativo + reconstrução DOCX | 3 → 3 | 96,87% | 72,34% | 25,86% |

As porcentagens visuais são a métrica automatizada específica do projeto, não uma garantia de aparência no Microsoft Word. O LibreOffice tem diferenças conhecidas na renderização de quadros posicionados. Texto presente no XML não garante posição correta na tela. Todos os resultados exigem revisão visual.

## Decisão de ativação

**Não ativar a configuração testada em produção.** O candidato DTC foi reprovado por `unsafeFidelity` devido à cobertura numérica; também alterou as dimensões das páginas. Os percentuais se referem à combinação Docling nativo + nosso reconstrutor, não a uma avaliação universal da biblioteca. A ausência de OCR pode ter impacto em regiões rasterizadas do formulário.

A ficha INSS retornou HTTP 500 com `Application exited with code 137 (SIGKILL)`. Não houve DOCX utilizável para comparar. O log não comprova isoladamente falta de memória. Preview final: `dpl_5Ms25MHbW3otweaxMhAVk1z2f199`.

O JSON real continha referências `#/pictures`, antes recusadas pelo adaptador. Corrigido o percurso das figuras para preservar suas legendas; imagens e geometria ainda não são reconstruídas nessa variante. Adicionado teste de regressão; 86 testes aprovados e TypeScript validado.

Um resultado sem medição não deve substituir o atual. Não usar sucesso de build ou health check como prova de conversão fiel. Melhorias futuras exigem rever a reconstrução de imagens, tamanho da página, tabelas e OCR em ambiente com recursos adequados antes de nova ativação. Nenhuma variável DOCLING_URL foi configurada em produção.
