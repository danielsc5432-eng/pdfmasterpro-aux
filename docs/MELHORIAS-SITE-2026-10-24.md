# Destaque, marca e área da conta — 24/10/2026

## Entrega

- Homepage apresenta o Detector de Divergências com demonstração explicitamente ilustrativa, acesso direto e explicação em três passos. Os demais fluxos continuam acessíveis pelo catálogo e pela seleção local de arquivos.
- Logo fornecida pelo proprietário preservada em `public/brand/pdfmasterpro-full.png`: símbolo no cabeçalho e ícones, arte completa no rodapé e compartilhamento social.
- Cabeçalho reconhece o login e oferece menu de conta, painel, perfil, histórico, assinatura e saída. Menu acessível por teclado, fecha com Escape e clique externo.
- Perfil permite salvar nome de exibição e ferramenta favorita, consultar plano e uso desta sessão, exportar os dados exibidos em JSON e escolher o tema no dispositivo.
- Preferências persistidas pela migração aditiva `004_user_preferences.sql`; o nome preferido não é sobrescrito pelo nome do provedor em um login futuro. E-mail e identidade de autenticação permanecem protegidos.
- API privada exige sessão assinada, valida origem e conteúdo, recusa campos extras e informa falhas sem anunciar gravação inexistente. Dados de terceiros não são retornados. Falha de consulta da assinatura não é apresentada como plano grátis no perfil.
- Logout usa POST validado e limpa as duas sessões. Cookie inválido de processamento recebe nova identificação corretamente.
- Cancelamento recorrente só informa sucesso depois da confirmação do Mercado Pago e da gravação local. Falhas e respostas divergentes são tratadas. Compras avulsas aparecem sem renovação automática.
- Navegação da conta unificada, nomes legíveis no histórico, datas no fuso de São Paulo e páginas de privacidade/termos alinhadas aos recursos disponíveis.

## Validação local

- `pnpm test` com `PDF_TO_WORD_PYTHON` configurado: **136 testes aprovados**, zero falhas ou testes ignorados.
- Build Next.js e TypeScript aprovados.
- `scripts/smoke-routes.mjs`: **52 verificações aprovadas**.
- `scripts/smoke-tools.ts`, contra servidor isolado e arquivos sintéticos: **27/27 verificações aprovadas**. Inclui conversão nos dois sentidos, OCR, manipulação, proteção, redação e rejeição de entradas inválidas. O primeiro teste de Word para PDF detectou um caminho incorreto do LibreOffice no ambiente local; repetido com `C:/Program Files/LibreOffice/program/soffice.exe`, passou.
- `scripts/smoke-ui.mjs`: seleção, ordenação, substituição/remoção, PDF gerado, comparação com evidências e relatório, bloqueios Premium, preços, temas e navegação móvel aprovados.
- Perfil autenticado testado exclusivamente com assinatura e usuário fictícios locais. CDP forneceu respostas de perfil para testar edição, atualização do cabeçalho, exportação JSON, atalho e temas; a persistência e a autorização reais foram verificadas separadamente pelos handlers e SQL sobre banco descartável. Logout POST executado pelo servidor local real.
- Homepage e perfil verificados em 320, 390, 768, 920 e 1440 px; capturas revisadas em `.vercel/review/flagship/` (artefatos locais ignorados pelo Git).

Para repetir o teste opcional da conta, use build e servidor **locais** com `NEXT_PUBLIC_SITE_URL=http://localhost:3100`, `MANUS_PROJECT_ID=isolated-ui-app`, `AUTH_SESSION_SECRET=isolated-ui-test-only`, sem banco ou worker de produção, e execute `SMOKE_ACCOUNT=1 node scripts/smoke-ui.mjs`. Essas chaves fictícias não devem ser configuradas em produção.

## Limites da evidência

Os testes não provam funcionamento perfeito para qualquer PDF. Login com conta Google real e cobrança/cancelamento financeiro reais não foram executados nesta entrega. Após o proprietário confirmar que ainda precisa criar a caixa de suporte, o endereço provisório foi retirado. `/contato` exibe orientações e informa o canal em preparação até configurar uma caixa real em `SUPPORT_EMAIL`. Instruções em `EMAIL-SUPORTE.md`; não foram contratados serviços ou ativados modelos externos.

A Vercel aplica a migração antes do build de produção; falha da migração impede a publicação. O serviço Render mantém o processamento nativo; sua disponibilidade e recursos continuam sujeitos ao plano contratado.
