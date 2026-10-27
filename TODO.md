# TODO — PDF Master Pro

## Fundação e processamento

- A home, catálogo, rotas públicas, tema e upload permanecem responsivos e acessíveis.
- Os processadores essenciais validam conteúdo real, limites, erros, integridade e downloads.
- PDF para Word extrai texto real e gera DOCX válido; layout complexo e OCR têm limitações explícitas.
- Word para PDF, OCR, extração de texto, marca d’água, numeração, assinatura visual, proteção, metadados e redação rasterizada estão funcionais com motores configuráveis e mensagens honestas.

## Persistência e operação

- O MySQL gerenciado aplica migrações versionadas e persiste somente metadados técnicos por sessão anônima.
- Resultados ainda são temporários; storage privado, URLs assinadas, fila assíncrona, workers isolados e limpeza física permanecem necessários para produção em escala.
- OAuth, planos, billing, administração e histórico autenticado permanecem pendentes.
