# Atendimento guiado

A página `/contato` oferece conversa guiada por regras para conversão, CloneMaster, divergências, conta, assinatura e outros assuntos. Não usa LLM e não simula atendente ao vivo.

O fluxo oferece uma orientação inicial e permite encerrar sem envio. Se necessário, coleta ferramenta, problema, ambiente e tentativas; mostra o resumo, permite corrigir e exige autorização explícita. Dados ficam somente na memória da página até o envio; não há anexos nem armazenamento da conversa no banco. O e-mail encaminhado fica sujeito à retenção da caixa de suporte e do provedor de envio.

## Ativar envio

1. Criar conta Resend e verificar um domínio/remetente de envio. Usar preferencialmente subdomínio de envio para preservar os MX da Cloudflare que recebem o suporte. Não substituir os MX existentes nem criar dois SPF no mesmo nome.
2. Configurar no servidor `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL` (endereço simples verificado) e `SUPPORT_EMAIL=suporte@pdfmasterpro.com.br`. Não inserir chaves no código, no navegador ou no chat.
3. Aplicar a migração aditiva `005_support_limits.sql` pelo fluxo de migração existente. `DATABASE_URL` é obrigatória para o limite compartilhado entre instâncias.
4. Testar um envio com usuário conectado, conferir recebimento e resposta ao e-mail do solicitante. A API confirma aceitação pelo provedor, não entrega na caixa de entrada.
5. Publicar somente após autorização. Sem configuração, o chat informa a indisponibilidade do envio e mantém o contato direto disponível.

## Proteções e limites

Login obrigatório para envio, origem restrita, JSON até 16 KiB lido com limite durante streaming, schema estrito, destinatário fixo do servidor, limite atômico de cinco tentativas por conta/dia, limpeza de contadores após sete dias, chave de idempotência por pedido e conteúdo para repetição segura no provedor. Não registra texto, e-mail ou segredo em logs. O banco guarda somente hash do identificador da conta, data e contador. Tentativas com falha também contam. A mesma conta em duas instâncias compartilha o limite.

Documentação da integração: https://resend.com/docs/api-reference/emails/send-email

Sem credenciais do provedor, testes de transporte usam respostas controladas e não comprovam entrega real. Nenhum serviço é contratado automaticamente.

## Validação local

Build de produção e TypeScript passaram. Os quatro testes de `tests/unit/support-chat.test.ts` verificam schema e consentimento, orientações/resumo, contrato do provedor com falhas e proteção do endpoint (login, origem e envio desconfigurado). `scripts/smoke-support.mjs`, com `SMOKE_BASE_URL=http://localhost:3200`, testa no Chrome a conversa, quatro respostas, revisão, correção, reinício, encerramento sem envio e três larguras de tela. Nenhuma mensagem real foi enviada. A migração e o limite concorrente no Postgres ainda precisam ser verificados em ambiente de homologação com banco; não foram executados no banco de produção.
