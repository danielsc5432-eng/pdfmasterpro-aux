# Conversão automática por página — 24/10/2026

## Problema e mudança

Um PDF pode misturar páginas normais, texto girado, colunas desencontradas e páginas somente gráficas. Escolher um renderizador para o documento inteiro prejudicava páginas que precisavam de outro tratamento. Um novo caso sintético de quatro páginas reproduziu corte de palavras em linhas muito curtas e deslocamento vertical de quase quatro pontos.

O candidato nativo agora monta cada página separadamente e empacota todas em um único DOCX. Mantém dimensões, fundos gráficos e texto editável. Usa fluxo de tabela para linhas compatíveis, direção Word para rotações de 90°/270° e blocos posicionados para geometria que cortaria caracteres. Não reúne DOCX independentes com referências de imagem incompatíveis.

A linha de base informada pelo PyMuPDF passa a orientar os blocos nativos. A compensação antiga, calibrada para caixas Poppler, permanece restrita ao caminho original. Os critérios finais de qualidade não foram reduzidos.

## Escolha de motores e recuperação

- Formulários identificados: começa com o fluxo de linhas, evitando uma tentativa posicionada que frequentemente tinha desempenho inferior.
- Texto girado e CJK: começa com extração Unicode e montagem adaptativa.
- Digitalizações: começa com OCR; preserva indicação de revisão.
- Outros documentos nativos: mantém a tentativa estrutural e as alternativas verificadas.
- Uma falha ou conferência indisponível na primeira tentativa não encerra automaticamente todas as alternativas.
- Cada alternativa precisa de relatório medido para substituir a anterior. Um candidato em revisão não substitui um candidato aprovado apenas por ter maior similaridade visual.
- Quando ainda existe orçamento e a aparência aprovada está abaixo da meta de busca, tenta o candidato nativo adicional. Isso não garante esgotar todos os motores dentro do prazo do servidor.

As etapas continuam sequenciais para conter memória. O orçamento é observado entre etapas; os comandos nativos conservam seus próprios timeouts. Isso não constitui cancelamento imediato garantido de todo subprocesso no instante do prazo global.

## Testes contra regressões e referência OCR

`pnpm test:conversion --public --baseline` exige que os oito casos já aprovados continuem aprovados, que os outros seis não se tornem bloqueados e que nenhum relatório esteja ausente ou duplicado. Uma revisão pode melhorar para aprovação. O comando não chama todos os casos de perfeitos.

Nas quatro digitalizações geradas pelo próprio script, a avaliação também compara o texto com a referência conhecida e exige o valor `1234.56` exatamente uma vez, com sinal e separador corretos. Isso evita interpretar uma referência textual vazia como comprovação de OCR exato. PDFs reais sem referência independente continuam exigindo revisão.

O workflow Linux executa o corpus com `--baseline` e testa o roteamento automático no documento misto com `--strict`. Somente arquivos sintéticos e fixtures públicas entram nos artefatos do GitHub; os dois formulários particulares não são enviados ao CI.

## Evidência local

- Caso misto: 4 → 4 páginas, dimensões preservadas, coberturas de texto e números iguais a 1, precisão numérica igual a 1, posição numérica igual a 1.
- Similaridade visual: 0,998926; pior página: 0,996614. A comparação tem tolerância e não representa identidade universal de pixels.
- DTC: aprovado, 3 → 3 páginas, valores preservados.
- INSS: aprovado, 2 → 2 páginas, valores preservados.
- 105 testes TypeScript, verificação de tipos e build aprovados; quatro testes Python de geometria/perfil aprovados.

Nenhuma API paga, modelo comercial ou modo baseado em páginas inteiras como imagens foi adicionado. Fidelidade de 100% para qualquer PDF editável não está demonstrada. A validação visual usa LibreOffice e não substitui conferência em todas as versões do Microsoft Word.

## Validação Linux

[Execução completa](https://github.com/danielsc5432-eng/pdfmasterpro/actions/runs/40141460975): 105 testes TypeScript e 14 testes Python aprovados; build e verificação de tipos aprovados. Corpus: **14 casos, 8 checked, 6 review, nenhum bloqueado**. A comparação com a referência de regressão passou, sem aprovações perdidas ou documentos ausentes. As quatro referências sintéticas de OCR passaram na conferência independente de texto e valor.

O roteamento automático do documento misto preservou 4 → 4 páginas, conteúdo e números, com similaridade visual de 0,998031 e pior página de 0,995418. Os seis casos em review continuam identificados como revisão, sem declaração de exatidão universal.
