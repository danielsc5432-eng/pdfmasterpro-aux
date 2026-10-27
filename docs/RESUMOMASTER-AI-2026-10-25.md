# ResumoMaster AI — auditoria e primeira implementação

Data: 25/10/2026. Mudanças locais, sem publicação automática. O usuário ainda não possui provedor configurado; não foi enviado nenhum PDF a um serviço externo de IA.

## Auditoria e decisões

O projeto é Next.js 16.4.2/React/TypeScript, com frontend na Vercel e processador Docker no Render. Já existem PyMuPDF, Tesseract (português/inglês), `pdf-lib`, `@pdf-lib/fontkit`, `docx`, Zod, histórico técnico, assinatura do proxy e cotas persistentes. As integrações semânticas do Detector são específicas para comparação de pares; não foram reutilizadas como um falso resumidor. O novo adaptador usa o mesmo padrão seguro de chamadas HTTP limitadas e canceláveis.

Nenhuma biblioteca nova foi instalada, nenhum recurso existente foi removido, e não foram copiadas imagens, marcas ou código do iLovePDF. Interface e componentes foram escritos para a identidade visual existente.

## Arquitetura do primeiro fluxo

1. A página `/ferramentas/resumir-pdf-ia` consulta `/api/summary/capabilities`. A Vercel consulta o processador com assinatura de backend; não revela chaves nem URLs privadas de Ollama.
2. O usuário escolhe um PDF, tamanho, modo realmente disponível, intervalo opcional e instruções. A transmissão exige confirmação explícita e login.
3. `/api/v1/process?tool=resumir-pdf-ia` reaproveita as cotas e o proxy assinado. Há limite adicional de três tentativas por conta gratuita/janela de 24 horas; Premium admite dez. Cada regeneração consome tentativa. O teto não é uma promessa de disponibilidade do provedor gratuito.
4. No processador, o arquivo é validado por assinatura/extensão/MIME/tamanho. PyMuPDF lê o PDF em processo filho limitado; não executa JavaScript, links ou anexos. O original não é enviado ao provedor de texto.
5. A extração respeita as páginas escolhidas, identifica digitalizações e usa Tesseract quando disponível. Até dez páginas OCR; páginas não lidas e erros são informados. Um PDF sem texto aproveitável é recusado.
6. O texto é dividido em trechos com IDs de fonte, página, sobreposição e contexto anterior curto. Cada trecho usa o modelo do modo escolhido. O provedor deve retornar tópicos e citações estruturadas, não HTML.
7. O servidor confere IDs, citações literais, números, datas e moedas. Referências são montadas pelo servidor a partir das fontes. Falha de validação bloqueia a entrega. A seleção final distribui tópicos entre os trechos: até cinco, dez ou dezoito conforme tamanho.
8. O progresso é transmitido por SSE: extração indeterminada e número real de trechos concluídos. Não há cronômetro ou percentual fictício. Cancelamento interrompe a requisição. Resultado só aparece após mensagem final completa e validada; o histórico só é marcado concluído após terminar o stream.
9. O resultado pode ser copiado, editado e exportado em TXT, DOCX e PDF. Fontes e citações originais permanecem conferíveis. Edição manual inclui aviso no arquivo exportado. Caracteres não suportados pela fonte PDF provocam erro explícito e indicação de TXT/DOCX, sem exclusão silenciosa.

## Limites e processamento assíncrono

O fluxo inicial aceita 4 MiB por PDF, documento de até 120 páginas, até 60 mil caracteres extraídos, até oito trechos de 7.500 caracteres (com sobreposição), extração nativa com timeout de 45 s, chamada de IA com timeout de 22 s e orçamento total do worker de 230 s. O limite de oito trechos pode ser atingido antes do teto de caracteres em função da distribuição/overlap. Reduza o intervalo nesses casos. Não há truncamento silencioso ou entrega fictícia.

A Vercel documenta ingresso/saída de função de 4,5 MB e, com Fluid Compute no Hobby, duração máxima de 300 s. `maxDuration=300` já existia. A extração e OCR ficam no Render; o frontend não tenta instalar Python ou carregar pesos de LLM em função serverless.

Para arquivos maiores ou esperas longas por cota de IA, a evolução proposta é: upload direto com URL curta assinada para storage privado → job persistido com proprietário e TTL → fila → worker de longa duração → resultado privado com polling/SSE → exclusão agendada e verificada. Exige definir storage/fila e hospedagem; não foi apresentada como já implementada. O primeiro fluxo bounded/SSE não é uma fila durável: desconectar cancela e não permite retomada.

