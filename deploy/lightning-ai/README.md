# Lightning AI: serviço de revisão em CPU gratuita

## Bloqueio de acesso verificado em 24/10/2026

O cadastro `/sign-up` e o botão **Open app** atualmente redirecionam para o [aviso oficial de incidente de segurança de outubro de 2026](https://lightning.ai/security-incident/). A Lightning informa que a plataforma de Studios permanece inacessível durante a investigação. **Não é possível concluir este cadastro/deploy agora.** Antes de seguir os passos abaixo, confirmar no canal oficial que o acesso foi restaurado. As condições de CPU gratuita descritas na página de preços não comprovam disponibilidade atual do serviço.

Nenhuma conta Lightning, credencial GitHub ou segredo de produção foi conectado por esta implementação. Os arquivos abaixo são uma preparação, não uma integração ativa. A IA existente no navegador e o site continuam independentes desse serviço.

Preparado para **um Studio CPU gratuito** na conta do proprietário. Não provisiona máquinas, não escolhe GPU, não altera assinatura e não contorna o reinício exigido pelo plano. O usuário ainda vai criar a conta; nenhum Studio, modelo ou endpoint Lightning está ativo nesta validação.

A documentação atual anuncia 4 núcleos/16 GB para o Studio CPU gratuito e exige reinício a cada quatro horas. [Preço e condições](https://lightning.ai/pricing/). O tempo de despertar de um Studio pode ultrapassar o orçamento HTTP do site. Durante essas interrupções, o detector mantém as regras e a opção de IA no navegador; não se deve anunciar disponibilidade contínua de revisão generativa.

## 1. Conta e Studio

Criar a conta em https://lightning.ai e selecionar **Free CPU**, mantendo apenas um Studio ativo. Conferir na tela que o recurso escolhido está marcado como gratuito. O script força inferência em CPU, mas não consegue cancelar a cobrança caso alguém tenha escolhido uma máquina paga no painel.

Dentro do terminal **do Studio**, importar o repositório público:

```sh
git clone https://github.com/danielsc5432-eng/pdfmasterpro.git
cd pdfmasterpro
python3 deploy/lightning-ai/manage.py setup
python3 deploy/lightning-ai/manage.py start
```

O `setup` cria um ambiente Python privado, instala PyTorch CPU e as dependências do serviço. Não instala o site Node e não baixa os pesos do modelo. O `start` baixa/carrega o modelo e só então abre a API na porta **8080**. Esses comandos são para a nuvem, não para hospedar no computador do proprietário.

Modelo inicial de validação: `Qwen/Qwen2.5-0.5B-Instruct`, revisão fixa `7ae557604adf67be50417f59c2c2f167def9a775`, [modelo público Apache-2.0 com suporte a português](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct). O tamanho pequeno reduz os recursos necessários; a qualidade e o desempenho ainda precisam ser comprovados por inferência real nesse Studio. Não foi baixado nem executado nos testes locais desta preparação.

O cache dos pesos e o ambiente ficam em `.lightning-ai/`, ignorado pelo Git. A chave de acesso é gerada automaticamente, preservada entre inicializações e guardada em `.lightning-ai/review.key`, com permissões privadas no Linux. Também é possível fornecer `REVIEW_API_KEY` como segredo privado do Studio (32–200 caracteres URL-safe). Não colocar a chave em argumentos de comando, README, commits, screenshots ou chat.

## 2. Testar antes de conectar

Em um segundo terminal do Studio, com o serviço já iniciado:

```sh
python3 deploy/lightning-ai/manage.py check
```

Esse comando exige modelo carregado, recusa acesso sem chave e faz **inferência real com textos fictícios**. Recusa saída inválida, referências inventadas, resposta vazia sem o achado sintético ou execução acima do prazo HTTP. Se falhar, não conectar o serviço ao site; verificar modelo/desempenho primeiro.

## 3. Expor a porta

No Studio, usar **API Builder/Ports** para encaminhar o serviço da porta **8080** para uma URL HTTPS pública. A API do aplicativo já exige Bearer em `/v1/review`; `/health` expõe apenas prontidão. Não publicar os arquivos de `.lightning-ai/` como site estático. Uma camada de login/Basic Auth adicional do gateway pode impedir a conexão do Render, pois a API usa seu próprio Bearer; verificar o acesso direto antes da ativação.

Pode-se habilitar o despertar automático oferecido pelo próprio Lightning. Não criar tarefas de ping ou reinício para contornar os limites gratuitos. [Portas públicas e API Builder](https://lightning.ai/docs/platform/build/ai-studio/deploy-on-public-ports/).

Substituindo `https://sua-api.example` pela URL que o painel mostrar:

```sh
python3 deploy/lightning-ai/manage.py check https://sua-api.example
python3 deploy/lightning-ai/manage.py render-config https://sua-api.example
```

Redirecionamentos, URL com senha/query e HTTP remoto são recusados. O último comando só grava a configuração após um teste completo bem-sucedido, no arquivo privado `.lightning-ai/render.env`, sem exibir a chave.

## 4. Conectar o worker Render

Copiar os quatro valores de `.lightning-ai/render.env` **diretamente para os segredos do serviço Render**, sem enviá-los no chat:

```dotenv
DIVERGENCE_AI_PROVIDER=transformers
DIVERGENCE_TRANSFORMERS_URL=https://sua-api.example
DIVERGENCE_TRANSFORMERS_MODEL=Qwen/Qwen2.5-0.5B-Instruct
DIVERGENCE_TRANSFORMERS_KEY=<chave-privada-do-Studio>
```

Fazer redeploy do worker e testar, no site, dois PDFs fictícios com cláusulas diferentes e a opção de revisão no servidor autorizada. Só registrar a integração como ativa depois desse teste. Não é preciso alterar credenciais de cobrança, OAuth ou converter no mesmo serviço Lightning.

Para iniciar novamente após um reinício permitido pelo provedor, executar `python3 deploy/lightning-ai/manage.py start` na pasta do repositório. Se o painel oferecer ações de início, pode-se cadastrar esse comando conforme a documentação da própria conta. Isso inicia o aplicativo quando o Studio inicia; não elimina a exigência de reiniciar o recurso gratuito.

## Validação desta preparação

`python scripts/test-lightning-ai.py`: seis testes sem instalação de modelos — segredo privado/idempotente, revisão fixa, URLs, instalação CPU, prontidão/autenticação/IDs, exportação privada e recusa de redirects/execução de setup no Windows. O fluxo HTTP usa transporte simulado. `scripts/test-semantic-ai.py` cobre separadamente o contrato FastAPI. Esses testes não substituem os comandos `check` com pesos reais no Studio.
