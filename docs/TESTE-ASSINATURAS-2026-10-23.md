# Validação da assinatura e do Premium — 23/10/2026

O usuário solicitou testar a aprovação e a liberação automática do Premium. Ele informou que ainda não possui uma aplicação/usuário de teste do Mercado Pago. As credenciais de teste também não estão disponíveis nos arquivos locais. Por isso, a compra no provedor não foi executada.

## Teste integrado executado

O teste chama os handlers reais do webhook, de `/api/billing/me` e de `/api/v1/process`, usando sessão assinada, verificação HMAC e os módulos reais de persistência e permissões. Os limites externos são substituídos: as respostas do Mercado Pago são fixtures controladas, e o transporte HTTP do driver Neon executa o SQL em SQLite em memória, criado a partir da migração de cobrança. Chamadas de rede inesperadas são bloqueadas. Não há pagamentos, contas externas, credenciais reais ou gravação em produção.

Foram aprovados 14 cenários:

1. Assinatura pendente mantém o plano grátis.
2. Aprovação mensal persiste a alteração, retorna Premium e passa pelo bloqueio da ferramenta OCR.
3. Assinatura HMAC inválida não consulta o provedor nem ativa o acesso.
4. Aprovação anual seleciona o plano anual.
5. O benefício fica restrito à conta compradora.
6. Pausa remove o acesso.
7. Cancelamento remove o acesso.
8. Assinatura finalizada remove o acesso.
9. Pagamento aprovado concede o período correto, sem extensão por reenvio do mesmo evento.
10. Pagamento recusado mantém o plano grátis.
11. Valor incorreto não concede Premium.
12. Moeda incorreta não concede Premium.
13. Falha na consulta ao provedor responde 503, permitindo nova tentativa.
14. Falha ao gravar a ativação responde 503 e não confirma sucesso.

O teste da ferramenta OCR verifica o controle de acesso: antes da aprovação, a requisição retorna 402; depois, alcança a validação de arquivo e retorna 400 por estar sem arquivo. Não é um novo teste de reconhecimento de texto.

## Erros encontrados e corrigidos localmente

- Um pagamento aprovado com valor incompatível podia conceder Premium. Agora são conferidos valor, moeda e vínculo com a conta.
- O prazo de compra avulsa era calculado a partir do recebimento do webhook e podia aumentar a cada reenvio. Agora usa a data de aprovação informada pelo provedor e conserva o período já concedido ao mesmo pagamento.
- Falhas de gravação eram absorvidas, e o webhook também respondia 200 a falhas de sincronização. As operações de escrita agora propagam falhas, e o handler responde 503 para possibilitar reenvio.
- O cálculo de mês podia saltar fevereiro para aprovações no dia 31. O prazo agora limita o dia ao último dia do mês de destino, em UTC.
- Pagamentos estornados ou com chargeback revogam o registro correspondente. Essa alteração foi implementada, mas não faz parte dos 14 cenários integrados acima.

Foram aprovados os 70 testes reportados pela suíte completa (incluindo o teste agrupador da integração), a checagem TypeScript e o build de produção. Os dois novos testes unitários de prazo cobrem fim de mês, ano bissexto e período anual.

## Reproduzir

```powershell
pnpm.cmd test:billing
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd build
```

A execução foi feita com Node.js 24. O teste integrado utiliza `node:sqlite`, banco descartável em memória, sem instalar um serviço de banco.

## Validação posterior com contas reais de teste do Mercado Pago

O checkout foi criado com credenciais de vendedor brasileiro identificado pela API como `test_user`. O usuário concluiu o checkout com o comprador de teste. A consulta ao provedor confirmou a assinatura `6c0b6b21ec904049b73db48d291eb2c7` como `authorized`.

Após envio pelo simulador oficial de um webhook assinado com o ID dessa assinatura, o receptor respondeu 200. A consulta independente `pnpm.cmd billing:sandbox status` confirmou `providerStatus: authorized`, `localPlan: premium-monthly` e `premiumTools: true`. A persistência ocorreu exclusivamente no SQLite isolado de teste. O recebimento automático de eventos futuros, sem simulação manual, ainda precisa ser validado.

Foi corrigida a seleção de evento: o tipo declarado no corpo JSON tem prioridade sobre o tipo divergente da URL, preservando validação HMAC do recurso e consulta de valor, moeda e titularidade no provedor. O teste de regressão cobre a divergência e a rejeição de assinatura inválida. A suíte de cobrança passou com 16 testes reportados, incluindo o agrupador.

Após autorização do usuário, as correções foram publicadas na Vercel no deployment `dpl_78xbmxokZoob2k2nSe1nKaDDWZos`. As 45 verificações de rotas públicas passaram. A conta e o banco isolados usados neste teste não foram transferidos para produção; não foi concedido Premium de teste no site publicado. O worker separado ainda não foi atualizado.

## Limitações da validação inicial com fixtures

Este resultado valida a lógica local da aplicação com dependências externas controladas. Não certifica o transporte real do Mercado Pago, o checkout no navegador, a autorização real de cartão, o banco PostgreSQL de produção, a concorrência entre notificações ou a liberação no site publicado.

Para o teste completo, é necessário configurar o ambiente de testes do Mercado Pago, usando as contas e credenciais adequadas, e concluir uma compra com cartão de teste. O procedimento oficial está em https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/integration-test/test-purchases?scope=prod e https://www.mercadopago.com.br/developers/en/docs/automatic-payments/Integration-test. As credenciais devem ser configuradas diretamente no ambiente de teste, sem envio pelo chat, e sem substituir as credenciais de produção.

As correções desta etapa estão no projeto local. Não houve deploy nem alteração de assinaturas reais nesta validação. O teste anterior enviado pelo usuário pelo simulador, com HTTP 200 e ID `123456`, continua sendo evidência de recepção/assinatura do webhook, não de uma compra aprovada.
