import { legalAIReportText, legalAICsvRows } from "./ai-shared";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { LEGAL_CATEGORIES, type LegalEvidence, type LegalFinding, type LegalResult } from "./types";
const kinds = { added:"Inclusão",removed:"Remoção / trecho não localizado",modified:"Modificação",moved:"Movimentação",unverified:"Inconclusivo" };
const confidenceLabels={high:"alta",medium:"média",low:"baixa"};
const reviewLabels={pending:"Pendente",reviewed:"Conferido pelo usuário",ignore:"Diferença aceita pelo usuário"};
const modeLabels={text:"Textual",visual:"Visual",structure:"Estrutural",complete:"Completa"};
function evidenceText(evidence: LegalEvidence|undefined,result:LegalResult) {
  if(!evidence)return "Sem correspondência localizada; confira as duas versões.";
  const document=result.documents.find(document=>document.id===evidence.documentId)!;
  return `${document.name} · página ${evidence.page}${evidence.quote?"\n"+evidence.quote:"\nEvidência visual/estrutural; confira a página no visualizador."}`;
}
export function legalReportText(result:LegalResult) {
  const findings=result.pairs.flatMap(pair=>pair.findings);
  const counts=Object.entries(LEGAL_CATEGORIES).map(([key,label])=>`${label}: ${findings.filter(finding=>finding.categories.includes(key as keyof typeof LEGAL_CATEGORIES)).length}`);
  return [`PDF MASTER PRO JURÍDICO - ${result.reportName||"PDF TimeMachine Jurídico"}`,`Análise: ${new Date(result.createdAt).toLocaleString("pt-BR")}`,`Identificador: ${result.id}`,`Alterações detectadas: ${findings.length}${result.truncated?" (resultado parcial)":""}`,`Modo: ${modeLabels[result.options.mode]} · Sensibilidade: ${result.options.sensitivity==="all"?"Todas as alteracoes detectaveis":"Mudancas que merecem revisao"}`,"","DOCUMENTOS NA ORDEM INFORMADA",...result.documents.map((document,index)=>`${index+1}. ${result.labels[index]?.name||document.name} · arquivo: ${document.name}\nData informada pelo usuário: ${result.labels[index]?.date||"não informada"}\nSHA-256 (identifica os bytes, não comprova autenticidade): ${document.sha256}\nMetadados declarados pelo arquivo (editáveis, não comprovam autenticidade): ${JSON.stringify(document.metadata||{})}\nPáginas: ${document.pages.length} · Extração ${document.complete?"concluída":"parcial"}`),"","RESUMO POR CATEGORIA (uma alteração pode ter várias categorias)",...counts,"",...result.pairs.flatMap(pair=>[`VERSÃO ${pair.index+1} para ${pair.index+2}: ${pair.findings.length} alterações`,...pair.findings.flatMap((finding,index)=>[`${index+1}. ${finding.title}`,`${kinds[finding.kind]} · ${finding.categories.map(category=>LEGAL_CATEGORIES[category]).join(", ")} · confiança: ${confidenceLabels[finding.confidence]}`,finding.attention?"Alteração que merece revisão":"Alteração informativa",finding.explanation,`Revisão do usuário: ${reviewLabels[result.reviews?.[finding.id]?.status||"pending"]}`,`Observação do usuário: ${result.reviews?.[finding.id]?.note||"não informada"}`,"ANTES",evidenceText(finding.before,result),"DEPOIS",evidenceText(finding.after,result),""])]),legalAIReportText(result.aiReview,result.documents),"LIMITAÇÕES",...result.warnings,"","O relatório não substitui revisão profissional. Não é laudo de autenticidade, conclusão de fraude ou parecer jurídico."].join("\n");
}
const csvCell=(value:string)=>{const safe=/^[\s\uFEFF]*[=+\-@]/.test(value)||/^[\t\r\n]/.test(value)?"'"+value:value;return '"'+safe.replace(/"/g,'""')+'"';};
export function legalReportCsv(result:LegalResult) {
  const row=(values:string[])=>values.map(csvCell).join(";");
  return "\uFEFF"+[row(["Par de versões","Tipo","Categorias","Título","Arquivo anterior","Página anterior","Texto anterior","Arquivo atualizado","Página atualizada","Texto atualizado","Confiança","Observação","Revisão do usuário","Nota do usuário"]),...result.pairs.flatMap(pair=>pair.findings.map((finding:LegalFinding)=>row([`${pair.index+1} → ${pair.index+2}`,kinds[finding.kind],finding.categories.map(category=>LEGAL_CATEGORIES[category]).join(", "),finding.title,result.documents.find(document=>document.id===finding.before?.documentId)?.name||"",finding.before?String(finding.before.page):"",finding.before?.quote||"",result.documents.find(document=>document.id===finding.after?.documentId)?.name||"",finding.after?String(finding.after.page):"",finding.after?.quote||"",confidenceLabels[finding.confidence],finding.explanation,reviewLabels[result.reviews?.[finding.id]?.status||"pending"],result.reviews?.[finding.id]?.note||""]))),...legalAICsvRows(result.aiReview,result.documents).map(row),row(["Limitações",...result.warnings])].join("\r\n");
}
export async function legalReportDocx(result:LegalResult) {
  return new Uint8Array(await (await Packer.toBlob(new Document({sections:[{children:legalReportText(result).split("\n").map((text,index)=>new Paragraph(index===0?{text,heading:HeadingLevel.TITLE}:{text,spacing:{after:90}}))}]}))).arrayBuffer());
}
export async function legalReportPdf(result:LegalResult,fontBytes:Uint8Array) {
  return textReportPdf(legalReportText(result),fontBytes,`${result.reportName||"PDF TimeMachine Jurídico"} - Relatório de comparação`);
}
export async function textReportPdf(text:string,fontBytes:Uint8Array,title:string) {
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes,{subset:true});const supported=new Set(font.getCharacterSet());
  if([...text].some(char=>!/[\n\r\t]/.test(char)&&!supported.has(char.codePointAt(0)!)))throw Error("Há caracteres não suportados no PDF. Use DOCX ou TXT para preservar todo o conteúdo.");
  pdf.setTitle(title);pdf.setAuthor("PDF Master Pro");
  let page=pdf.addPage([595,842]),y=795;
  const draw=(row:string,size:number)=>{if(y<48){page=pdf.addPage([595,842]);y=795;}page.drawText(row,{x:40,y,font,size,color:size>9?rgb(.22,.2,.48):rgb(.12,.14,.18)});y-=size>9?size+8:14;};
  const lines=text.replace(/\r/g,"").replace(/\t/g,"    ").split("\n");
  for(const [index,line]of lines.entries()){const size=index===0?14:/^(VERSÃO |DOCUMENTOS |RESUMO POR |LIMITAÇÕES$|ANTES$|DEPOIS$)/.test(line)?10:9;let row="";for(const char of line){if(font.widthOfTextAtSize(row+char,size)>515){draw(row,size);row="";}row+=char;}draw(row,size);}
  const pages=pdf.getPages();pages.forEach((page,index)=>page.drawText(`PDF Master Pro | Página ${index+1} de ${pages.length}`,{x:40,y:22,font,size:7,color:rgb(.4,.4,.45)}));
  return pdf.save();
}
