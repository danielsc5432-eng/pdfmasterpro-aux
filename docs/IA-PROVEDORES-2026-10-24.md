# Ollama, LangChain e Hugging Face no detector

## Estado real das integrações

| Tecnologia | Papel | Estado |
| --- | --- | --- |
| Hugging Face Transformers.js | Similaridade de trechos no navegador, com MiniLM multilíngue | Já publicado e testado com inferência real |
| Ollama | Revisão generativa das cláusulas pelo endpoint `/api/chat` | Conector implementado, validado com servidor HTTP de teste; falta servidor/modelo de produção |
| LangChain JS `@langchain/core` 1.3.0 | Formatação padronizada e processamento da resposta JSON antes da validação Zod e de referências | Integrado ao fluxo de revisão no servidor; não é um modelo e não hospeda modelos |
| Hugging Face Transformers Python | Alternativa de revisão generativa num serviço CPU separado | API, Dockerfile e motor preparados; testes de contrato sem baixar pesos; inferência real desse serviço ainda não validada |
| OpenCode | Alternativa anterior de geração sem ferramentas | Mantido; falta servidor/modelo configurado |

O usuário informou que não tem servidor OpenCode e prefere não hospedar no próprio computador nem contratar APIs pagas. Nenhum serviço ou modelo pago foi ativado e nenhum modelo Python/PyTorch foi instalado no worker Render de PDFs. A opção no navegador continua funcionando independentemente dos conectores de servidor.

## Organização do código

`lib/divergences/review-chain.ts` usa `PromptTemplate.format` e `JsonOutputParser.parse` do LangChain. Não usa agentes, ferramentas, memória persistida, callbacks ou `.invoke`; assim não se inicia rastreamento LangSmith. Um teste ativa as variáveis de tracing com chave fictícia e comprova que essas etapas não fazem requisições externas. O transporte de inferência permanece explícito e limitado nos adaptadores; não é o SDK ChatOllama.

JSON incompleto é recusado antes do parser, impedindo o reparo permissivo de produzir uma aprovação. Zod valida as chaves/motivos; a conferência seguinte recusa IDs inexistentes ou duplicados. Apenas explicações padronizadas mudam, sem criar evidências nem elevar a confiança. Textos de documentos são dados, nunca comandos. Ollama recebe um JSON Schema, sem ferramentas e sem streaming. Saída por limite de tokens não é considerada revisão concluída.

O administrador escolhe **um** provedor por tarefa: `ollama`, `transformers` ou `opencode`. Não há votação entre modelos nem envio automático para vários fornecedores. Falhas mantêm a comparação por regras; não há troca para APIs pagas. Os provedores exigem configuração explícita. O consentimento do usuário cobre somente os trechos enviados ao serviço configurado. O limite continua sendo 10 pares de cláusulas, 450 caracteres por trecho, timeout HTTP de 20 segundos e resposta máxima de 128 KiB.

## Ollama hospedado

Configurar no worker de PDFs:

```dotenv
DIVERGENCE_AI_PROVIDER=ollama
DIVERGENCE_OLLAMA_URL=https://seu-gateway-ollama.example
DIVERGENCE_OLLAMA_MODEL=nome-exato-do-modelo-instalado
DIVERGENCE_AI_KEY=
```

O gateway deve encaminhar `/api/chat` e validar o Bearer configurado. Não expor uma instância Ollama sem autenticação. HTTPS é obrigatório fora de loopback; URLs com senha, query, fragmento ou redirecionamentos são recusadas. `http://localhost:11434` é apenas para testes/serviço no mesmo host; `localhost` dentro do Render não aponta para outro servidor. O operador precisa provisionar o modelo e confirmar suas condições de uso e recursos; a integração não executa `ollama pull` automaticamente. Não foram escolhidos ou baixados modelos para esse backend de produção.

## Serviço Python opcional

