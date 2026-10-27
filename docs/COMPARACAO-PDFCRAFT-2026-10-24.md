# Teste PDFCraft — 24/10/2026

## Método

Repositório oficial https://github.com/PDFCraftTool/pdfcraft, commit `53e469252b616aa0ac654efa267d2e92ac821866`. Clone de avaliação em `.vercel/tools/pdfcraft`, ignorado pelo Git. Nenhum código AGPL foi incorporado ao produto.

Worker original `public/workers/pdf-to-docx.worker.js`, sem alterações, executado em Chrome headless com servidor HTTP ligado exclusivamente ao endereço 127.0.0.1. Requisições HTTPS externas bloqueadas. Arquivos de entrada servidos localmente: mesmas cópias de extração usadas pelos motores existentes, sem texto oculto fora dos campos. Os PDFs não foram enviados ao site público do PDFCraft.

O conversor utiliza Pyodide, pdf2docx 0.5.8, PyMuPDF 1.26.3 e python-docx 1.2.0. Portanto é outra implantação dos motores já presentes, não um algoritmo independente. O worker desativa `parse_stream_table` e usa parâmetros próprios para imagens/SVG. Não faz OCR nessa conversão.

## Execução no navegador

- DTC: conversão concluída em aproximadamente 3,1 segundos após inicialização; DOCX de 66.458 bytes.
- INSS: aproximadamente 9,3 segundos após inicialização; DOCX de 1.487.031 bytes.
- Recursos únicos locais solicitados: 15 arquivos, total de 56.272.429 bytes (cerca de 53,7 MiB sem considerar compressão de transferência e cache). Isso não inclui toda a aplicação PDFCraft.
- Esses tempos foram medidos neste computador e não representam desempenho garantido em celulares ou aparelhos com menos memória.

## Conferência com LibreOffice

| Caso | Páginas de origem → resultado | Texto editável | Termos numéricos | Similaridade visual |
| --- | --- | --- | --- | --- |
| DTC / PDFCraft | 3 → 4 | 100% | 100% | 18,6% |
| DTC / pdf2docx atual | 3 → 3 | 100% | 100% | 39,0% |
| INSS / PDFCraft | 2 → 2 | 100% | 100% | 48,2% |
| INSS / pdf2docx atual | 2 → 2 | 100% | 100% | 55,6% |

Texto e números são conferidos no XML editável do DOCX. Isso não garante que tudo apareça corretamente no Word. A similaridade visual é uma métrica específica do projeto calculada via PyMuPDF/OpenCV após exportação por LibreOffice, que pode renderizar de forma diferente do Microsoft Word. Não representa uma nota universal da biblioteca.

Na conferência automática, DTC foi reprovado por alteração de paginação; INSS permaneceu em revisão de layout. Nenhum atingiu o critério de fidelidade exigido para entrega sem ressalvas. A avaliação não comprova que o processamento no navegador melhore a fidelidade em relação ao motor atual.

Foi tentada uma exportação adicional pelo Microsoft Word via COM em instância oculta, com abertura somente leitura. A automação ficou bloqueada e não produziu PDF; essa validação é inconclusiva. A instância criada pelo benchmark foi encerrada. Não afirmar que as quatro páginas observadas no LibreOffice também ocorrerão no Microsoft Word.

## Decisão

Não substituir o conversor de produção pelo PDFCraft com base nesses resultados. O processamento em navegador é tecnicamente viável e reduz a necessidade de servidor para a conversão, mas exige baixar recursos consideráveis e não corrigiu os desvios de layout nos documentos testados. Uma implantação futura precisaria de comparação adicional, validação em dispositivos, limites de memória, cancelamento e análise da licença AGPL-3.0 antes de incorporar código.

Artefatos completos estão em `.vercel/review/`: `PDFCraft-DTC.docx`, `PDFCraft-INSS.docx`, `pdfcraft-comparison.json`, `pdfcraft-requests.json` e `test-pdfcraft.mjs`. Não publicar documentos pessoais ou esses artefatos no repositório público. O site em produção não foi alterado neste teste.
