# Plano de implementação — PDF Master Pro

## 1. Direção do produto

**PDF Master Pro** será uma plataforma web em pt-BR (com estrutura de localização para en-US e es-ES) que permite trabalhar com documentos de forma rápida, clara e privada. A implementação será incremental: a primeira entrega torna a experiência principal utilizável e processa arquivos reais nas ferramentas essenciais; as fases posteriores expandem conversões, OCR, contas, billing e administração sem transformar recursos ainda não implementados em promessas visuais.

### Escopo obrigatório preservado

- Aplicação **Next.js + React + TypeScript**, com Tailwind CSS, componentes reutilizáveis, Zod/React Hook Form, ícones Lucide, layout responsivo e acessível.
- API REST versionada, validação no servidor, processamento de PDF isolável, controle de arquivos e estados de tarefa honestos.
- Ferramentas essenciais reais na primeira entrega: **Juntar PDF, Dividir PDF, Comprimir PDF quando o motor estiver instalado, Imagens para PDF, PDF para imagens, Girar PDF e Organizar PDF**.
- Catálogo completo de ferramentas organizado por categorias; ferramentas posteriores devem ser exibidas como **“em preparação”** ou “requer configuração” e não como CTAs funcionais.
- Estrutura para modo convidado, planos e privacidade. Autenticação, pagamentos, histórico persistente e painel administrativo entram nas fases seguintes com backend e banco de dados reais.

## 2. Arquitetura e fluxo técnico

### Aplicação web

- **Next.js App Router** com renderização estática/servidor para páginas públicas, API Route Handlers para endpoints e componentes cliente apenas onde forem necessários (upload, reordenação, tema, previews e ações de arquivo).
- **Tailwind CSS** e tokens CSS para tema claro/escuro; `next/font` para Inter; Lucide para ícones com `aria-label` e textos auxiliares.
- Componentes compartilhados: `Header`, `Footer`, `ToolCard`, `Dropzone`, `FileQueue`, `ProcessingState`, `ToolWorkspace`, `PageThumbnail`, `ThemeToggle`, `LanguageSwitcher`, `PlanCard`, `EmptyState` e `StatusBadge`.
- Layout com conteúdo semanticamente estruturado, foco visível, regiões `aria-live` para o processamento e preferência por movimento reduzido.

### Backend e processamento

- Endpoints em `/api/v1/*` para validação, processamento e download no primeiro módulo. Nenhum segredo, caminho interno ou erro técnico sensível será enviado ao navegador.
- Validação no servidor: máximo inicial de **25 MB por arquivo**, **5 arquivos por tarefa** para convidado/grátis, extensão permitida, MIME, assinatura binária e nome seguro. Os limites ficarão centralizados em configuração para plano Pro/Business posterior.
- Arquivos transitórios ficam sob uma pasta de trabalho com identificador aleatório, sem expor o caminho original. Em produção, o adaptador de armazenamento será trocado para objeto privado com URL assinada e metadados de propriedade no banco.
- Processadores são adaptadores: `pdf-lib` para juntar/dividir/rotacionar/reordenar/gerar PDF com imagens; Poppler (`pdftoppm`) para PDF→PNG/JPG; Ghostscript para compressão quando presente. A API detectará a disponibilidade dos binários: se o motor não estiver configurado, a ferramenta será bloqueada com mensagem explícita — nunca será simulado um arquivo comprimido.
- Cada resultado será aberto e validado antes do download. Resultados múltiplos serão compactados em ZIP. A primeira versão apresenta estados reais (“Validando”, “Processando”, “Verificando resultado”, “Concluído” ou “Falha”) sem percentual inventado.
- A limpeza automática inicial remove resultados temporários após 2 horas por um processo de limpeza acionado por acesso/execução. Em produção, esta responsabilidade migra para job/worker com registro de expiração no banco e deleção física no storage.

### Dados, autorização e infraestrutura futura

