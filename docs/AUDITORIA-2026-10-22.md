# Auditoria local — 22/10/2026

Foram revisados os processadores, o fluxo de upload e download, as páginas públicas e as proteções de acesso. Os testes usaram arquivos sintéticos e um servidor de produção local em `127.0.0.1:3100`, com banco e worker externos desativados. Nenhum pagamento foi criado e nenhum documento pessoal foi utilizado.

## Resultado observado

- 49/49 testes unitários aprovados.
- 27/27 verificações de processamento e validação aprovadas, abrangendo as 17 ferramentas.
- 45/45 verificações HTTP aprovadas, incluindo páginas, busca sem resultados, erros de entrada, autenticação e bloqueios Premium.
- 12 verificações de interface aprovadas no Chrome headless: transferência da seleção inicial, reordenação, resultado baixável, substituição e remoção de arquivos, limite de quantidade, bloqueios Premium, preços, tema, layout móvel e ausência de exceções JavaScript não tratadas.
- TypeScript e build de produção aprovados com Next.js 16.4.2.

Esses resultados demonstram o funcionamento dos cenários executados. Não representam garantia de compatibilidade com todo documento ou de funcionamento integral dos serviços externos em produção.

## Ferramentas exercitadas pela API

| Ferramenta | Verificação executada |
| --- | --- |
| Juntar PDF | Dois documentos combinados e resultado aberto como PDF |
| Dividir PDF | Intervalo e ZIP com páginas individuais |
| Imagens para PDF | PNG e JPEG, com opções de tamanho e margem |
| PDF para imagens | Intervalo renderizado em ZIP de imagens |
| Girar PDF | Rotação adicionada à orientação existente |
| Organizar PDF | Nova sequência de páginas aceita e resultado aberto |
| Comprimir PDF | Documento válido, mesma quantidade de páginas e tamanho nunca superior ao original |
| PDF para Word | DOCX com texto, estrutura de páginas e estilos; motor Microsoft Word disponível localmente |
| Word para PDF | DOCX convertido em PDF válido |
| OCR | Imagem e PDF digitalizado convertidos em PDFs; idiomas português e inglês |
| Extrair texto | Texto esperado presente no TXT |
| Marca d'água | PDF processado com opções de texto, cor e posição |
| Numerar páginas | PDF processado com opções de numeração |
| Assinar PDF | Assinatura visual e PDF válido |
| Proteger PDF | Resultado criptografado; servidor verifica abertura com a senha pelo qpdf |
| Editar metadados | Título persiste após reabrir o resultado |
| Redigir PDF | Página específica rasterizada; PDF girado mantém as dimensões visuais |

Os testes de alguns processadores verificam a estrutura do arquivo gerado, sem comparação visual pixel a pixel. A conversão Word foi exercitada com documento simples; a fidelidade de layouts complexos e a precisão do texto do OCR exigem amostras adicionais.

## Correções aplicadas

1. Corrigida a ordem vertical invertida na reconstrução de PDF para Word, que causava quatro falhas na suíte existente.
2. Arquivos selecionados na página inicial agora são preservados em memória ao navegar para a ferramenta apropriada. A seleção não grava os documentos em armazenamento persistente.
3. Ferramentas de arquivo único substituem a seleção anterior. Formatos, arquivos vazios, tamanhos e excesso de arquivos recebem validação no navegador; o servidor continua validando o conteúdo real.
4. Permitida a seleção do mesmo arquivo após sua remoção. Reordenação e remoção ficam bloqueadas durante o processamento, e URLs temporárias de download são liberadas.
5. Falha ao consultar o plano deixa de manter indefinidamente a tela de carregamento; o acesso continua sujeito à validação do servidor.
6. Removida a oferta de WEBP e de formatos de planilha/apresentação na seleção inicial, pois esses formatos não possuem conversor funcional nesta versão.
7. Numeração passa a substituir todas as ocorrências de `{n}` e `{total}`.
8. Compressão valida a saída e conserva o original quando o Ghostscript produz um arquivo maior. No arquivo sintético, a saída do compressor era maior; o resultado final agora permanece em 1.507 bytes.
9. Redação rasterizada considera a orientação visual de páginas giradas em 90° ou 270°, evitando distorção ao reconstruir a página.
10. Ferramentas desconhecidas recebem HTTP 404 antes de iniciar processamento. O proxy lê o tamanho da saída antes de remover o cabeçalho correspondente.
11. Webhook de pagamentos recusa chamadas quando não há segredo de assinatura configurado. Assinaturas malformadas são rejeitadas antes da comparação criptográfica, inclusive no cabeçalho de plano.
12. Comando de produção compatível com Windows, preservando o suporte à variável `PORT` pelo próprio Next.js.
13. Sincronizadas as dependências locais com o lockfile: Next.js instalado passou de 16.4.0 para 16.4.2. O alerta de vulnerabilidade que interrompia o primeiro build deixou de aparecer após a sincronização. Isso não substitui uma auditoria completa das dependências.

