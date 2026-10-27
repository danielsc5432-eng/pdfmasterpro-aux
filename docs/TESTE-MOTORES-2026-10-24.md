# Experimento de hospedagem — 24/10/2026

Separado da produção. Nenhuma URL de motor foi configurada no site.

## Docling / Vercel

- Projeto: `danpt/pdfmasterpro-docling-test`.
- Código: `deploy/docling-vercel/`, Docling 2.142.1, PyTorch CPU via índice explícito.
- Primeiro build falhou por prioridade do índice de pacotes; corrigido usando fontes exclusivas para torch e torchvision.
- Preview `dpl_2vxNJmEyt3wjVzp5skXTss945uqz` ficou Ready; health check retornou HTTP 200 e JSON de identificação.
- Pacote FastAPI: 548,64 MB; Vercel habilitou large functions beta automaticamente.
- Segundo preview `dpl_7RdnrHcxCjqLFYPLtoQ65EH8ZYqa` inclui chave de API privada. Sem chave, a conversão retorna 401. Requisição experimental limitada a 4 MiB e dez páginas, modelos em cache temporário, temporários do documento removidos.
- Conversão remota real do PDF sintético `automatic-native.pdf`: HTTP 200, status success, um item de texto e valor `1234.56` preservado. Isso comprova execução inicial, não fidelidade universal ou viabilidade sob carga. Preview continua protegido pela autenticação Vercel e não serve como endpoint de produção do worker.

## Stirling / Render

- Serviço: `srv-dbecd3a9lscs73amktng`, `pdfmasterpro-stirling-test`.
- Imagem oficial `docker.stirlingpdf.com/stirlingtools/stirling-pdf:3.2.2`.
- Plano explicitamente `free`; autenticação e chave aleatória habilitadas. Chaves somente em arquivos ignorados `.vercel` e configuração dos provedores.
- Logs confirmaram início da aplicação Java/Spring Boot, mas Render encerrou a implantação por timeout de detecção de porta às 11:59:49 (Brasília). Não houve conversão bem-sucedida. Isso não comprova OOM: o motivo registrado foi tempo de inicialização sem porta disponível.
- Documentação atual recomenda 4 GB para imagem com Office/OCR, muito acima dos 512 MB gratuitos. Não considerar utilizável antes de uma conversão real.

Nenhum plano pago foi contratado. Não enviar documentos pessoais a esses ambientes antes da validação. A implantação do site existente não foi alterada.

O JSON real do Docling também foi reconstruído em DOCX local com texto editável e `1234.56` preservado (9.574 bytes). Pedido remoto sem chave retornou HTTP 401. A suíte existente permanece com 85 testes aprovados, e o arquivo Python passou em py_compile.

Referências: https://docs.stirlingpdf.com/Server/Install/Docker/ e https://vercel.com/docs/functions/limitations

## Complemento: testes com os formulários reais

Ver `COMPARACAO-DOCLING-2026-10-24.md`. O teste sintético não se confirmou nos formulários: OCR falhou primeiro por diretório somente leitura e depois por falta de espaço temporário. Variante sem OCR converteu DTC, mas perdeu termos numéricos na reconstrução e foi reprovada. INSS encerrou com SIGKILL. Integração permanece desativada em produção.
