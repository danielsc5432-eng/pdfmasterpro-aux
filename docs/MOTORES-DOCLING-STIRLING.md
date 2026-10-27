# Integração Docling e Stirling-PDF

## Estado

Adaptadores implementados; serviços reais ainda não instalados, ativados ou testados ponta a ponta. Os 85 testes automatizados passam, incluindo contratos HTTP simulados, reconstrução editável de tabela com valor financeiro, respostas parciais e arquivo inválido. TypeScript validado. Isso não comprova a qualidade dos motores reais nos PDFs do usuário.

## Fluxo automático

O fluxo mantém os motores existentes. Se a primeira conversão não atingir a fidelidade exigida, consulta os serviços configurados, respeitando o orçamento restante de 260 segundos. Cada candidato passa pela comparação de conteúdo, números, páginas e renderização. Um candidato externo sem avaliação não substitui o atual. Falhas opcionais mantêm o processamento local. Nenhum seletor novo é mostrado ao usuário.

Docling: POST `/v1/convert/file`, arquivo `files`, JSON estruturado, OCR habilitado, tabelas em modo accurate. Reconstrói parágrafos e tabelas editáveis pela ordem do corpo. Não oferece reprodução visual idêntica: ainda não reconstrói imagens, fontes e geometria completa nem mesclagens de células. A comparação pode rejeitá-lo ou preferir outro motor.

Stirling: POST `/api/v1/convert/pdf/word`, arquivo `fileInput`, `outputFormat=docx`. Exige uma imagem completa com conversão Office disponível. Não equivale a um motor independente de LibreOffice em todas as versões.

## Configuração do worker de processamento

Definir somente após hospedar serviços próprios e validar suas versões:

```dotenv
DOCLING_URL=https://seu-servico-docling
DOCLING_API_KEY=chave-privada
STIRLING_PDF_URL=https://seu-servico-stirling
STIRLING_PDF_API_KEY=outra-chave-privada
```

URLs são bases, sem a rota de conversão. Não configurar URLs de demonstração pública. Os PDFs serão enviados aos endereços configurados. Chaves ficam no servidor e nunca usam prefixo NEXT_PUBLIC. Redirecionamentos são recusados e respostas limitadas a 64 MiB. A política de retenção do servidor remoto deve ser configurada na implantação dele.

Sem essas variáveis, o comportamento atual continua funcionando. Remover a URL desativa o respectivo motor.

## Hospedagem preparada

`compose.engines.yaml` prepara serviços separados, portas restritas ao localhost e autenticação. Não foi executado: Docker não está disponível nesta máquina. Informar `DOCLING_IMAGE` e `STIRLING_IMAGE` com tags de versões verificadas (não latest), além das duas chaves, em arquivo local ignorado. Rodar:

```sh
docker compose --env-file .env.engines -f compose.engines.yaml config --quiet
docker compose --env-file .env.engines -f compose.engines.yaml up -d
```

As reservas de 4 GiB para Docling e 2 GiB para Stirling são um ponto inicial de teste, não requisitos mínimos comprovados. O serviço Render atual é gratuito; não foi criado recurso pago nem alterado seu plano. Um worker remoto não consegue acessar localhost desta máquina: precisa de rede privada compartilhada ou HTTPS autenticado. Para ativar em produção faltam escolher a hospedagem, iniciar os dois serviços, conferir seus OpenAPI reais e converter os PDFs de referência por cada motor.

## Referências

- https://docling-project.github.io/docling/usage/api_server/rest_api/
- https://docling-project.github.io/docling/usage/api_server/deployment/
- https://docs.stirlingpdf.com/Developers/API/
- https://docs.stirlingpdf.com/Server/Install/Docker/
