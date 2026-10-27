# PDF Master Pro

Plataforma web em pt-BR para tarefas reais de PDF, conversões e segurança documental.

## Executar localmente

```bash
corepack enable
pnpm install
pnpm dev
```

A aplicação abre em `http://localhost:3000`. O build de produção é validado com `pnpm test && pnpm typecheck && pnpm build`.

O comando `pnpm db:migrate` (que exige `DATABASE_URL`) é opcional: sem banco configurado todas as ferramentas processam normalmente e apenas o histórico por sessão fica indisponível.

Para conferir as ferramentas de ponta a ponta contra o servidor em execução, use `pnpm exec tsx scripts/smoke-tools.ts`.

## Ferramentas funcionais

PDF para Word usa reconstrução por posições para manter textos editáveis, imagens e grades nas páginas de origem. Linhas e preenchimentos são uma camada gráfica separada, não uma tabela editável do Word. O reflow do Microsoft Word pode ser habilitado explicitamente com `PDF_TO_WORD_NATIVE_REFLOW=1`; diferenças de layout continuam possíveis.

Juntar, dividir, imagens para PDF, PDF↔Word, OCR, extração de texto, compressão, marca d’água, numeração, assinatura visual, proteção por senha, metadados e redação rasterizada estão conectados ao backend real.

As limitações são honestas: PDF para Word e Word para PDF podem alterar layouts complexos; OCR pode conter erros; assinatura visual não é assinatura digital criptográfica; redação recria a página como imagem para remover o conteúdo da área, sacrificando texto editável.

## Limites e persistência

O modo convidado/grátis limita cada arquivo a 25 MB e cada tarefa a 5 arquivos. A validação ocorre no servidor com conteúdo real, extensão, MIME e tamanho. Status, ferramenta, quantidade/tamanho e timestamps são persistidos por hash de sessão anônima em `/historico`; bytes e nomes dos documentos não entram no banco.

## Ambiente nativo

A imagem de produção instala Poppler, Ghostscript, qpdf, Tesseract com português e LibreOffice Writer. Em execução nativa, os motores podem ser apontados por variável de ambiente (`PDF_RENDERER`, `PDF_COMPRESSOR`, `PDF_TEXT_EXTRACTOR`, `OCR_ENGINE`, `PDF_PROTECTOR`, `PDF_TO_WORD_CONVERTER`, `WORD_CONVERTER`, `SOFFICE_CONVERTER` e `TESSDATA_PREFIX`), aceitando tanto o nome do comando quanto o caminho absoluto do binário. Nas conversões Word↔PDF, `msword` usa o Microsoft Word instalado (padrão quando disponível, com queda automática para a reserva); `PDF_TO_WORD_CONVERTER=rebuild` força a reconstrução de layout e um caminho em `WORD_CONVERTER`/`SOFFICE_CONVERTER` aponta o LibreOffice. `DATABASE_URL` é usado pelo banco gerenciado; aplique schema com `pnpm db:migrate`. Não coloque segredos no navegador.

## Próximas fases

Storage privado, filas/workers, OAuth, limites de assinatura, administração, Stripe, OCR com mais idiomas, reconstrução avançada de layout e assinatura digital criptográfica estão documentados em `docs/IMPLEMENTED_AND_PENDING.md`.
