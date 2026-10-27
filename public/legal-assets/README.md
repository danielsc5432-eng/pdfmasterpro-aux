# Assets locais do PDF TimeMachine Jurídico

PDF.js (`pdfjs-dist` 6.4.299), Tesseract.js 7.0.0 e seu core são dependências npm fixadas no lockfile. O build copia os arquivos necessários e suas licenças para esta pasta por `scripts/prepare-legal-assets.mjs`, chamado na configuração Next.js também quando a hospedagem executa `next build` diretamente.

As pastas geradas `pdfjs/` e `ocr/core/`, o worker OCR e sua licença são ignorados no Git e reconstruídos sem downloads adicionais de modelos. As licenças de fontes e decodificadores distribuídas pelo PDF.js acompanham seus respectivos diretórios.

Os idiomas `por` e `eng` são mantidos em `ocr/lang/`. Fonte: https://github.com/tesseract-ocr/tessdata_fast, revisão `87416418657359cb625c412a48b6e1d6d41c29bd`, licença Apache-2.0. O manifesto registra SHA-256 e tamanho de cada arquivo. A licença está ao lado dos modelos.

O navegador carrega estes componentes pela mesma origem do site. Documentos, imagens renderizadas e texto OCR não são enviados a CDNs ou provedores externos. Os assets são software/modelos públicos, não dados de usuários.
