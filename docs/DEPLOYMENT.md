# Implantação

## Conversão PDF para Word

O caminho padrão reconstrói o layout por coordenadas e exige Poppler (`pdftotext`, `pdftohtml` e `pdftoppm`). O renderizador também preserva bordas e preenchimentos em uma camada gráfica, mantendo os textos editáveis. O reflow do Microsoft Word é opcional por `PDF_TO_WORD_NATIVE_REFLOW=1`; as referências abaixo ao Word como motor padrão descrevem a configuração anterior para PDF→Word. Word→PDF continua usando Word quando disponível, com LibreOffice como reserva.

Mudanças nos processadores precisam ser publicadas no worker externo, quando configurado. Um deploy isolado da Vercel não altera o código desse worker.

## Build

O container instala dependências com `pnpm-lock.yaml`, executa `pnpm build` e sobe `pnpm start` na porta 3000 (ou `PORT`). Antes de iniciar uma versão com alterações de schema, execute `pnpm db:migrate` com `DATABASE_URL`; o runner é aditivo e idempotente.

## Dependências nativas

## Dependências nativas

A imagem de produção instala Poppler (`pdftotext`, `pdftoppm`), Ghostscript (`gs`, compressão), qpdf (proteção/verificação), Tesseract e `tesseract-ocr-por` (OCR) e LibreOffice Writer (reserva do Word→PDF). Em Windows com Microsoft Word instalado, defina `PDF_TO_WORD_CONVERTER=msword` e `WORD_CONVERTER=msword` para usar o Word como motor das conversões Word↔PDF (automação COM; exige PowerShell e permissão para iniciar processos); sem Word (por exemplo, no contêiner Linux) os motores caem automaticamente na reserva (`rebuild` para PDF→DOCX e LibreOffice para DOCX→PDF). A redação rasterizada é feita em Node com `pngjs`, sem dependência de Python. Fixe versões, revise licenças, limite CPU/memória/tempo e execute conversores em workers isolados antes de uma operação de produção em escala.

## Processamento com worker externo (recomendado para hospedagem na Vercel)

Para que todas as 17 ferramentas funcionem na Vercel (que não possui Poppler, Ghostscript, qpdf, Tesseract, LibreOffice nem Microsoft Word), publique o projeto em um container com binários nativos (ex.: Render, Fly.io, Railway, VPS) usando o `Dockerfile` deste repositório e aponte o frontend para esse worker:

1. **Deploy do worker**: faça o deploy do mesmo repositório em um serviço de container. O `Dockerfile` instala `poppler-utils`, `ghostscript`, `qpdf`, `tesseract-ocr`, `tesseract-ocr-por`, `fontconfig`, `libreoffice-writer`, `imagemagick` e expõe a porta `3000`. Defina as variáveis necessárias (`DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, etc.).
2. **Configurar a Vercel**: na Vercel, defina `PROCESSING_WORKER_URL` para a URL pública do worker (por exemplo, `https://worker.pdfmasterpro.com.br`). Não defina essa variável no próprio worker.
3. **Mesmo domínio opcional**: você pode usar um subdomínio (`api.pdfmasterpro.com.br`) apontado para o worker atrás de um proxy reverso (nginx, Cloudflare Tunnel, etc.). O proxy deve encaminhar `/api/v1/process` para o worker, mantendo os headers `Content-Type`, `Content-Length` e `Content-Disposition`.
4. **Limites**: o worker deve suportar requisições de até ~130 MB (conforme `MAX_REQUEST_BYTES`) e tempo suficiente para conversões longas (Word/reflow podem levar ~10–60s). Configure o timeout do seu provedor de container adequadamente.
5. **Segurança**: restrinja o acesso ao endpoint de processamento, se necessário. Como as ferramentas funcionam via POST com FormData, manter a URL interna/privada ou configurar CORS apenas para o domínio da Vercel é suficiente.

## Processamento na própria função (sem worker)

Caso não defina `PROCESSING_WORKER_URL`:
- O endpoint processará tudo na função da Vercel;
- **Ficaram indisponíveis**: `pdf-para-word`, `word-para-pdf`, `extrair-texto`, `ocr-pdf`, `pdf-para-imagens`, `redigir-pdf`, `comprimir-pdf`, `proteger-pdf` (e validações associadas) — pois dependem de binários nativos inexistentes no ambiente Linux serverless. As ferramentas puramente em Node (`juntar-pdf`, `dividir-pdf`, `girar-pdf`, `organizar-pdf`, `imagens-para-pdf`, `marca-dagua`, `numerar-paginas`, `assinar-pdf`, `editar-metadados`) ainda funcionam, desde que respeitem os limites de tamanho/tempo da Vercel.

## Persistência e retenção

A aplicação persiste metadados de tarefas em Postgres/Neon (`processing_tasks`) por hash de sessão anônima: ferramenta, quantidade/tamanho, status, tipo/tamanho do resultado e timestamps. Conteúdo e nomes não entram no banco. Os bytes ainda são temporários; antes do lançamento em escala, adicionar storage privado, URLs assinadas, fila/worker e deleção física.
