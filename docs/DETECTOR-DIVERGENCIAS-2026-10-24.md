# Detector de divergências e IA opcional

Implementação em `/ferramentas/detector-divergencias`, usando o catálogo, o endpoint `/api/v1/process`, as cotas, autenticação e proxy assinado existentes. Não altera cobrança nem concede Premium. O backend nativo exige o mesmo Python/PyMuPDF do conversor.

## Comportamento comprovável e limites

Compara 2–5 PDFs com campos rotulados, datas, valores, identificadores e cláusulas. Valores são normalizados sem ponto flutuante e preservando moeda, sinal e zeros de identificadores. Períodos/contratos incompatíveis e rótulos repetidos não são alinhados automaticamente. Cada evidência inclui documento, página, linha, coordenadas e trecho real; uma conferência bloqueia evidências inventadas.

Não é uma comparação universal: texto livre sem padrão reconhecido, tabelas ambíguas, sinônimos de campos e layouts difíceis podem exigir revisão. A solicitação personalizada filtra rótulos por palavras, sem interpretação arbitrária de linguagem natural. Páginas digitalizadas ou com camada OCR não verificável são marcadas como parciais; esta ferramenta ainda não executa OCR. Não se conclui ausência a partir delas. PDFs protegidos e corrompidos são recusados. Documentos duplicados são sinalizados.

Backend: 10 MiB/arquivo, 25 MiB/conjunto, 20 páginas/arquivo, 60 páginas/conjunto, 100 mil caracteres e 2 mil linhas/arquivo, 200 achados, orçamento global de 120 segundos. Interface: limite combinado padrão de 4 MiB, deixando margem para multipart no ingresso serverless; `NEXT_PUBLIC_DIVERGENCE_UPLOAD_MB` pode ser elevado em outro host. Quotas normais continuam aplicadas. Cancelamento é encaminhado ao worker e ao subprocesso; o encerramento pode levar o tempo necessário para sua limpeza.

Filtros não alteram os achados originais. Revisão humana e observações são separadas das evidências. O relatório PDF inclui todos os achados, fontes, avisos e revisões, sem nova chamada à IA. Fonte Noto Sans local, sob SIL OFL (`public/fonts/OFL-Noto.txt`), obtida de notofonts/noto-fonts no commit `ffebf8c1ee449e544955a7e813c54f9b73848eac`. Caracteres ausentes da fonte causam mensagem explícita; o JSON preserva o conteúdo integral. Não há afirmação de precisão de 100%, fraude ou diagnóstico jurídico.

## OpenCode v2

O OpenCode é um agente/servidor, não um modelo. Integração HTTP conforme o [contrato oficial](https://opencode.ai/v2/docs/api), usando apenas `POST /api/experimental/generate` com `{prompt,model:{providerID,id}}`, resposta `{data:{text}}`. A API é experimental: versões incompatíveis retornam fallback, sem recorrer a sessões, terminal ou ferramentas. Não se usa o CLI local para analisar PDFs e não se inicia servidor automaticamente.

Configuração **somente no worker**, através de variáveis secretas do provedor:

```dotenv
DIVERGENCE_AI_PROVIDER=opencode
DIVERGENCE_OPENCODE_URL=https://seu-servidor-opencode.example
DIVERGENCE_OPENCODE_PROVIDER=identificador-do-provedor
DIVERGENCE_OPENCODE_MODEL=identificador-do-modelo
# Opcional: valor completo do Authorization exigido pelo gateway/servidor
DIVERGENCE_OPENCODE_AUTHORIZATION=
```

É obrigatório escolher explicitamente um modelo, evitando acionar o padrão do servidor inadvertidamente. Isso não garante gratuidade: o operador deve escolher um modelo sem cobrança e observar as condições do fornecedor. Nada foi contratado. O usuário informou que **ainda não possui servidor OpenCode hospedado**; portanto a integração não está ativada em produção nem foi comprovada uma inferência real. Testes usam um transporte simulado aderente ao contrato público. A instalação local não substitui o serviço de produção. Não enviar credenciais pelo chat.

Alternativa já suportada: `DIVERGENCE_AI_PROVIDER=ollama`, `DIVERGENCE_OLLAMA_URL`, `DIVERGENCE_OLLAMA_MODEL`, `DIVERGENCE_AI_KEY` opcional. Não há troca automática entre fornecedores.

IA só após consentimento explícito no envio da tarefa. Recebe até 10 pares de trechos de cláusulas, até 450 caracteres/trecho, sem arquivos, nomes de arquivos ou outros achados. Identificadores/valores que estejam dentro dos trechos continuam sendo dados pessoais potenciais; o consentimento informa o envio. Conteúdo documental é delimitado como dado não confiável. Só se aceitam IDs de achados já existentes e motivos de uma enumeração; nenhum texto ou número gerado pelo modelo vira evidência. Respostas duplicadas, inventadas, fora do esquema, maiores que 128 KiB, erros e timeout de 20 segundos mantêm os resultados por regras. Isso é revisão semântica limitada de cláusulas já alinhadas, não análise irrestrita de todo o documento.

URLs OpenCode são controladas pelo administrador, nunca por upload/formulário. Exige HTTPS fora de loopback, sem credenciais na URL, redirects ou URL arbitrária do usuário. O serviço deve ficar protegido e acessível somente pelo worker/gateway autorizado; o endpoint de geração não substitui o isolamento de um servidor que também possui APIs de programação. Não se expõem URLs nem credenciais ao navegador.

## Privacidade e retenção

Arquivos do subprocesso são temporários e removidos em `finally`. O resultado e os arquivos de prévia ficam na memória da página; não se grava documento ou resultado em banco/localStorage. Atualizar/fechar/limpar remove o estado; a expiração padrão é 60 minutos, configurável entre 1–120 via `DIVERGENCE_RETENTION_MINUTES`. Isso não apaga arquivos que o usuário tenha baixado nem controla a retenção de um provedor externo. Histórico/cotas registram os metadados normais da tarefa, sem trechos ou nomes. Ver o prazo de expiração do histórico na infraestrutura existente.

## Validação

`tests/unit/divergences.test.ts`: moedas, valores, datas inválidas, identificadores, nomes, ausência com extração parcial, períodos incompatíveis, tabelas ambíguas, duplicados, evidências forjadas, limites, consentimento, contrato OpenCode, resposta inventada/indisponível/grande, rejeição de HTTP remoto, relatório multipágina e Unicode não suportado. Com `PDF_TO_WORD_PYTHON`, também executa extração real, PDF corrompido e cancelamento. Os testes sem servidor OpenCode **não comprovam qualidade de modelo**.
