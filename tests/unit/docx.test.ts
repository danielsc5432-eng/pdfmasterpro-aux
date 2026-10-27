import test from "node:test";
import assert from "node:assert/strict";
import { buildDocxParagraphs } from "../../lib/processing/docx";

test("junta linhas quebradas em um único parágrafo", () => {
  const paragraphs = buildDocxParagraphs("Este documento descreve o objeto do contrato\nfirmado entre as partes e detalha as condicoes\ntecnicos descritos no anexo.\n");
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "Este documento descreve o objeto do contrato firmado entre as partes e detalha as condicoes tecnicos descritos no anexo.");
});

test("inicia novo parágrafo após pontuação final e antes de linha maiúscula", () => {
  const paragraphs = buildDocxParagraphs("Primeira: o prazo e de doze meses.\nSegunda: o pagamento ocorre mensalmente.\nANEXO I\nEscopo detalhado\nO servico compreende analise\nsemanal de relatorios.\n");
  assert.deepEqual(paragraphs.map((item) => item.text), [
    "Primeira: o prazo e de doze meses.",
    "Segunda: o pagamento ocorre mensalmente.",
    "ANEXO I",
    "Escopo detalhado",
    "O servico compreende analise semanal de relatorios.",
  ]);
});

test("remove hifenização de fim de linha", () => {
  const paragraphs = buildDocxParagraphs("A docu-\nmentacao foi revisada e o rela-\ntorio final foi enviado.\n");
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "A documentacao foi revisada e o relatorio final foi enviado.");
});

test("remove recuos e espaços duplicados vindos do pdftotext", () => {
  const paragraphs = buildDocxParagraphs("                                      Pagina 7   \nTexto    com    espacos   extras.\n");
  assert.deepEqual(paragraphs.map((item) => item.text), ["Pagina 7", "Texto com espacos extras."]);
});

test("descarta a página fantasma final do pdftotext", () => {
  const paragraphs = buildDocxParagraphs("Pagina um\n\fPagina dois\n\f");
  assert.deepEqual(paragraphs.map((item) => item.text), ["Pagina um", "Pagina dois"]);
  assert.equal(paragraphs.filter((item) => item.pageBreakBefore).length, 1);
  assert.equal(paragraphs[1].pageBreakBefore, true);
});

test("preserva página em branco intermediária com quebra de página", () => {
  const paragraphs = buildDocxParagraphs("Primeira\n\f\n\fTerceira\n\f");
  assert.deepEqual(paragraphs.map((item) => item.text), ["Primeira", "", "Terceira"]);
  assert.deepEqual(paragraphs.map((item) => item.pageBreakBefore), [false, true, true]);
});

test("mantém cada item de lista em seu próprio parágrafo", () => {
  const paragraphs = buildDocxParagraphs("Itens do contrato:\n- primeiro item\n- segundo item\n1. terceiro item\n2. quarto item\n");
  assert.deepEqual(paragraphs.map((item) => item.text), ["Itens do contrato:", "- primeiro item", "- segundo item", "1. terceiro item", "2. quarto item"]);
});

test("marca títulos em caixa alta como destaque", () => {
  const paragraphs = buildDocxParagraphs("ANEXO I\nEscopo detalhado\nEste documento nao contem texto.\n");
  assert.equal(paragraphs[0].heading, true);
  assert.equal(paragraphs[1].heading, false);
  assert.equal(paragraphs[2].heading, false);
});
