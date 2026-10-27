# Motores complementares — 26/10/2026

Integração na branch `validation/native-pdf-engines`, sem alteração de produção.

- OCRmyPDF 17.13.0: OCR seletivo, preservando páginas nativas. O resultado é conferido por quantidade de páginas, presença de texto e diferença visual antes da entrega. Tesseract permanece como alternativa.
- PDFium (pypdfium2 5.14.0): inspeção, extração e renderização alternativa.
- Apache PDFBox 3.0.8: extração de texto e renderização alternativa via Java, com heap de 128 MB. Download no build com SHA-512 fixado, sem download durante a conversão.

Poppler continua como primeira opção para texto e imagens. Os novos motores não reconstroem documentos Word; o fluxo existente de PDF para Word permanece separado. Não há novas opções técnicas na interface.

## Operação

O Docker instala um ambiente Python separado, Java e os motores. Fora do Docker, configurar `PDF_ENGINES_PYTHON`, `PDFBOX_JAR` e opcionalmente `PDFBOX_JAVA`. Sem o ambiente complementar, os motores existentes continuam disponíveis.

Limites dos fluxos integrados: 25 MB por PDF, 60 páginas para extração/renderização e 30 páginas para OCR com inspeção complementar. Imagens de saída: até 4 milhões de pixels por página e 32 MB no conjunto. Um trabalho nativo por processo; concorrência excedente recebe aviso para tentar novamente. Arquivos temporários são excluídos ao concluir ou falhar. Subprocessos recebem somente variáveis necessárias, sem chaves da aplicação.

PDFs protegidos são recusados. OCR de arquivos com formulários, assinaturas ou anotações é recusado quando exigiria alteração desses elementos. Páginas inteiramente textuais são devolvidas sem mudanças. OCR vazio, parcial em páginas sem texto ou com alteração visual acima do limiar não é entregue.

## Validação e limites

Script de integração: `scripts/test-native-engines.ts`. Usa somente documentos sintéticos já criados pelo benchmark. Resultados em `.vercel/review/pdf24-research/integration-results.json`. O script precisa dos caminhos dos motores e dos dados Tesseract por+eng.

Validação local concluída: 260 testes automatizados passaram; TypeScript e compilação Next passaram. Os 16 cenários de integração nativa passaram: extração/renderização com os três motores configurados, ausência simulada de Poppler, exclusão de credenciais do ambiente, preservação byte a byte de PDF nativo, quatro PDFs digitalizados/mistos e rejeição de entradas inválidas, corrompidas ou protegidas. Nenhum arquivo de cliente foi utilizado.

### Resultado Linux com recursos limitados

[Execução final aprovada](https://github.com/danielsc5432-eng/pdfmasterpro/actions/runs/40431143355), código `e501e04`. Dockerfile real, 512 MiB, sem swap e 0,1 CPU. Os 16 cenários passaram, incluindo confirmação dos números `2.500,00`, `10%`, `30/11/2026`, `15` e `30` após OCR nos quatro documentos sintéticos. Servidor Next disponível ao final; zero eventos OOM e zero processos mortos por falta de memória.

Pico final do cgroup: 489.799.680 bytes (467,11 MiB). Na execução detalhada anterior ao isolamento da validação PNG, 504.324.096 bytes (480,96 MiB). A validação PNG agora decodifica em um processo temporário e libera os buffers ao encerrar, evitando reter os pixels no Node. Três testes Python adicionais aprovados rejeitam PNG truncado, formato falso e dimensões excessivas. A suíte existente de 260 testes passou novamente após a alteração.

A rodada final levou 254,51 segundos no total; cada cenário pode executar a operação mais de uma vez para confirmar o motor direto e a integração. Isso não é latência por arquivo. O monitor também executa Next e um executor Node de testes separado, com sobrecarga própria. Variações de tempo/memória entre execuções não são uma garantia de desempenho geral.

Conclusão: aprovado para os casos sintéticos de uma ou duas páginas, processados sequencialmente. Não foi comprovado suporte a 30 páginas digitalizadas sob carga, múltiplos usuários simultâneos ou todos os PDFs. A margem final de aproximadamente 45 MiB exige cautela. Artefatos completos ficam no GitHub por sete dias e localmente em `.vercel/review/pdf24-research/linux-optimized/`. A produção não foi atualizada.

A inspeção detecta ausência de texto, mas não prova que todo número reconhecido esteja correto. PDFs mistos dentro da mesma página, fontes incomuns e digitalizações degradadas podem exigir revisão. A comparação visual admite pequenas diferenças e rotações. Não representa fidelidade universal de 100%.

Sem cobrança de API; há consumo de CPU, memória e disco da hospedagem. O Dockerfile real foi construído no GitHub Actions. O teste de capacidade usa container Linux com 512 MiB, sem swap e 0,1 CPU, servidor Next ativo e executor de testes separado. Isso reproduz limites de recursos, não a infraestrutura completa nem o tráfego real do Render. Nenhum teste foi executado em documentos de clientes.

## Distribuir em outras hospedagens

A separação site/processador já existe em `PROCESSING_WORKER_URL`, no endpoint `/api/v1/process`, com encaminhamento assinado do plano. Atualmente há um destino geral; distribuir por tipo de ferramenta exigirá uma seleção de destinos no servidor, mantendo autenticação, cotas e histórico no site. Não encaminhar documentos automaticamente a um novo destino antes de configurar sua autorização e a informação de tratamento de dados.

Arquitetura possível: Vercel para interface/autenticação, Render para tarefas leves e Cloud Run para OCR/conversões pesadas. Cada documento continua precisando caber na memória do seu executor; as memórias dos provedores não são somadas. Remover a instalação do Java de um servidor não economiza o mesmo volume de RAM durante OCR, porque o Java já não fica permanentemente executando.

Cloud Run permite dimensionar mais memória com franquia gratuita de uso, mas cobra excedentes e pode envolver outros custos de infraestrutura. Não é hospedagem ilimitada com custo zero garantido. Nada foi contratado, configurado ou ativado no Google Cloud.

Verificação em 26/10/2026: Koyeb gratuito também oferece 512 MB/0,1 CPU. A documentação atual do Hugging Face informa que novos Spaces Docker/Gradio exigem plano pago, apesar de o hardware CPU Basic não ter custo por hora. Não contar com um novo Space Docker gratuito sem confirmar elegibilidade da conta.

Fontes: [Render](https://render.com/docs/compute-plans), [Cloud Run](https://cloud.google.com/run/pricing), [Koyeb](https://www.koyeb.com/docs/reference/instances), [Hugging Face](https://huggingface.co/docs/hub/spaces-overview).

Licenças: PDFBox Apache-2.0, OCRmyPDF MPL-2.0, PDFium BSD com avisos de terceiros. Ghostscript e outras dependências já existentes têm obrigações próprias, inclusive AGPL; não declarar toda a cadeia como MIT.
