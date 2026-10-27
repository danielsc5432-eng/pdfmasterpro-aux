# Implementado e pendente

## Implementado nesta entrega

A plataforma tem fundação visual responsiva, catálogo, busca local, tema claro/escuro, upload com drag-and-drop, validação server-side de assinatura/MIME/extensão/tamanho, limites grátis de 25 MB por arquivo e 5 arquivos por tarefa, histórico persistente por sessão e rotas públicas documentadas. A persistência é opcional: sem `DATABASE_URL` o processamento segue normalmente e apenas o histórico fica indisponível, sem derrubar as ferramentas.

As ferramentas funcionais são: juntar PDF; dividir por intervalo ou ZIP de páginas; imagens para PDF; PDF para imagens; girar; organizar; comprimir com Ghostscript; PDF para Word; Word para PDF; OCR em PDF ou imagem; extrair texto; marca d’água de texto; números de página; assinatura visual de texto; proteção com senha e criptografia qpdf; edição de título/autor/assunto/palavras-chave; e redação rasterizada com coordenadas. Todos os resultados são validados antes do download e tarefas registram apenas metadados técnicos.

Limitações são exibidas de forma explícita: PDF para Word usa o Microsoft Word como motor (com reconstrução de layout como reserva quando o Word não está disponível), devolve ao DOCX, seção por seção, o tamanho exato de cada página do PDF (inclusive páginas de tamanhos diferentes) e zera a margem inferior para preservar a contagem de páginas, mas PDFs com posicionamento absoluto extremo ainda podem ter a paginação reajustada em casos raros, comportamento nativo do reflow do Word; OCR depende dos idiomas instalados e pode conter erros; assinatura visual não é assinatura digital criptográfica; redação rasteriza somente a(s) página(s) atingidas para remover o conteúdo subjacente da área selecionada, preservando as demais páginas como texto vetorial; compressão permanece disponível quando Ghostscript estiver configurado. Os motores externos são detectados de forma multiplataforma (`which`/`where`) e podem ser informados por caminho absoluto.

## Pendente / requer evolução

- Persistência de objetos no storage privado, URLs assinadas, filas assíncronas, workers isolados e limpeza física.
- Limites avançados de páginas/CPU/memória, observabilidade e carga de produção.
- Manus OAuth, painel de conta, histórico autenticado, limites por assinatura e área administrativa.
- Stripe em sandbox, webhooks assinados, produtos/preços e histórico de cobranças.
- Edição de texto original, ajuste fino da paginação no reflow do Word, OCR com mais idiomas e assinatura digital criptográfica.
- Domínio público para canonical e Open Graph absolutos.