## Serviços externos e limites da verificação

- Login Google/Manus: verificadas as páginas e a rejeição de acesso anônimo; o login com uma conta real e o retorno do provedor não foram executados.
- Banco e histórico persistente: desativados no servidor de auditoria para não gravar dados no banco configurado. Persistência, disponibilidade e isolamento de registros em produção não foram certificados.
- Mercado Pago: verificadas validações locais, bloqueio sem autenticação e assinatura do webhook. Checkout, Pix, renovação, cancelamento, duplicação/reenvio de notificações e conciliação precisam de testes de integração com uma conta de testes do provedor.
- Validação adicional em 23/10/2026: 14 cenários locais integraram os handlers reais de webhook, plano e acesso Premium, com respostas controladas do Mercado Pago e banco SQL descartável em memória. Aprovação mensal/anual, recusa, revogação, isolamento entre contas, valor/moeda e falhas de sincronização foram exercitados; bugs de valor pago, prazo por reenvio e confirmação indevida de gravação foram corrigidos localmente. A suíte completa passou com 70 testes reportados, TypeScript e build aprovados. A compra real no ambiente de testes do Mercado Pago permanece pendente: o usuário informou que ainda não possui a conta de teste. Detalhes e limites estão em `TESTE-ASSINATURAS-2026-10-23.md`; não houve novo deploy nesta etapa.
- Atualização em 23/10/2026: `MERCADOPAGO_WEBHOOK_SECRET` está cadastrada como segredo na Vercel para Production e Preview. O teste com assinatura inválida respondeu HTTP 401. Em seguida, o usuário executou uma simulação oficial pelo painel do Mercado Pago e informou sucesso com HTTP 200 para `subscription_preapproval`, ação `updated`, com `data.id=123456`. Pelo fluxo do endpoint publicado, HTTP 200 ocorre após a verificação da assinatura: o resultado informado confirma a aceitação da chave para essa notificação. A evidência positiva foi fornecida pelo usuário, sem inspeção independente dos logs dessa requisição. O valor do segredo não foi exposto nem alterado e não está configurado nos arquivos locais de desenvolvimento. Como o identificador é de simulação e o handler também responde 200 quando a consulta/sincronização do recurso falha, esse teste não comprova persistência de uma assinatura nem ativação do Premium. Checkout, pagamento aprovado e liberação de acesso continuam pendentes de teste integrado.
- Worker remoto, hospedagem, domínio, TLS, anúncios e e-mail de suporte não foram testados de ponta a ponta.
- Não foram executados testes de carga, arquivos de centenas de páginas, PDFs adversariais, todas as combinações de rotação/crop box, ou uma matriz de navegadores.
- Assinatura continua sendo visual, sem certificação criptográfica. OCR e conversões de Word podem alterar ou interpretar incorretamente conteúdo e layout.
- O limite diário depende da persistência; sem banco, a contagem retorna zero. Não usar a execução isolada desta auditoria como configuração de produção.

## Reproduzir os testes

Na pasta do projeto, execute `pnpm.cmd test`, `pnpm.cmd typecheck` e `pnpm.cmd build`. O sufixo `.cmd` evita a restrição de execução de scripts PowerShell do Windows.

Para iniciar um servidor local isolado, em um terminal PowerShell:

```powershell
$env:DATABASE_URL=' '
$env:PROCESSING_WORKER_URL=' '
$env:BILLING_SIGNING_SECRET='local-audit-isolated-only'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
```

Em outro terminal, execute:

```powershell
$env:SMOKE_BASE_URL='http://localhost:3100'
$env:SMOKE_PREMIUM='1'
$env:BILLING_SIGNING_SECRET='local-audit-isolated-only'
pnpm.cmd test:tools
pnpm.cmd test:routes
pnpm.cmd test:ui
```

A chave acima é exclusiva do servidor local descartável e não deve ser usada em produção. O teste Premium usa cabeçalhos assinados aceitos pelo fluxo existente de worker; não altera as regras de acesso da aplicação. Sem `SMOKE_PREMIUM=1`, o script verifica o bloqueio dessas ferramentas para convidados.

`test:tools` depende dos motores nativos configurados e gera a imagem de teste com PowerShell/System.Drawing no Windows. `test:ui` usa Chrome ou Edge instalado; outro Chromium pode ser apontado por `SMOKE_BROWSER`. Os artefatos temporários são removidos ao terminar.