- Banco gerenciado provisionado para as fases persistentes. Migrações determinísticas definirão `users`, `jobs`, `file_objects`, `entitlements`, `subscriptions`, `payment_events`, `audit_events` e preferências.
- O login padrão será **Manus OAuth**, com sessão de aplicação validada no servidor, cookie `webdev_app_session`, nonce de estado único, redirecionamentos internos fixos e papéis `guest`, `user`, `admin`. A UI de conta não será marcada como completa antes dessa implementação.
- Quando os planos forem ativados, Stripe será habilitado pelo conector do projeto: Checkout criado no servidor, webhook com corpo bruto e assinatura validada, eventos idempotentes e entitlement persistente. Mercado Pago permanece uma integração alternativa futura, não uma falsa opção de checkout.
- Processadores pesados e OCR serão executados por worker/contêiner isolado em produção, com CPU, memória, tempo, páginas e taxa limitados. OCR, LibreOffice, PDF/A, reparo e conversões avançadas dependem de imagens/serviços próprios e serão declarados como requisitos de implantação.

## 3. Organização de código prevista

```text
pdfmasterpro/
├── app/
│   ├── (public)/                 # Home, catálogo, preços e páginas institucionais
│   ├── ferramentas/[slug]/       # Área por ferramenta e metadados dinâmicos
│   ├── api/v1/                   # Upload, processamento, resultado e health
│   ├── painel/                   # Fase de contas, histórico e preferências
│   ├── admin/                    # Fase administrativa com proteção por papel
│   ├── layout.tsx
│   ├── globals.css
│   ├── sitemap.ts
│   └── robots.ts
├── components/
│   ├── layout/
│   ├── marketing/
│   ├── tools/
│   └── ui/
├── lib/
│   ├── tools/                    # Registro de ferramentas e capacidades declaradas
│   ├── processing/               # Adaptadores, validação, ZIP e limpeza
│   ├── files/                    # Normalização, MIME, limites e armazenamento
│   ├── auth/                     # Fase OAuth e autorização
│   └── billing/                  # Fase Stripe e direitos de plano
├── public/
│   ├── manus-routes.json
│   └── brand/
├── tests/
│   ├── unit/
│   └── integration/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── IMPLEMENTED_AND_PENDING.md
├── plan.md
├── TODO.md
├── .env.example
└── Dockerfile
```

## 4. Design system

### Movimento de design

**Calm Tech Editorial**: uma estética de software profissional que combina a clareza de uma ferramenta de produtividade com a segurança visual de um arquivo bem organizado. É uma interpretação original, sem replicar a composição de nenhum concorrente.

### Princípios centrais

1. **Clareza operacional** — a próxima ação, o estado do arquivo e a consequência de cada opção são sempre visíveis.
2. **Confiança por evidência** — segurança, retenção e resultados aparecem como informações específicas, não como promessas vagas.
3. **Densidade controlada** — muitos recursos são agrupados por tarefa, com espaço em branco e hierarquia que reduz a carga cognitiva.
4. **Progresso honesto** — movimentos e mensagens representam uma etapa real do processamento, sem métricas decorativas.

### Filosofia de cor

O coral **#E5484D** é a assinatura proprietária: chama para a ação sem transformar o produto em uma página promocional. O índigo **#5B5BD6** informa estrutura e navegação; o verde **#16A34A** é reservado a sucesso e integridade. Cinzas frios criam uma base documental neutra, preservando foco, contraste e leitura longa em ambos os temas.

### Paradigma de layout

A home usa uma **coluna de trabalho ancorada**: o hero e o dropzone ocupam o eixo principal, enquanto cartões de categoria formam faixas horizontais de descoberta. Nas ferramentas, uma faixa superior contém contexto e limites; abaixo, o workspace divide fila de arquivos, opções e resultado. No celular, essa sequência se torna linear, com controles primários sempre próximos do conteúdo que alteram.

### Elementos de assinatura

- **Marca “P” em páginas sobrepostas**: símbolo geométrico próprio em coral/índigo, usado no wordmark, favicon e marcação de área de trabalho.
- **Trilho de processamento**: uma linha curta com nós de estado que substitui barras genéricas e só avança ao mudar o estado real.
- **Cartões de arquivo em borda pontilhada suave**: reforçam a ideia de entrada temporária e organizada, sem ilustrações decorativas excessivas.

