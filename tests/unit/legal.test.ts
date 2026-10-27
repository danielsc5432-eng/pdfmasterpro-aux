import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { compareLegalVersions, classifyChange, comparePixels } from "../../lib/legal/compare";
import { blocksFromLines, clauseKey, changedSpan } from "../../lib/legal/structure";
import { DEFAULT_LEGAL_OPTIONS, LEGAL_LIMITS, legalEvidenceValid, type LegalDocument, type LegalPage } from "../../lib/legal/types";
import { legalReportCsv, legalReportDocx, legalReportPdf, legalReportText } from "../../lib/legal/report";
function document(id:string,texts:string[][]):LegalDocument {
  const pages:LegalPage[]=texts.map((texts,index)=>({number:index+1,width:595,height:842,readable:true,ocr:false,signature:new Uint8Array(96*136).fill(255),blocks:blocksFromLines(texts.map((text,line)=>({text,box:[30,50+line*40,500,70+line*40]})),index+1)}));
  return{id,name:id+".pdf",bytes:100,sha256:"a".repeat(64),pages,complete:true,warnings:[]};
}
function compare(one:LegalDocument,two:LegalDocument,extra:Partial<typeof DEFAULT_LEGAL_OPTIONS>={}){return compareLegalVersions([one,two],[{id:one.id,name:"Original",date:""},{id:two.id,name:"Atualizado",date:""}],{...DEFAULT_LEGAL_OPTIONS,...extra});}
const contract=["Contratante: Maria Silva","Cláusula 1 — Valor total de R$ 1.200,00.","Cláusula 2 — Multa de 2%.","Cláusula 3 — Prazo de 12 meses, até 25/10/2026.","Cláusula 4 — Obrigações da contratada." ];
test("jurídico: valores, percentuais, datas, prazos e partes têm evidências verificáveis",()=>{
  const left=document("original",[contract]);const right=document("atualizado",[["Contratante: Joana Santos","Cláusula 1 — Valor total de R$ 2.500,00.","Cláusula 2 — Multa de 10%.","Cláusula 3 — Prazo de 24 meses, até 25/11/2026.",contract[4]]]);
  const result=compare(left,right);const findings=result.pairs[0].findings;
  for(const category of ["money","percent","date","deadline","party"])assert.ok(findings.some(finding=>finding.categories.includes(category as "money")),category);
  assert.ok(findings.some(finding=>finding.kind==="modified"&&finding.categories.includes("party")&&finding.before?.quote.includes("Maria Silva")&&finding.after?.quote.includes("Joana Santos")));
  assert.ok(findings.some(finding=>finding.before?.quote.includes("12 meses")&&finding.after?.quote.includes("24 meses")));
  for(const finding of findings)for(const evidence of [finding.before,finding.after])if(evidence)assert.equal(legalEvidenceValid(evidence,result.documents),true);
  const first=findings[0].before!;assert.equal(legalEvidenceValid({...first,quote:"Texto inventado"},result.documents),false);
});
test("jurídico: cláusulas movidas não são classificadas como exclusão e inclusão",()=>{
  const left=document("one",[[contract[1],contract[2]],[contract[3]]]);const right=document("two",[[contract[3]],[contract[2],contract[1]]]);
  const findings=compare(left,right).pairs[0].findings;assert.ok(findings.some(finding=>finding.kind==="moved"));assert.equal(findings.some(finding=>finding.kind==="added"||finding.kind==="removed"),false);
});
test("jurídico: página inserida alinha as páginas seguintes pelo conteúdo",()=>{
  const left=document("one",[[contract[1]],[contract[3]]]);const right=document("two",[["Cláusula 9 — Nova condição contratual."],[contract[1]],[contract[3]]]);
  const pair=compare(left,right).pairs[0];assert.ok(pair.links.some(link=>link.before===1&&link.after===2));assert.ok(pair.links.some(link=>link.before===2&&link.after===3));assert.ok(pair.findings.some(finding=>finding.kind==="added"&&finding.categories.includes("page")&&finding.after?.page===1));
  const reverse=compare(right,left).pairs[0];assert.ok(reverse.findings.some(finding=>finding.kind==="removed"&&finding.categories.includes("page")));
});
test("jurídico: cláusulas incluídas e excluídas, títulos e numeração jurídica",()=>{
  const left=document("one",[[contract[1],contract[2]]]);const right=document("two",[[contract[1],"Cláusula 8 — Condição adicional de entrega."]]);const findings=compare(left,right).pairs[0].findings;
  assert.ok(findings.some(finding=>finding.kind==="removed"&&finding.before?.quote===contract[2]));assert.ok(findings.some(finding=>finding.kind==="added"&&finding.after?.quote.includes("Cláusula 8")));
  for(const [text,key] of [["Cláusula Quinta — Prazo de 12 meses.","quinta"],["Art. 5 — Texto normativo citado.","5"],["1. OBJETO","1"],["DA RESCISÃO","da rescisão"]])assert.equal(clauseKey(text),key);
});
test("jurídico: PDFs idênticos e alteração somente de espaços não geram divergência textual",()=>{
  assert.equal(compare(document("one",[contract]),document("two",[contract])).pairs[0].findings.length,0);
  assert.equal(compare(document("one",[["Cláusula 1 — Texto  igual."]]),document("two",[["Cláusula 1 — Texto igual."]])).pairs[0].findings.length,0);
});
test("jurídico: redistribuir texto entre páginas não inventa exclusão ou inclusão",()=>{
  const one=document("one",[["Cláusula 1 — O prazo contratual será de"],["12 meses a contar da assinatura."]]);
  const two=document("two",[["Cláusula 1 — O prazo contratual será de 12 meses a contar da assinatura."]]);
  const result=compare(one,two,{mode:"text"});assert.equal(result.pairs[0].findings.length,0);
  const full=compare(one,two);assert.ok(full.pairs[0].findings.some(finding=>finding.kind==="moved"));assert.equal(full.pairs[0].findings.some(finding=>finding.kind==="added"||finding.kind==="removed"),false);
});
test("jurídico: comparação de múltiplas versões é consecutiva e não inventa datas",()=>{
  const documents=[document("one",[[contract[1]]]),document("two",[["Cláusula 1 — Valor total de R$ 2.000,00."]]),document("three",[["Cláusula 1 — Valor total de R$ 3.000,00."]])];
  const result=compareLegalVersions(documents,documents.map(document=>({id:document.id,name:document.name,date:""})),DEFAULT_LEGAL_OPTIONS);
  assert.equal(result.pairs.length,2);assert.equal(result.pairs[1].beforeId,"two");assert.equal(result.pairs[1].afterId,"three");assert.ok(result.labels.every(label=>label.date===""));assert.ok(legalReportText(result).includes("Data informada pelo usuário: não informada"));
});
test("jurídico: extração parcial não confirma exclusão e preserva avisos de OCR ruim",()=>{
  const one=document("one",[[contract[1]]]);const two=document("two",[[]]);two.complete=false;two.pages[0].readable=false;two.pages[0].warning="Baixa qualidade OCR";two.warnings=["Página 1 não analisada."];
  const result=compare(one,two);assert.ok(result.pairs[0].findings.some(finding=>finding.kind==="unverified"));assert.equal(result.pairs[0].findings.some(finding=>finding.kind==="removed"),false);assert.ok(result.warnings.some(warning=>warning.includes("não analisada")));
  const ocr=document("ocr",[["Cláusula 1 — Valor de R$ 9.000,00."]]);ocr.pages[0].blocks[0].ocr=true;ocr.pages[0].blocks[0].confidence=35;assert.equal(compare(one,ocr).pairs[0].findings[0].confidence,"low");
});
test("jurídico: diferenças visuais são medição de amostra, com região delimitada",()=>{
  const blank=new Uint8Array(96*136).fill(255),changed=blank.slice();for(let y=20;y<35;y++)for(let x=10;x<70;x++)changed[y*96+x]=30;
  const diff=comparePixels(blank,changed,"relevant");assert.ok(diff&&diff.ratio>0);assert.ok(diff.box[0]>0&&diff.box[2]<1);assert.equal(comparePixels(blank,blank,"all"),null);
  const one=document("one",[contract]),two=document("two",[contract]);two.pages[0].signature=changed;const findings=compare(one,two,{mode:"visual"}).pairs[0].findings;assert.equal(findings.length,1);assert.equal(findings[0].categories[0],"visual");
});
test("jurídico: linhas de tabela têm classificação explícita e destaque textual conserva contexto",()=>{
  const one=document("one",[["Serviço A\t3 unidades\tR$ 1.200,00"]]);const two=document("two",[["Serviço A\t4 unidades\tR$ 2.200,00"]]);one.pages[0].blocks[0].table=two.pages[0].blocks[0].table=true;
  assert.ok(compare(one,two).pairs[0].findings.some(finding=>finding.categories.includes("table")));
  assert.ok(compare(one,two).pairs[0].findings.some(finding=>finding.kind==="modified"&&finding.categories.includes("table")));
  assert.deepEqual(changedSpan("Prazo: 12 meses.","Prazo: 24 meses."),{prefix:"Prazo: ",before:"12",after:"24",suffix:" meses."});
  assert.deepEqual(changedSpan("Parte 👩","Parte 👨"),{prefix:"Parte ",before:"👩",after:"👨",suffix:""});
  assert.deepEqual(classifyChange("Multa de 2%","Multa de 10%"),["percent"]);
  assert.deepEqual(classifyChange("Entrega de 3 unidades em 12 parcelas","Entrega de 5 unidades em 24 parcelas"),["quantity"]);
});
test("jurídico: documento extenso é limitado; resultado não cresce além do orçamento",()=>{
  const clauses=Array.from({length:250},(_,i)=>`Cláusula ${i+1} — Registro contratual ${i+1}.`);const updated=clauses.map(text=>text+" Nova condição.");
  const result=compare(document("one",[clauses]),document("two",[updated]));assert.ok(result.pairs[0].findings.length>0);assert.ok(result.pairs[0].findings.length<=LEGAL_LIMITS.findings);
  assert.throws(()=>compare(document("one",Array.from({length:31},()=>[contract[1]])),document("two",[contract])),/limites/);
});
test("jurídico: relatórios TXT, CSV, DOCX e PDF contêm alterações reais e neutralizam fórmulas CSV",async()=>{
  const one=document("one",[[contract[1]]]),two=document("two",[["Cláusula 1 — Valor total de R$ 2.500,00."]]);one.name="=HYPERLINK(fake).pdf";const result=compare(one,two);
  const text=legalReportText(result);assert.ok(text.includes("1.200,00")&&text.includes("2.500,00"));assert.ok(text.includes("não substitui revisão profissional"));
  const csv=legalReportCsv(result);assert.ok(csv.includes("'=HYPERLINK(fake).pdf"));
  const zip=await JSZip.loadAsync(await legalReportDocx(result));assert.ok((await zip.file("word/document.xml")!.async("string")).includes("2.500,00"));
  const pdf=await legalReportPdf(result,new Uint8Array(await readFile("public/fonts/NotoSans-Regular.ttf")));assert.ok((await PDFDocument.load(pdf)).getPageCount()>0);
  const extraPage=compare(document("one",[[contract[1]]]),document("two",[["Anexo adicional."],[contract[1]]]));
  assert.ok((await legalReportPdf(extraPage,new Uint8Array(await readFile("public/fonts/NotoSans-Regular.ttf")))).length>100);
  result.reviews={[result.pairs[0].findings[0].id]:{status:"reviewed",note:"  =FORMULA-TEST"}};
  assert.ok(legalReportText(result).includes("FORMULA-TEST"));assert.ok(legalReportCsv(result).includes("'  =FORMULA-TEST"));
});
test("jurídico: tamanho da página muda mesmo com amostra idêntica; scans podem alinhar por imagem",()=>{
  const left=document("one",[contract]),right=document("two",[contract]);right.pages[0].width=620;
  assert.ok(compare(left,right,{mode:"visual"}).pairs[0].findings.some(finding=>finding.explanation.includes("Dimensões alteradas")));
  const one=document("scan-one",[[]]),two=document("scan-two",[[],[]]);one.complete=two.complete=false;one.pages[0].readable=two.pages[0].readable=two.pages[1].readable=false;
  one.pages[0].signature[20]=30;two.pages[1].signature[20]=30;
  assert.ok(compare(one,two,{mode:"visual"}).pairs[0].links.some(link=>link.before===1&&link.after===2&&link.basis==="image"));
});
