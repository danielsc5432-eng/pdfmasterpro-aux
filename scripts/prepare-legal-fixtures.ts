import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { execFile } from "../lib/processing/system";
const root=path.resolve(".vercel/review/legal");
async function pdf(name:string,pages:string[][],stamp=false){
  const document=await PDFDocument.create();const font=await document.embedFont(StandardFonts.Helvetica);
  for(const lines of pages){const page=document.addPage([595,842]);lines.forEach((line,index)=>page.drawText(line,{x:40,y:770-index*60,size:12,font}));if(stamp)page.drawRectangle({x:380,y:150,width:140,height:90,color:rgb(.2,.1,.8)});}
  const bytes=await document.save();await writeFile(path.join(root,name),bytes);return bytes;
}
async function main(){
await mkdir(root,{recursive:true});
const cnjBase="12345672026826010000";let cnjRemainder=0;for(const digit of cnjBase)cnjRemainder=(cnjRemainder*10+Number(digit))%97;const cnj=`1234567-${String(98-cnjRemainder).padStart(2,"0")}.2026.8.26.0100`;
await pdf("suite-contrato.pdf",[["Contrato de prestação de serviços",`Processo: ${cnj}`,"Contratante: Maria Silva","Cláusula 1 - Objeto: serviços técnicos.","Cláusula 2 - Valor R$ 2.500,00 e multa de 10%.","Cláusula 3 - A contratada deverá entregar em 15 dias úteis.","Cláusula 4 - Rescisão mediante aviso. Renovação automática.","Data: 30/11/2026. Aviso com trinta dias corridos."]]);
await pdf("suite-processo.pdf",[[`Processo: ${cnj}`,"Sentença em 10/12/2026.","Audiência em 5 de novembro de 2026.","Juntada de documentos sem data.","Intimação de 10/11/26.","Prazo de 15 dias úteis a partir da intimação.","Data inválida: 31/04/2026."]]);
const repeated="A parte requerente apresentou os documentos anexos e solicitou análise dos fatos narrados.";
await pdf("suite-peticao.pdf",[["Excelentíssimo Senhor Juiz", "1. DOS FATOS",repeated,"3. DOS PEDIDOS","Conforme item 9 e art. 5 da Lei 8.078/1990.",repeated]]);
await pdf("suite-vazio.pdf",[[]]);
const original=[["Contratante: Maria Silva","Clausula 1 - Valor total de R$ 1.200,00.","Clausula 2 - Multa de 2%.","Clausula 3 - Prazo de 12 meses, ate 25/10/2026."],["Clausula 4 - A contratada deve entregar o relatorio.","Clausula 5 - As partes devem preservar os documentos."]];
const updated=[["Anexo adicional - Conferir os dados antes de assinar."],["Contratante: Joana Santos","Clausula 1 - Valor total de R$ 2.500,00.","Clausula 2 - Multa de 10%."],["Clausula 5 - As partes devem preservar os documentos.","Clausula 3 - Prazo de 24 meses, ate 25/11/2026.","Clausula 6 - Rescisao mediante aviso por escrito."]];
const first=await pdf("original.pdf",original);await writeFile(path.join(root,"identico.pdf"),first);
await pdf("atualizado.pdf",updated);await pdf("versao-3.pdf",updated.map(lines=>lines.map(line=>line.replace("2.500,00","3.100,00").replace("10%","8%"))));
await pdf("visual.pdf",original,true);await pdf("extenso.pdf",Array.from({length:20},(_,index)=>[`Clausula ${index+1} - Registro de obrigacao ${index+1}.`,`Valor total: R$ ${index+1}.200,00.`,`Prazo: 12 meses. Data: 25/10/2026.`]));
for(const [name,quantity,value]of [["tabela-original.pdf","3","R$ 1.200,00"],["tabela-atualizada.pdf","4","R$ 2.500,00"]]){const document=await PDFDocument.create();const font=await document.embedFont(StandardFonts.Helvetica);const page=document.addPage([595,842]);for(const [row,columns]of [["Produto","Quantidade","Valor"],["Servico A",quantity,value]].entries())columns.forEach((text,column)=>page.drawText(text,{x:[40,210,370][column],y:760-row*45,size:12,font}));await writeFile(path.join(root,name),await document.save());}
await writeFile(path.join(root,"corrompido.pdf"),"%PDF-1.7\nnot a valid document\n");
const python=process.env.PDF_TO_WORD_PYTHON||(process.platform==="win32"?path.resolve(".vercel/tools/pdf2docx-venv/Scripts/python.exe"):"python3");
await execFile(python,["-c","import fitz,sys;d=fitz.open(sys.argv[1]);d[0].get_pixmap(matrix=fitz.Matrix(2,2)).save(sys.argv[2]);d.save(sys.argv[3],encryption=fitz.PDF_ENCRYPT_AES_256,owner_pw='owner-test',user_pw='synthetic-test');d[0].get_pixmap(matrix=fitz.Matrix(.12,.12)).save(sys.argv[4])",path.join(root,"original.pdf"),path.join(root,"scan.png"),path.join(root,"protegido.pdf"),path.join(root,"baixa-qualidade.png")],{timeout:30000,windowsHide:true});
await execFile(python,["-c","import fitz,sys;d=fitz.open(sys.argv[1]);d[0].get_pixmap(matrix=fitz.Matrix(4.17,4.17)).save(sys.argv[2])",path.join(root,"original.pdf"),path.join(root,"scan-300dpi.png")],{timeout:30000,windowsHide:true});
for(const [file,imageFile]of [["digitalizado.pdf","scan.png"],["digitalizado-300dpi.pdf","scan-300dpi.png"],["ocr-baixa-qualidade.pdf","baixa-qualidade.png"]]){const document=await PDFDocument.create();const image=await document.embedPng(await readFile(path.join(root,imageFile)));document.addPage([595,842]).drawImage(image,{x:0,y:0,width:595,height:842});await writeFile(path.join(root,file),await document.save());}
console.log("Legal fixtures: real PDFs with known text, financial/date changes, moved clauses, inserted page, scans, visual stamp, long contract, corrupt and encrypted files.");

}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
