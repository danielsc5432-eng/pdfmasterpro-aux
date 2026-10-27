# Proteção contra múltiplas contas gratuitas

## Política implementada

- A cota de processamento gratuito deixa de depender apenas do cookie de histórico. A conta e o navegador têm contadores persistentes e separados. Sair ou alternar de conta no mesmo navegador não renova a cota. A mesma conta em outro navegador mantém seu contador.
- Um identificador aleatório de navegador é assinado pelo servidor e armazenado em cookie HttpOnly por até 180 dias. Não há leitura de canvas, fontes, tela, biometria ou fingerprint invasivo. O logout preserva esse cookie de segurança e remove somente login e histórico.
- São dez tentativas admitidas por conta/navegador em janelas de 24 horas iniciadas pelo primeiro uso; a configuração temporária de testes existente continua válida. Tentativas com arquivo inválido ou falha de processamento também podem consumir cota. Como os limites são reservados por dimensão, uma dimensão pode consumir tentativa antes de outra bloquear o pedido. O controle é conservador, sem liberação excedente sob concorrência.
- O IP de origem fornecido pela Vercel é apenas um sinal secundário, com teto de 100 tentativas gratuitas por conexão em 24 horas (ou dez vezes a cota temporária). Não representa uma pessoa. No máximo três tentativas de cadastro por navegador e vinte por conexão em 24 horas, além dos limites anteriores por e-mail/hora. Atingir limite não apaga nem bane contas; login de conta existente continua disponível. Respostas de erro apontam para o suporte.
- Novas identidades Gmail equivalentes por pontos, sufixo + e domínio googlemail são impedidas, tanto no cadastro local quanto em Google/Manus. Outros provedores mantêm seus pontos e sufixos. Cadastro local exige o código de confirmação existente. Não se mesclam contas nem se adiciona senha a uma conta de outro provedor.
- A migração `007_abuse_protection.sql` preserva todas as contas existentes, registra uma identidade canônica por endereço equivalente e cria os contadores. Duplicatas históricas permanecem acessíveis, mas passam a compartilhar a cota canônica. Não realiza cancelamento ou alteração de assinatura.
- Premium não consome esses limites gratuitos. Pedidos com assinatura de plano verificada no worker não são contados duas vezes. Acesso gratuito direto ao worker sem banco/assinatura falha fechado em produção, impedindo desvio do proxy que aplica a cota.
- A imagem Docker destinada ao worker define `PROCESSING_WORKER_ONLY=1`, recusando qualquer tarefa sem assinatura do frontend mesmo se um banco for configurado no worker futuramente. Uma instalação standalone deliberada com banco pode substituir essa variável por `0`, assumindo a verificação local de cota. Não habilitar o modo worker na Vercel.
- Falha de banco ou chave no ambiente de produção não libera processamento gratuito ilimitado. Não se confia em cabeçalhos IP fornecidos por clientes fora do ambiente Vercel.

## Dados e implantação

Contadores armazenam somente HMAC de conta/navegador/rede, início da janela e número de tentativas. O endereço IP não é persistido em texto pela proteção. A tabela de identidade usa o e-mail normalizado, dado já existente na conta. Contadores inativos há mais de sete dias são removidos nas próximas operações de processamento/cadastro; não há promessa de exclusão cronológica durante inatividade total do serviço. A validade da cota é de 24 horas, independente da limpeza.

Usa `AUTH_SESSION_SECRET`, `MANUS_JWT_SECRET` ou `BILLING_SIGNING_SECRET` existentes; `ANTI_ABUSE_SECRET` pode separar essa finalidade. Mudar a chave invalida cookies e hashes antigos: coordenar rotações. O IP só é confiado quando `VERCEL=1` e vem de `x-vercel-forwarded-for`. Fora da Vercel, conta e navegador ainda são protegidos quando o banco está disponível; não inventamos identidade de rede a partir de cabeçalho arbitrário.

A política começa a contar quando implantada; o histórico antigo não permite atribuir todas as tarefas a uma conta com segurança. CloneMaster, por executar inteiramente no navegador sem processamento custoso no servidor, não recebe uma cota fictícia que possa ser burlada alterando JavaScript.

## Testes

- `tests/unit/abuse.test.ts`: normalização restrita a Gmail, assinatura/expiração/adulteração do cookie, IP confiável e logout.
- `scripts/test-abuse-db.ts`: PostgreSQL embarcado PGlite isolado, migração com duplicatas históricas, contas Google existentes, aliases simultâneos, provedores corporativos distintos, cota por conta/navegador/Gmail, 30 pedidos concorrentes para dez vagas, rede compartilhada, teto de rede, renovação, limpeza e handlers reais de processamento com banco indisponível e worker assinado/não assinado. Instalação opcional PGlite na pasta ignorada `.vercel/tools/auth-tests`, como no teste de cadastro.
- Testes de cadastro e área da conta foram mantidos e atualizados para cota da conta em vez da sessão.
- Validação concluída localmente: 186 testes passaram, sem falhas ou testes ignorados; build e TypeScript passaram. `scripts/smoke-abuse.mjs` confirmou no Chrome o cookie HttpOnly, sua preservação após logout válido, substituição de token adulterado e bloqueio sem banco. Para esse teste, compilar com `NEXT_PUBLIC_SITE_URL=http://localhost:3400`, executar o servidor local com segredo isolado e usar `SMOKE_BASE_URL=http://localhost:3400`. A origem pública do Next precisa corresponder ao navegador para testar POST reais. Nenhum usuário real, documento ou assinatura de produção foi alterado.

## Limitações

Não é possível provar identidade civil usando apenas e-mail, cookie e rede. Apagar cookies, usar outro endereço e outra conexão ainda pode contornar esses sinais em conjunto. Um bloqueio de uma pessoa por CPF ou telefone exigiria verificação adicional real e avaliação de privacidade/custo. Nenhuma identidade ou documento pessoal é solicitado nesta etapa. CAPTCHA/Turnstile não é anunciado como ativo nem substituído por validação fictícia.

Fontes: https://support.google.com/mail/answer/7436150 e https://gmail.googleblog.com/2008/03/2-hidden-ways-to-get-more-from-your.html; cabeçalhos: https://vercel.com/docs/headers/request-headers.

Não publicar sem autorização do usuário.
