# Cadastro direto com e-mail e senha

As páginas `/criar-conta` e `/entrar` permitem autenticação direta, além da opção Google. O cadastro pede nome completo, e-mail, senha de 12 a 128 caracteres, confirmação da senha e aceite dos termos. Não exige CPF, telefone ou endereço.

## Funcionamento

O cadastro cria uma entrada pendente separada dos usuários ativos e envia código de seis dígitos pelo Resend já configurado. O código expira em 20 minutos e admite dez tentativas. Só após confirmação o usuário é criado na tabela `users`, identificado por `local:UUID`, e recebe os cookies de sessão existentes do projeto. O login usa o mesmo painel, perfil, histórico, assinatura e atendimento.

Senhas são derivadas com scrypt nativo do Node, sal aleatório de 24 bytes e parâmetros N=32768, r=8, p=3. O código é armazenado como HMAC vinculado ao e-mail; não é gravado em texto. Não há log de senha/código. Há validação estrita, origem obrigatória, corpo limitado durante leitura, consulta parametrizada, limites persistentes por e-mail e IP e comparação de senha equivalente para conta inexistente.

Não se adiciona senha a uma conta Google/Manus existente com base apenas no e-mail. O usuário que já entrou via Google deve continuar com Google. E-mails são normalizados para minúsculas. Google continua separado e disponível.

## Implantação

- Migração aditiva `006_local_accounts.sql` pelo mecanismo de migração existente.
- Usa `DATABASE_URL`, `AUTH_SESSION_SECRET` (ou o segredo Manus configurado), `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL` e `NEXT_PUBLIC_SITE_URL` do servidor.
- Sem dependência de runtime nova. Código de confirmação usa o domínio Resend já verificado. A entrega a endereços reais deve ser testada após publicação autorizada.
- O cadastro e o login são funcionais; recuperação/troca de senha de contas locais ainda não fazem parte desta etapa. Não anunciar recuperação automática disponível. Sessão segue validade existente de sete dias.

## Testes

`tests/unit/local-auth.test.ts`: derivação e comparação de senha, validação e consentimento, vínculo do código ao endereço, rejeição de origem e indisponibilidade do servidor.

`scripts/test-local-auth-db.ts`: PostgreSQL isolado com PGlite instalado somente na pasta ignorada `.vercel/tools/auth-tests` (ou `PGLITE_MODULE` apontando à instalação). Executa as migrações e as consultas reais: cadastro pendente, bloqueio antes de confirmar, ativação, login correto/incorreto, código consumido/expirado, dez erros, impossibilidade de sobrescrever senha ou assumir conta Google e limite atômico sob tentativas concorrentes. Nenhum banco de produção ou e-mail real é usado nesses testes.

Build de produção e TypeScript passaram. `scripts/smoke-local-auth.mjs`, com `SMOKE_BASE_URL=http://localhost:3300`, valida no Chrome os campos, senhas divergentes, tela de confirmação, erro de código, correção, formulário de login e três larguras (390, 768 e 1440). Esse teste de interface usa respostas de API controladas; não comprova envio real de código nem login integrado ao banco de produção. Nenhuma conta real foi criada e nenhuma publicação foi realizada nesta etapa.

Fontes: https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback e https://resend.com/docs/api-reference/emails/send-email.