Referência: [limites oficiais da Vercel](https://vercel.com/docs/functions/limitations).

## IA gratuita pesquisada e integração

### GroqCloud Free — opção para iniciar sem servidor de modelos

Adaptador implementado com `fetch` no backend, usando a API documentada e JSON, sem ferramentas, buscas ou execução de código. Requer conta do operador, chave privada e escolha de modelos acessíveis no plano Free. Não há cadastro, upgrade, pagamento, troca de modelo ou fallback pago automático.

`SUMMARY_GROQ_FREE_CONFIRMED=true` é uma confirmação operacional do proprietário sobre o plano, não uma detecção automática de faturamento. A API de geração não informa com segurança qual plano está contratado. Manter a conta no Free e não cadastrar/ativar pagamento é parte da configuração. Se o administrador mudar o plano no console, o código não consegue garantir custo zero por essa mudança externa.

Na tabela consultada em 25/10/2026, alguns modelos de texto no Free têm limites de 30 solicitações/minuto, mil/dia, 8 mil tokens/minuto e 200 mil/dia, compartilhados pela organização. O console é a referência para a cota real. Não se deve multiplicar usuários do site pela franquia como se cada visitante tivesse uma cota do provedor. Até oito chamadas são necessárias para um documento extenso: o limite de tokens pode interromper a tarefa antes desse teto. HTTP 429 não gera fallback pago nem repetição automática; o usuário deve aguardar ou escolher menos páginas. Não é um serviço gratuito ilimitado ou SLA de produção.

O modo avançado só fica disponível se outro ID de modelo for configurado. Não é anunciado como ativo com o mesmo modelo. Escolha e compare a capacidade real antes da ativação; a mera diferença de nome não comprova melhor qualidade. Não fixamos um modelo de preview ou pago como padrão.

Por padrão a Groq descreve retenção limitada para confiabilidade/abuso, de até 30 dias em certas situações, e permite habilitar Zero Data Retention. É necessário revisar esses controles na conta e os termos dos modelos antes de ativar para documentos de usuários. A interface informa o provedor e inclui link de política; não afirma retenção zero sem configuração.

Fontes: [limites](https://console.groq.com/docs/rate-limits), [dados e ZDR](https://console.groq.com/docs/your-data), [planos](https://console.groq.com/docs/billing-faqs), [contrato da API e integração com aplicações](https://console.groq.com/docs/legal/services-agreement).

### Alternativas encontradas no GitHub

| Projeto | Função real | Situação para o PDF Master Pro |
| --- | --- | --- |
| [groq/groq-typescript](https://github.com/groq/groq-typescript), Apache-2.0 | SDK oficial para a API; não contém os modelos nem remove a necessidade de conta | Contrato REST usado como referência; não adicionado SDK, pois `fetch` existente atende |
| [ollama/ollama](https://github.com/ollama/ollama), MIT | Executa modelos em servidor/máquina com recursos suficientes | Adaptador alternativo implementado, desativado sem servidor/modelo configurados; não fornece hospedagem gratuita |
| [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp), MIT | Inferência C/C++ de modelos, incluindo quantizados | Possível backend próprio futuro; exige infraestrutura, não foi instalado no Render gratuito |
| [huggingface/transformers.js](https://github.com/huggingface/transformers.js), Apache-2.0 | Inferência no navegador, incluindo sumarização | Alternativa futura opcional para reduzir API; depende do modelo, download, memória e qualidade em português |
| [mlc-ai/web-llm](https://github.com/mlc-ai/web-llm), Apache-2.0 | Inferência de LLM no navegador com WebGPU | Alternativa futura; exige navegador/GPU compatíveis e download dos pesos; não é fallback silencioso |

As licenças dos motores não substituem as licenças dos modelos/pesos. Os repositórios foram pesquisados e inspecionados, mas código aberto não é sinônimo de hospedagem gratuita.

## Custos previstos

- Nenhum serviço contratado e nenhuma cobrança de IA realizada nesta etapa.
- Groq: US$ 0 de inferência enquanto a conta/modelo permanecerem elegíveis ao Free e dentro da cota; atingido o limite, a operação falha de forma explícita. Depende de regras do fornecedor, sem garantia de permanência.
- Ollama: sem tarifa da API própria, mas requer máquina/servidor, memória, CPU/GPU, energia e tráfego. Não presumimos custo de hospedagem zero.
- Render/Vercel: continuam sujeitos aos planos e limites existentes. Não foi contratado aumento de recursos.
- PDF/DOCX/TXT: exportação no navegador, sem chamada adicional de IA.

## Arquivos principais

| Caminho | Responsabilidade |
| --- | --- |
| `lib/summary/types.ts` | Schemas, limites e seleção de páginas |
| `lib/summary/provider.ts` | Adaptadores Groq Free/Ollama, modelos distintos, resposta limitada e consentimento |
| `scripts/extract-summary.py`, `lib/summary/extract.ts` | Extração/OCR privados, limites, timeout e limpeza |
| `lib/summary/engine.ts` | Divisão, contexto, citações, números/moedas e composição do resultado |
| `lib/summary/stream.ts` | Progresso real, cancelamento, integridade e conclusão do histórico |
| `lib/summary/export.ts` | TXT/DOCX/PDF com referência e aviso de edição |
| `components/summary/workspace.tsx`, `workspace.css` | Interface própria responsiva, upload, opções, consentimento, progresso, editor e downloads |
| `app/api/summary/capabilities/route.ts` | Capacidades reais do processador, sem segredos |
| `app/api/v1/process/route.ts` | Login/cotas, proxy assinado, extração e acompanhamento do stream |
| `lib/tools/catalog.ts`, `app/ferramentas/[slug]/page.tsx` | Integração no catálogo, sem remover ferramentas |
| `app/privacidade/page.tsx`, `.env.example` | Informação de tratamento e configuração |
| `tests/unit/summary.test.ts`, `scripts/smoke-summary.mjs` | Testes específicos e de navegador |

`.env.summary` local é ignorado pelo Git e tem campos vazios para a chave/configuração; não é publicado. As credenciais de execução ficam no processador Render, não no bundle do navegador. A Vercel consulta o worker com o segredo de assinatura já existente.

## Validação executada

**202 testes passaram, zero falhas e zero ignorados** na suíte ampliada; TypeScript e build de produção passaram. **56 verificações de rota passaram** em servidor local isolado. Nenhuma conta real, assinatura ou arquivo de produção foi alterado.

Os 16 testes específicos cobrem PDF textual, multipágina, seleção de páginas, PDF digitalizado com OCR real do Tesseract e sem OCR, PDF vazio/corrompido, documento além do limite, divisão de documento extenso, resumos curto/médio/longo, modelos padrão/avançado distintos, instruções financeiras, consentimento, ausência de provedor, erros/limites de API, reserva automática, contratos Cloudflare e Ollama Cloud, rejeição de citações/valores/moedas inventados, progresso, stream cortado, cancelamento e exportações PDF/DOCX/TXT com leitura real dos arquivos resultantes.

O teste de navegador abriu a interface real no Chrome e verificou provedor ausente, seleção de arquivo, consentimento, stream com respostas controladas, cópia, edição, arquivos baixados reais nos três formatos, erro de API, corte, cancelamento e larguras 390/768/1440. Capturas em `.vercel/review/resumomaster/` foram conferidas visualmente.

**Limite da evidência:** o contrato de geração foi testado com respostas controladas e um servidor HTTP de teste. Não houve benchmark de qualidade com um modelo real externo, pois o usuário ainda não possui chave/servidor. O OCR e as exportações foram reais. Não atribuímos resultados de fixtures a uma IA ativa.

## Pendências antes da ativação

### Atualização: provedores gratuitos e reserva automática

Há adaptadores para Groq, Cloudflare Workers AI, Ollama Cloud e servidor Ollama. Para a conta Cloudflare já existente, Workers AI evita contratar outro servidor: a API REST pode ser chamada pelo processador atual. O plano Workers Free oferece 10.000 Neurons/dia compartilhados, não 10.000 resumos; ao exceder, requisições falham. Workers Paid pode cobrar excedentes. A confirmação `SUMMARY_CF_FREE_CONFIRMED` é uma declaração do operador, não uma consulta automática do plano. É necessário um token específico de Workers AI; o token de DNS não basta. Fontes: [preços](https://developers.cloudflare.com/workers-ai/platform/pricing/), [API REST](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) e [dados](https://developers.cloudflare.com/workers-ai/platform/data-usage/).

Ollama Cloud também oferece créditos iniciais limitados no Free; isso não equivale à hospedagem gratuita ilimitada de um servidor Ollama. O adaptador Cloud usa prompt JSON e validação local, pois os structured outputs do Ollama não estão disponíveis no Cloud conforme a documentação consultada. Fontes: [planos](https://ollama.com/pricing), [Cloud](https://docs.ollama.com/cloud) e [structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

Reserva: configurar `SUMMARY_FALLBACK_ENABLED=true`, `SUMMARY_FALLBACK_PROVIDER` e seus modelos padrão/avançado. As credenciais e confirmações gratuitas são as específicas do segundo provedor. O principal precisa estar configurado. A reserva é anunciada antes do consentimento, com sua política de dados; a troca durante a tarefa não exige outra confirmação nem abre um alerta. A indicação técnica permanece no resultado para auditoria.

Em HTTP 408/429/500/502/503/504, falha de conexão ou timeout, há uma única troca por tarefa. O trecho que falhou é repetido na reserva, e os seguintes continuam nela. O contexto resumido anterior também pode ser enviado. Limite: oito trechos e nove chamadas totais, dentro do prazo global existente. Não há ciclo de tentativas, compra de créditos, mudança de plano ou substituição por modelo pago. Cancelamento, credenciais recusadas e resposta com conteúdo/citações inválidos interrompem o processamento; o modo avançado nunca regride automaticamente para padrão. Se ambas falharem, aparece erro, sem resultado fictício.

Os conectores exigem credenciais/modelos válidos. Nenhuma publicação desta ferramenta foi feita.

### Ativação local e primeiro teste real — 25/10/2026

Após confirmação do usuário sobre o plano Workers Free, o arquivo local ignorado `.env.summary` foi configurado para Cloudflare com `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. O token foi validado por chamadas reais usando exclusivamente um texto artificial, sem documentos pessoais. O primeiro modelo 8B recusou a solicitação. No modelo 70B, a API retornou JSON já estruturado; o conector foi corrigido para aceitar objeto ou texto, sempre passando pela mesma validação estrita de schema, citações e números. Há cobertura de regressão para ambos os formatos.

O teste final retornou HTTP 200 e preservou no tópico e na citação os fatos sintéticos `R$ 1.200,00` e `25/10/2026`. O prompt foi ajustado para evitar tópicos que sejam apenas rótulos sem os fatos pedidos. A chamada final consumiu aproximadamente 25,24 Neurons conforme a resposta da API; isso não estima o custo de PDFs maiores. Esse teste comprova conexão e um caso simples, sem demonstrar precisão geral. A reserva Groq continua desativada até configurar suas credenciais e modelos; produção permanece inalterada.

### Reserva Groq validada — 25/10/2026

Após o usuário salvar sua chave Groq, a conexão real foi validada com `openai/gpt-oss-20b`, listado na franquia gratuita na documentação consultada. Uma segunda chamada exercitou a troca automática: a falha da principal Cloudflare foi simulada localmente, e a resposta da reserva Groq foi real. Ambos os testes usaram apenas texto sintético; o primeiro preservou explicitamente o valor e a data pedidos. A troca terminou com um resumo validado e duas tentativas contabilizadas (principal simulada + reserva real).

`SUMMARY_FALLBACK_ENABLED=true` foi salvo no arquivo local ignorado. Cloudflare permanece principal e Groq é reserva do modo padrão; o modo avançado continua sem configuração. Não houve publicação nem alteração de plano. As credenciais ainda precisam ser instaladas no processador de produção antes da ativação pública, após autorização do usuário. Referência de cotas: https://console.groq.com/docs/rate-limits.

### Publicação autorizada e verificação de produção

Após a autorização “faça isso”, as variáveis necessárias foram instaladas individualmente no Render, sem substituir as demais configurações. Não foram gravadas chaves no Git. Commit publicado: `9691b7300e3e0688638fbf6905cb61f539be1f93`. A suíte completa voltou a passar: 202 testes, zero falhas; o build local e o build Vercel também passaram.

Vercel: `dpl_4pSbrFTiKNVDdiL3eGbgmfALziy2`, READY, domínio `https://www.pdfmasterpro.com.br`. Render: `dep-dbfbcr0473hc739t3ve0`, mesmo commit. A página `/ferramentas/resumir-pdf-ia` e o health retornaram HTTP 200. A consulta pública de capacidades confirmou `available=true`, Cloudflare principal, Groq reserva, OCR disponível e modo avançado desabilitado. POST anônimo ao resumo retornou 401; consulta direta não assinada ao worker retornou 403.

A revisão automática rejeitou uma tentativa de baixar todas as variáveis da Vercel para um teste autenticado, por ser acesso amplo a segredos desnecessário para verificar o deploy. A ação não foi executada nem contornada. A verificação de produção usou somente endpoints públicos e suas proteções; não se declara teste completo com usuário autenticado ou PDF processado através da produção. Os testes reais de geração nos dois provedores e da troca automática foram os testes sintéticos locais documentados acima.

1. Criar conta Groq Free, revisar tratamento de dados/modelos e salvar chave somente no arquivo local ignorado ou no servidor. Alternativamente, informar servidor Ollama próprio com HTTPS e modelo adequado.
2. Escolher modelos disponíveis, configurar ambiente do processador e comparar resumos reais em PDFs de teste sem dados confidenciais. Conferir capacidade do modo avançado antes de anunciá-lo.
3. Confirmar cotas reais; documentos extensos podem exigir a fila assíncrona proposta, mesmo abaixo do limite de upload.
4. Publicar somente após autorização explícita, validar streaming Vercel → Render, cancelamento, cota e retenção no ambiente implantado.

Não há garantia de ausência absoluta de alucinações: checagem de citações e números não prova toda interpretação, associação entre entidades ou cobertura de contexto. OCR pode reconhecer errado. O resumo não substitui a leitura/revisão humana. PDF com criptografia, fontes/texto inacessíveis ou complexidade além do orçamento recebe erro ou aviso explícito, sem conteúdo inventado.
