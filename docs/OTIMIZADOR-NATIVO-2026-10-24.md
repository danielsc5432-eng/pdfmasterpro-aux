# Otimizador nativo e motores CLI — 24/10/2026

## Implementação

A ferramenta Comprimir PDF usa agora uma política própria de seleção e validação sobre qpdf e PyMuPDF. Não contém código, binários ou licenças do 3-Heights. Não foi demonstrada superioridade sobre um produto comercial; essa comparação exigiria entradas, configurações e critérios equivalentes.

O primeiro candidato reorganiza objetos e recomprime streams com qpdf. O segundo tenta deduplicação e compressão de streams, fontes e imagens existentes com PyMuPDF. Nenhum deles rasteriza páginas, reduz a resolução das imagens ou aplica um perfil JPEG agressivo. A reescrita PyMuPDF é evitada para documentos com formulários, anotações, árvores de estrutura e outros recursos complexos; esses arquivos ficam no caminho conservador do qpdf.

Somente candidatos menores são avaliados, em ordem de tamanho. O candidato escolhido precisa manter páginas, rotação, caixas, palavras e posições, campos, links, notas, metadados principais, sumário e bytes de anexos. Também passa por comparação RGB exata nas imagens renderizadas de referência, com escala limitada a 1800 pixels na maior dimensão. Essa comparação amostrada não certifica todos os pixels em qualquer resolução nem todas as funções possíveis de um PDF.

Assinaturas/campos de assinatura, criptografia, documentos reparados e declarações de PDF/A, PDF/X ou PDF/UA são tratados conservadoramente: o resultado original permanece. A política não valida conformidade arquivística nem autentica assinaturas. Sem redução confirmada, com timeout, indisponibilidade de verificador ou erro de execução, retorna os bytes originais. Não apresenta redução fictícia.

As tarefas usam diretórios temporários separados, nomes controlados pelo servidor, execução sem shell, timeout e um limite de concorrência para essa camada nativa no processo. Saídas aceitas têm limite de 64 MiB; a otimização também preserva o original acima desse limite de entrada. Isso não representa um sandbox completo do sistema operacional nem limite global para todos os outros motores existentes.

## Integração por linha de comando

O SDK exporta `optimizePdf`, `cliConvert` e `configuredCli`. O adaptador de conversão permite conectar executáveis instalados pelo operador, por configuração do servidor. A integração PDF → Word entra como candidato opcional e continua sujeita à conferência de conteúdo e layout antes de substituir o resultado. Word → PDF possui fallback para o conversor Office existente e valida o formato PDF de saída; isso não comprova equivalência visual universal entre Office e PDF.

Variáveis opcionais:

```dotenv
PDF_OPTIMIZER=qpdf
PDF_TO_WORD_CLI_EXECUTABLE=/caminho/para/executavel
PDF_TO_WORD_CLI_ARGS=["{input}","{output}"]
WORD_TO_PDF_CLI_EXECUTABLE=/caminho/para/executavel
WORD_TO_PDF_CLI_ARGS=["{input}","{output}"]
```

`PDF_OPTIMIZER` aceita qpdf ou executável compatível com seus argumentos. Os adaptadores de conversão recebem um array JSON de argumentos, sem montar comandos de shell. Placeholders: `{input}`, `{output}`, `{directory}` e `{profileUri}`. A configuração fica no servidor e não vem de uploads ou campos enviados pelo navegador.

Exemplo para o LibreOffice instalado:

```dotenv
WORD_TO_PDF_CLI_EXECUTABLE=soffice
WORD_TO_PDF_CLI_ARGS=["-env:UserInstallation={profileUri}","--headless","--convert-to","pdf:writer_pdf_Export","--outdir","{directory}","{input}"]
```

Nenhum adaptador comercial foi habilitado nem adquirido. Um executável proprietário continua exigindo instalação e licença próprias. A camada não reproduz seu algoritmo ou contorna licenciamento. As licenças das dependências livres continuam aplicáveis.

## Validação local

108 testes TypeScript aprovados; nove testes Python específicos do otimizador aprovados. Casos: redução real, alteração de número/sinal, alteração de cor, metadados, rotação, notas, campos, links, anexos, declarações de arquivo, campos de assinatura e imagem raster com dimensões e pixels preservados. O adaptador CLI foi testado com subprocesso real, saída PDF válida/inválida e limpeza após falha.

No PDF sintético de colunas: 4920 → 4623 bytes, redução de aproximadamente 6,04%, com preservação confirmada. Isso é um exemplo, não uma taxa esperada para todos os documentos. PDFs já comprimidos podem não diminuir. O build e a verificação de tipos passaram localmente.

## Validação Linux e Office

[Execução final no Debian](https://github.com/danielsc5432-eng/pdfmasterpro/actions/runs/40143868996): 108 testes TypeScript e 23 testes Python aprovados, total de 131; build, tipos, teste de redução e conferência de regressões aprovados. A medição de compressão no Linux repetiu 4920 → 4623 bytes, com preservação confirmada. A bateria de conversão mantém sua referência de aprovações e revisões; otimização não transforma casos de OCR em conversões perfeitas.

O adaptador também foi exercitado localmente com LibreOffice real em modo headless: Word com tabela → PDF de uma página, mantendo o texto de referência e o valor negativo `-1234.56`. Nenhum executável 3-Heights foi instalado ou habilitado.

## Rodada adicional: metadados e anexos

Testes adversariais reproduziram duas lacunas do verificador: ele aceitava a remoção do XML/XMP embutido e mudanças em nome/descrição de anexo quando os bytes do anexo e a aparência da página continuavam iguais. Isso demonstra uma falha de validação; não é evidência de perda em arquivos reais de clientes.

O verificador agora compara o XML/XMP completo e os atributos dos anexos, permitindo variar somente o comprimento comprimido do stream. Os dois testes que falhavam passaram após a correção. Um teste positivo com qpdf confirmou que documentos com XMP e anexos intactos continuam aceitos.

[Validação Linux desta correção](https://github.com/danielsc5432-eng/pdfmasterpro/actions/runs/40144789927): 108 testes TypeScript e 26 Python aprovados, total de 134; tipos, build e referência de regressão de conversão aprovados. O otimizador foi exercitado em dez PDFs sintéticos com texto, valores, colunas, rotação, tamanhos diferentes, páginas gráficas e digitalizações: sete reduziram de tamanho e três mantiveram os bytes originais. Todos passaram na conferência correspondente. O comparativo amostrado não representa uma garantia de 100% para qualquer PDF.

## Fontes técnicas

- [CLI do qpdf](https://qpdf.readthedocs.io/en/stable/cli.html).
- [CLI do 3-Heights/Conversion Service](https://www.pdf-tools.com/docs/conversion-service/migrate/integrate/CLI/).
- [Licenças oficiais Pdftools](https://www.pdf-tools.com/docs/licenses/).
- [Descrição oficial dos produtos 3-Heights](https://www.pdf-tools.com/docs/other-shell-tools-and-sdks/).
