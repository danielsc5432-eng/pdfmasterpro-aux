# Ativar suporte@pdfmasterpro.com.br

## Situação verificada em 24/10/2026

Consulta pública: servidores DNS `e.sec.dns.br` e `f.sec.dns.br` (Registro.br). Nenhum registro MX foi retornado. Isso não comprova que exista uma caixa postal. Não há sessão autenticada de administração do Registro.br ou Zoho Mail disponível ao agente.

O endereço anterior `suporte@pdfmasterpro.app` era provisório e foi retirado do rodapé/contato após o proprietário informar que ainda precisa criar a caixa. O domínio desejado é `pdfmasterpro.com.br`.

## Opção gratuita pesquisada

[Zoho Mail — planos oficiais](https://www.zoho.com/mail/zohomail-pricing.html): Mail Free para um domínio, até cinco usuários, 5 GB por usuário, sem IMAP/POP/ActiveSync. Disponível somente em algumas regiões; confirme a oferta exibida no cadastro. Não iniciar avaliação paga ou informar cartão para cumprir esta configuração gratuita.

1. O proprietário cria/acessa a conta no Zoho Mail e adiciona o domínio já existente `pdfmasterpro.com.br`.
2. Copiar o registro **TXT de verificação específico da conta**, seguindo o [guia oficial](https://www.zoho.com/mail/help/adminconsole/domain-verification.html). No Registro.br, adicionar o registro na zona DNS atual e verificar a propriedade pelo Zoho. Não trocar os servidores DNS nem alterar os registros A/CNAME usados pelo site.
3. Criar o usuário/caixa `suporte`. Adicionar os registros MX, SPF e DKIM **exatamente como fornecidos no painel da conta**, pois os destinos dependem da região. Não criar múltiplos registros SPF; um SPF existente precisa ser consolidado. Registrar DMARC conforme o serviço e a política escolhida.
4. Confirmar propagação dos registros e testar recebimento e resposta pelo webmail com um endereço externo. Configuração DNS por si só não comprova entrega; a caixa precisa existir e aceitar mensagens.
5. Somente após o recebimento confirmado, configurar `SUPPORT_EMAIL=suporte@pdfmasterpro.com.br` no ambiente de produção da Vercel e redeploy. A página `/contato` valida o endereço e exibe o link `mailto:`. No Render, configurar também caso a página de contato desse serviço seja usada diretamente. Isso apenas publica o contato; não cria uma caixa postal nem envia e-mails pela aplicação.

Não colocar senhas, códigos de login, tokens de conta ou chave privada DKIM no repositório/chat. Os valores públicos TXT/MX/SPF e a chave **pública** DKIM podem ser usados para orientar o preenchimento do DNS.
