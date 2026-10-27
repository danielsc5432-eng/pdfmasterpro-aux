# ResumoMaster: teste de estresse e correções — 25/10/2026

## Resultado

Foram executados testes com PDFs sintéticos, extração/OCR reais e a Cloudflare configurada pelo usuário. Não foram usados documentos pessoais. O processamento com IA ocorreu no fluxo local do servidor; não equivale a um upload autenticado pelo site de produção.

| Caso | Resultado observado |
| --- | --- |
| PDF textual de 36 páginas | 36 páginas analisadas, 8 trechos e 8 chamadas; 18 tópicos; 96,05 segundos |
| Referências no documento extenso | Fontes do início e do último terço presentes; citações e números conferidos no texto extraído |
| Exportações do documento extenso | PDF válido, DOCX aberto e conteúdo verificado, TXT gerado |
| PDF digitalizado de 12 páginas | 10 páginas analisadas com Tesseract; páginas 11 e 12 explicitamente não analisadas pelo limite de OCR; 8,54 segundos |
| Exportações do documento digitalizado | PDF, DOCX e TXT gerados; valor e data preservados |
| PDF de 120 páginas | Extração real das 120 páginas aprovada em teste automatizado |
| Excesso de texto | Recusado antes de chamadas à IA |
| Falha após trechos já concluídos | Uma troca para a reserva; fontes anteriores preservadas; contadores e limite de nove tentativas conferidos |
| Concorrência no motor nativo | Segundo trabalho recusado enquanto ocupado; temporários removidos mesmo após falha; novo trabalho aceito depois |

A execução real bem-sucedida dos dois documentos consumiu aproximadamente 1.850,91 Neurons segundo as respostas da Cloudflare. Houve chamadas adicionais de diagnóstico antes das correções; esse número não representa o consumo total do dia. Cotas e latência variam.

## Falhas encontradas e corrigidas

1. **Queda da conexão durante a leitura:** um `TypeError` no corpo da resposta não era classificado como falha temporária e impedia a reserva. Agora a classificação cobre a chamada e a leitura, inclusive timeout do corpo, sem transformar cancelamento do usuário em tentativa na reserva. A falha ao cancelar um corpo já quebrado em HTTP 503 também não esconde mais o status temporário.
2. **JSON nulo/primitivo:** a resposta `null` provocava erro técnico ao acessar campos. A raiz agora precisa ser um objeto antes de ler o contrato do provedor; valores inválidos recebem erro tratado, sem resultado.
3. **JSON com marcação de código:** no PDF real de 36 páginas, a IA retornou JSON válido dentro de uma única cerca Markdown `json`. Esse invólucro agora é removido somente quando ocupa toda a resposta. Prosa adicional, múltiplas cercas, JSON incompleto, citações falsas e números inventados continuam recusados.
4. **Resposta interrompida da Cloudflare:** quando a resposta contém `choices`, o término agora precisa ser `stop`, com uma escolha e sem chamadas de ferramentas. Um objeto aparentemente completo com `finish_reason=length` é recusado, mesmo com contagem de tokens abaixo do máximo.

## Verificação

- 211 testes passaram na suíte completa, sem falhas ou testes ignorados.
- Após o último ajuste de cancelamento do corpo, os 25 testes de resumo/estresse passaram novamente.
- TypeScript e build de produção local passaram. Não houve mudanças na interface ou dependências.
- As falhas iniciais estão registradas localmente em `.vercel/review/resumomaster/stress-before.txt`; resultados reais e exportações ficam no mesmo diretório, ignorado pelo Git.
- Regressões novas: `tests/unit/summary-stress.test.ts`.
- Reprodução controlada com IA real: `scripts/stress-summary.ts`. Exige `.env.summary`, Python configurado e `SUMMARY_LIVE_STRESS=true`; não roda na suíte normal e consome a franquia dos provedores.

```powershell
$env:PDF_TO_WORD_PYTHON=(Resolve-Path '.vercel/tools/pdf2docx-venv/Scripts/python.exe').Path
node node_modules/tsx/dist/cli.mjs --test tests/unit/summary-stress.test.ts tests/unit/summary.test.ts
# Apenas para repetir as chamadas reais com os PDFs sintéticos:
$env:SUMMARY_LIVE_STRESS='true'
node node_modules/tsx/dist/cli.mjs scripts/stress-summary.ts
```

## Limites mantidos

O OCR continua limitado a dez páginas por tarefa. O teste digitalizado não comprova análise das doze páginas: duas foram sinalizadas como não analisadas. A execução de 36 páginas bem-sucedida não garante sucesso para qualquer documento desse tamanho; densidade de texto, qualidade de digitalização, cotas e interpretação da IA variam. Não houve teste de upload autenticado em produção. Não foi garantida precisão universal ou ausência de alucinações.

As correções deste teste estão no projeto local; este relatório não declara uma nova publicação no site.