Arquivos em `deploy/semantic-ai`. O Dockerfile usa Python 3.12, PyTorch CPU 2.14.1, Transformers 5.20.2, FastAPI 0.162.0 e Uvicorn 0.54.0. Instalação separada: essas bibliotecas não entram em `requirements-pdf2docx.txt`. O Dockerfile foi preparado e o wheel CPU verificado no índice oficial; o container completo e a inferência com pesos reais **não foram executados** nesta validação.

Build, para uma hospedagem com Docker e memória suficiente para o modelo escolhido:

```sh
docker build -f deploy/semantic-ai/Dockerfile -t pdfmaster-semantic .
```

Variáveis do serviço:

```dotenv
MODEL_ID=organizacao/modelo-publico-compativel-com-chat
MODEL_REVISION=hash-de-commit-de-40-caracteres-do-modelo
REVIEW_API_KEY=
HF_HOME=/models
```

Sem modelo/revisão fixa/chave, a análise é recusada. Revisões móveis como `main` não são aceitas. O carregamento usa `trust_remote_code=False`, sem token Hugging Face e sem executar código remoto do repositório do modelo. Modelos privados/gated que precisem de token não são suportados por esse serviço. O modelo precisa ter template de chat e funcionar em CPU/float32. O primeiro carregamento baixa pesos e pode ultrapassar o prazo do cliente: o operador deve preparar e validar o modelo no servidor antes de anunciar o serviço como ativo. Armazenar pesos em `/models` pode exigir volume persistente; documentos, mensagens e embeddings não são persistidos pela implementação.

No worker do site:

```dotenv
DIVERGENCE_AI_PROVIDER=transformers
DIVERGENCE_TRANSFORMERS_URL=https://seu-servico-transformers.example
DIVERGENCE_TRANSFORMERS_MODEL=organizacao/modelo-publico-compativel-com-chat
DIVERGENCE_TRANSFORMERS_KEY=
```

`DIVERGENCE_TRANSFORMERS_KEY` deve corresponder a `REVIEW_API_KEY`, sem expor credenciais no navegador/chat. Colocar atrás de HTTPS/gateway com limites de acesso e requisições; o processo HTTP atende na porta 8080. A API permite um processamento por vez, retorna 429 quando ocupada, limita o corpo a 64 KiB e não devolve trechos nos erros. Sem CORS público, ferramentas, navegação ou execução de comandos. A inferência usa até 3.500 tokens de entrada e 800 tokens novos, com limite de tempo de geração; esse limite do modelo é cooperativo, não um isolamento rígido de CPU. O orçamento HTTP do site pode terminar antes e então mantém as regras.

Não cabe afirmar que modelos generativos adequados funcionarão nos 512 MB do Render gratuito atual. Nenhum servidor novo foi provisionado; para ativar esses dois backends ainda são necessários hospedagem, modelo e credenciais configurados. LangChain não elimina esse requisito. A licença dos frameworks também não substitui a licença específica do modelo.

## Testes

`tests/unit/review-chain.test.ts`: execução real do código LangChain, JSON incompleto, referências inventadas/duplicadas, consentimento, Ollama por HTTP local, schema, truncamento, fallback, modelo Transformers divergente, cancelamento e ausência de chamadas de tracing.

`scripts/test-semantic-ai.py`: cinco testes da API FastAPI e motor com gerador simulado — autenticação, carregamento reutilizado, limites, dados inválidos sem eco, concorrência, revisão fixa e saída fabricada. Esses testes não instalam Torch/Transformers nem validam qualidade de modelo. A bateria Linux executa-os num ambiente separado. A validação real da IA de navegador está documentada em `IA-GITHUB-2026-10-24.md`.

Fontes oficiais: [Ollama chat](https://docs.ollama.com/api/chat), [LangChain JS](https://docs.langchain.com/oss/javascript/integrations/chat/ollama), [Transformers pipelines](https://huggingface.co/docs/transformers/main_classes/pipelines).
