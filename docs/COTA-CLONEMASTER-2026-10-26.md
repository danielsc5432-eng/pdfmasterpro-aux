# Cota diária do CloneMaster — 26/10/2026

O fluxo oficial de geração de lotes agora reserva uma tarefa na mesma cota gratuita de dez tarefas por janela de 24 horas usada pelas demais ferramentas. Não há uma cota adicional exclusiva do CloneMaster. Um lote conta como uma tarefa independentemente do número de arquivos gerados, dentro dos limites existentes de 500 resultados e 20 MB de entrada.

A análise, a prévia e os downloads de um lote já gerado não fazem novas reservas. A tentativa é consumida quando o servidor autoriza a geração; falhas ou cancelamentos posteriores não a devolvem. O limite temporário de testes por conta continua sendo respeitado enquanto estiver vigente. Premium, verificado no servidor, não consome a cota gratuita, mas mantém os limites técnicos por lote.

## Implementação

- `POST /api/clonemaster/quota`: endpoint do frontend principal. Não recebe corpo, arquivos, nomes de arquivos, valores de planilhas ou instruções.
- O plano é resolvido pela sessão/assinatura persistida, sem confiar no plano enviado pelo navegador.
- Reutiliza `reserveFreeTask`: conta, navegador com cookie assinado e teto secundário de rede. Novas contas no mesmo navegador não renovam a cota. O contador já existente na área da conta passa a incluir o CloneMaster.
- Exige origem válida; rejeita uso direto no worker Render e conteúdo enviado ao endpoint. Banco indisponível ou IP de produção não verificável não autorizam a geração.
- A interface aguarda autorização antes de chamar o worker de geração. Recusa de cota não disponibiliza ZIP ou arquivos. Bloqueio de clique repetido evita reservas duplicadas na mesma operação. Cancelamento/limpeza abortam a consulta pendente e invalidam resultados atrasados.
- Os modelos e planilhas continuam sendo processados no navegador. Nenhum arquivo é enviado para verificar a cota.

## Limite de segurança

A reserva é persistida no servidor e controla o fluxo oficial da interface, mas o motor de geração permanece no navegador. Um cliente modificado pode executar o código local sem seguir essa interface; não se declara proteção absoluta contra esse desvio. Impedir a execução por clientes modificados exigiria mover a geração efetiva para um serviço controlado no servidor, alterando a arquitetura e o tratamento dos arquivos. Essa mudança não faz parte deste ajuste.

## Verificação

- 222 testes passaram na suíte completa.
- Onze testes do novo controle cobrem a 11ª tentativa, cota compartilhada com outras ferramentas, troca de conta, visitante/cookie, renovação em 24 horas, Premium, plano adulterado, origem inválida, corpo indevido, worker, falha de banco e IP confiável. As consultas de contador são exercitadas em SQLite isolado com as expressões temporais adaptadas; não há acesso ao banco de produção.
- Build de produção local e TypeScript passaram.
- Teste real no Chrome local: resposta 429 simulada não gera downloads; autorização simulada sem corpo permite processar XLSX real e gerar três TXT com bytes conferidos e ZIP válido. Opções alteradas invalidam resultados; cancelamento limpa o lote; cinco larguras sem overflow. Somente o endpoint de cota recebeu POST, sem conteúdo dos arquivos.
- As respostas de cota do teste de navegador foram controladas; não representam consumo de cota no site publicado.

Arquivos principais: `lib/clonemaster/quota.ts`, `app/api/clonemaster/quota/route.ts`, `components/clonemaster/workspace.tsx`, `tests/unit/clonemaster-quota.test.ts`, `scripts/smoke-clonemaster.mjs` e `scripts/smoke-routes.mjs`.

Implementação validada localmente. Nenhuma publicação foi feita nesta etapa.