### Interação e animação

Dropzones respondem com elevação suave e borda coral quando recebem um arquivo válido. Reordenações informam posição via teclado e leitor de tela. As transições duram 160–220 ms, respeitam `prefers-reduced-motion` e nunca escondem uma mudança de estado. Ações de processamento ficam bloqueadas enquanto uma requisição estiver ativa para impedir duplicação.

### Tipografia, marca e voz

- **Inter** para interface e conteúdo, com títulos em pesos 700/800 e textos operacionais em 400/500. Números e tamanhos usam alinhamento tabular quando aplicável.
- **Essência da marca:** ferramentas profissionais de PDF para quem precisa concluir tarefas documentais com rapidez, controle e privacidade. Personalidade: **precisa, acolhedora e confiável**.
- **Wordmark:** “PDF” em peso forte e “Master Pro” em peso médio, precedidos do monograma de páginas sobrepostas. Não será apenas texto em fonte padrão.
- **Voz:** direta, operacional e transparente. Exemplos: “Escolha os arquivos que deseja combinar.” e “O resultado está pronto para baixar e será excluído automaticamente em até 2 horas.”

## 5. Fases de entrega

### Fase 1 — Fundação visual e arquitetura

Criar o projeto Next.js, sistema de design, header/footer, temas, navegação, rotas públicas, home, busca de ferramentas, catálogo, páginas de ferramenta, páginas institucionais e manifesto de rotas. Criar `.env.example`, documentação inicial e endpoints de health/processamento base.

### Fase 2 — Ferramentas essenciais reais

Implementar upload seguro, validação e fila de arquivos; juntar, dividir, imagens para PDF, PDF para imagens, girar e organizar PDF com `pdf-lib`/Poppler; compressão somente se Ghostscript estiver efetivamente instalado; download, ZIP, verificação de saída e expiração temporária. O workspace terá prévia de páginas quando tecnicamente disponível e mensagens claras para incompatibilidades.

### Fase 3 — Processamento avançado

Adicionar conversões de escritório em ambiente isolado, OCR com idioma configurável, extração de texto, marca d’água, paginação, metadados, assinatura visual, proteção autorizada, PDF/A, reparo, comparação, HTML permitido para PDF e redação segura. Cada funcionalidade dependerá de motor instalado e declarará as limitações técnicas e legais relevantes.

### Fase 4 — Contas e planos

Adicionar Manus OAuth, conta, sessões, painel, histórico, preferências, limites de plano e controle de acesso. Habilitar Stripe de teste, catálogo de produtos, checkout no servidor, webhooks assinados e históricos de cobrança apenas após os modelos persistentes existirem.

### Fase 5 — Administração, isolamento e observabilidade

Adicionar área administrativa protegida, auditoria, gestão de limites/ferramentas/planos e painéis agregados. Migrar processadores demorados para worker isolado, implementar fila com retentativas, storage privado e política de retenção/deleção orientada por jobs.

### Fase 6 — Produção

Completar documentação de deploy, contêiner com binários explicitamente licenciados, migrações, backups e health checks. Finalizar SEO por rota, metadados, robots, sitemap, métricas não invasivas e testes automatizados de fluxos críticos.

## 6. Decisões e restrições conhecidas

- A primeira versão não deverá oferecer botões de pagamento, login ou administração que aparentem funcionar antes do respectivo backend existir.
- Uma conversão anunciada depende de motor externo somente quando a instalação/isolamento desse motor for realmente configurada; a UI mostrará esse requisito.
- O storage provisionado permite presign de upload/download, mas a remoção física de objetos exige uma operação administrativa/worker: a promessa de eliminação definitiva só será feita após essa integração estar instalada.
- O banco gerenciado é MySQL compatível no ambiente atual, apesar da recomendação inicial de PostgreSQL. A implementação usará uma camada ORM/migrações portátil e não assumirá recursos exclusivos de PostgreSQL.
- Como ainda não há domínio público configurado, canonical e URLs absolutas de compartilhamento não serão inventados; serão habilitados na preparação de produção.
