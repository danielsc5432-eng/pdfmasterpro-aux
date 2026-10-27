# Revisão jurídica opcional com IA gratuita

Implementada em 26/10/2026, sem publicação. Complementa a [suíte jurídica](JURIDICO-SUITE-2026-10-26.md). A análise principal continua sendo local; a revisão de trechos descrita aqui é uma etapa separada, em servidor, mediante consentimento.

## Provedores e verificação real

Reutiliza a configuração já existente do ResumoMaster: Cloudflare Workers AI como principal e Groq como reserva configurável. Nenhuma biblioteca, assinatura ou API paga nova foi contratada.

Foi executada **uma chamada real**, usando somente dois trechos de contrato inteiramente sintéticos. O modelo `@cf/meta/llama-3.3-70b-instruct-fp8-fast` retornou três tópicos sobre entrega, valor e aviso de rescisão; as citações e os números passaram pela validação. Evidência local: `.vercel/review/legal/ai-live.json`, sem segredos ou documentos de clientes. O script `scripts/check-legal-ai.ts` carrega exclusivamente as variáveis de IA permitidas de `.env.summary`; sua repetição consome franquia do provedor.

A reserva Groq foi validada por testes com transporte controlado, inclusive troca somente após erro temporário. Não foi feita segunda chamada real ao Groq nesta etapa.

## Funcionamento

Disponível como complemento nas seis ferramentas e no TimeMachine. Após analisar localmente:

1. O componente consulta disponibilidade, login e provedores, sem enviar documentos.
2. Seleciona até oito blocos, priorizando evidências e distribuindo fontes entre documentos. Cada trecho contém até 750 caracteres; total até 6.000.
3. A pessoa pode ler a prévia e desmarcar trechos. Nenhum envio ocorre automaticamente.
4. O consentimento identifica o principal e a reserva, suas políticas de dados e o conteúdo selecionado.
5. O servidor autentica, valida origem, consentimento, schema e cotas. Envia texto, páginas, identificadores e instruções específicas da ferramenta; não envia PDFs, imagens, nomes de arquivo, hashes ou credenciais ao navegador.
6. A resposta exige citações sustentadas pelos trechos e números/moedas compatíveis com as citações. Resposta interrompida, referência inventada ou estrutura inválida é recusada. Essas verificações não comprovam que toda interpretação esteja correta.
7. As sugestões ficam separadas dos resultados determinísticos, abrem a fonte e aparecem identificadas em PDF, DOCX, TXT, CSV e no relatório do ZIP do organizador. Não modificam cláusulas, classificações ou nomes automaticamente.

Focos: obrigações/condições no ContractCheck; eventos/datas explícitos na Timeline; tipo/assunto/partes para organização; prazos escritos sem cálculo no PrazoExtractor; estrutura/relações expressas na PetiçãoReview; diferenças sustentadas por trechos no ProvaCompare e TimeMachine. Não há parecer jurídico, autenticação ou validação de legislação.

## Segurança e limites

- `LEGAL_AI_ENABLED=true` é exigido no servidor. Apenas Cloudflare/Groq com confirmação Free já exigida pela configuração de resumo são aceitos. Modelos Cloudflare conhecidos como exclusivos do plano pago são bloqueados.
- Não há compra, upgrade de plano nem troca automática para modelo pago. A confirmação de plano é responsabilidade do operador; o código não consulta faturamento. Se a conta for alterada para um plano pago fora do site, é necessário revisar limites e configuração antes de manter o recurso ativo.
- Limite adicional de **3 tentativas por conta em 24 horas**, **20 por conexão** e **50 no site**, compartilhado pelas ferramentas jurídicas. A análise local mantém sua cota existente. Tentativas admitidas podem consumir limite mesmo sem resultado.
- Até duas chamadas por revisão: principal e, somente em falha temporária, reserva. Resposta malformada ou citação incorreta não dispara nova chamada automática. Tempo total até 48 segundos no servidor e corpo JSON de até 32 KB.
- O servidor usa apenas contadores técnicos protegidos por HMAC; não salva trechos ou respostas em histórico nem em logs de aplicação. A política de retenção dos provedores é separada e indicada antes da autorização.
- Cancelamento, limpeza e mudança de seleção invalidam resultados tardios. A IA falhar não apaga o resultado local. O cancelamento não garante que uma solicitação já recebida pelo provedor deixe de consumir franquia.
- Chaves permanecem no backend. A prévia informa que a amostra não cobre o documento inteiro. O usuário precisa ter autorização para compartilhar conteúdo confidencial.

## Custos e fontes consultadas

A [Cloudflare informa franquia de 10.000 Neurons por dia](https://developers.cloudflare.com/workers-ai/platform/pricing/), compartilhada entre tarefas; isso não corresponde a uma quantidade fixa de documentos. [Alguns modelos exigem plano pago](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/), razão do bloqueio e da verificação da configuração. O [Groq aplica limites por plano e modelo](https://console.groq.com/docs/rate-limits). Nenhuma dessas franquias é ilimitada ou garantida para sempre.

As páginas de dados são [Cloudflare](https://developers.cloudflare.com/workers-ai/platform/data-usage/) e [Groq](https://console.groq.com/docs/your-data). Ao esgotar cota ou obter resposta não validável, o recurso informa indisponibilidade e preserva o trabalho local. Hospedagem e tráfego do site continuam sujeitos aos planos existentes.

## Arquivos

Criados: `lib/legal/ai-shared.ts`, `ai-service.ts`, `ai-route.ts`; `app/api/legal/ai/route.ts`; `components/legal/ai-review.tsx`; `tests/unit/legal-ai.test.ts`; `scripts/check-legal-ai.ts`, `smoke-legal-ai.mjs`.

Atualizados: workspaces jurídicos, relatórios, tipos, configuração do catálogo, CSS, hub, privacidade, scripts de rotas/testes e `.env.example`. A flag foi habilitada somente em `.env.summary` local, ignorado pelo Git. Nenhuma chave foi incluída em código, relatório ou commit.

## Validação

- **257 testes automatizados passaram**, sem falhas ou ignorados; oito novos casos de IA cobrem consentimento, schema, cota, login/origem, seleção distribuída, citações inventadas, números alterados, cancelamento, falha temporária e configurações não permitidas.
- **77 verificações de rotas passaram** em servidor isolado, sem banco ou credenciais de produção.
- Compilação Next.js/TypeScript concluída.
- Chrome: os sete fluxos exibem a etapa opcional, não enviam texto antes do consentimento, mantêm resultado local após falha e invalidam resposta ao trocar seleção. Exportações PDF/DOCX/TXT/CSV incluem a seção de IA; visualizador abre a evidência. Testadas larguras 320/390/768/1440.
- Nos testes de navegador, a extração PDF é real e a resposta HTTP de IA é controlada para validar a interface sem enviar os PDFs. A única chamada externa real é o teste sintético separado descrito acima.

## Ativação e publicação

Sem deploy ou push. Para publicar futuramente, a flag e as variáveis `SUMMARY_*` de Cloudflare/Groq precisam existir no **runtime principal que atende `/api/legal/ai`**, além do banco e autenticação já usados pelo site. Configurar apenas o processador Render não disponibiliza automaticamente as credenciais na Vercel. Não é necessário fornecer chaves pelo chat ou expô-las no navegador.

O preview local usa servidor isolado sem banco de produção; a integração completa de autenticação/cotas foi testada com dependências controladas. A IA não transforma esta versão em revisão jurídica universal nem assegura ganho de velocidade ou precisão. O benefício observado no teste real foi organizar fatos expressos com fontes verificáveis.
