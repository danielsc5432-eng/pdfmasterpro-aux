import type { LegalAIReviewResult } from "./ai-shared";
import { evidenceFor, legalEvidenceValid, LEGAL_LIMITS, type LegalDocument, type LegalEvidence, type LegalBlock } from "./types";
import { LEGAL_SUITE, type LegalAnalysisSlug } from "./suite-config";

export type AnalysisItem={id:string;category:string;title:string;detail:string;evidence:LegalEvidence[];date?:string;literal?:string;attention:boolean};
export type OrganizedDocument={documentId:string;type:string;processes:string[];date:string;subject:string;parties:string[];path:string};
export type LegalAnalysis={tool:LegalAnalysisSlug;createdAt:string;documents:LegalDocument[];items:AnalysisItem[];warnings:string[];organized:OrganizedDocument[];truncated:boolean;aiReview?:LegalAIReviewResult};
export type DateMention={literal:string;iso?:string;warning?:string};
const MONTHS=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
export function dateMentions(text:string):DateMention[]{
  // CNJ identifiers contain dotted numbers that resemble dates but are not dates.
  text=text.replace(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g,match=>" ".repeat(match.length));
  const values:{index:number;literal:string;day:number;month:number;year:number;short:boolean}[]=[];
  for(const m of text.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/g))values.push({index:m.index!,literal:m[0],day:+m[1],month:+m[2],year:+m[3],short:m[3].length===2});
  const months=MONTHS.join("|");
  for(const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${months})\\s+de\\s+(\\d{4})\\b`,"gi")))values.push({index:m.index!,literal:m[0],day:+m[1],month:MONTHS.indexOf(m[2].toLowerCase())+1,year:+m[3],short:false});
  for(const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))values.push({index:m.index!,literal:m[0],day:+m[3],month:+m[2],year:+m[1],short:false});
  return values.sort((a,b)=>a.index-b.index).map(v=>{if(v.short)return {literal:v.literal,warning:"Ano com dois dígitos: século não presumido."};const d=new Date(Date.UTC(v.year,v.month-1,v.day));if(v.year<1000||d.getUTCFullYear()!==v.year||d.getUTCMonth()!==v.month-1||d.getUTCDate()!==v.day)return {literal:v.literal,warning:"Data inválida no calendário; confira o original."};return {literal:v.literal,iso:`${v.year}-${String(v.month).padStart(2,"0")}-${String(v.day).padStart(2,"0")}`};});
}
const DEADLINE=/\b(?:\d+(?:\s*\([^)\n]{1,35}\))?|(?:vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa)(?:\s+e\s+(?:um|uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove))?|um|uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|cem)\s+(?:horas?|dias?(?:\s+(?:úteis|corridos))?|semanas?|meses|mês|anos?)\b/gi;
const MONEY=/(?:R\$|US\$|€|£)\s*\d[\d.,]*(?:\s*(?:mil|milhões|milhão))?|\b\d+(?:[.,]\d+)?\s*%/g;
const EVENT=/\b(?:ajuizamento|ajuizad[ao]|distribuiç[ãa]o|distribuíd[ao]|protocolo|protocolad[ao]|citaç[ãa]o|citad[ao]|intimaç[ãa]o|intimad[ao]|audi[êe]ncia|senten[çc]a|decis[ãa]o|despacho|recurso|contestaç[ãa]o|juntada|pagamento|per[íi]cia|tr[âa]nsito em julgado)\b/i;
const normalize=(text:string)=>text.normalize("NFKC").replace(/\s+/g," ").trim().toLocaleLowerCase("pt-BR");
export function cnjValid(value:string){const digits=value.replace(/\D/g,"");if(digits.length!==20)return false;const base=digits.slice(0,7)+digits.slice(9)+"00";let rem=0;for(const digit of base)rem=(rem*10+Number(digit))%97;return Number(digits.slice(7,9))===98-rem;}
export function processNumbers(text:string){return [...new Set(text.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g)||[])];}
export function safePath(value:string){const safe=value.normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g,"-").replace(/\.{2,}/g,"-").replace(/[. ]+$/g,"").trim().slice(0,100)||"documento";return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)?"_"+safe:safe;}
export function uniqueOrganizedPaths(entries:{documentId:string;path:string}[]){const used=new Set<string>();return entries.map(entry=>{const parts=entry.path.split("/").map(safePath);const raw=parts.pop()!.replace(/\.pdf$/i,"");const folder=parts.join("/");let suffix=1, candidate="";do{candidate=(folder?folder+"/":"")+raw+(suffix===1?"":`-${suffix}`)+".pdf";suffix++;}while(used.has(candidate.toLowerCase()));used.add(candidate.toLowerCase());return {...entry,path:candidate};});}
export type OrganizationGroup="process"|"type"|"date"|"subject"|"party";
export function organizationPaths(result:LegalAnalysis,group:OrganizationGroup){
  if(!["process","type","date","subject","party"].includes(group))throw Error("Agrupamento inválido.");
  return Object.fromEntries(uniqueOrganizedPaths(result.organized.map(o=>{const name=result.documents.find(d=>d.id===o.documentId)!.name.replace(/\.pdf$/i,"");const folder=group==="date"?(o.date||"sem-data-mencionada"):group==="subject"?o.subject:group==="party"?(o.parties[0]||"parte-nao-identificada"):o.type;return {documentId:o.documentId,path:group==="process"?o.path:`${safePath(folder).slice(0,70)}/${safePath(name)}.pdf`};})).map(o=>[o.documentId,o.path]));
}
export function validateAnalysisDocuments(documents:LegalDocument[]){if(!documents.length||documents.length>LEGAL_LIMITS.files)throw Error("Envie de 1 a 4 PDFs.");if(new Set(documents.map(d=>d.id)).size!==documents.length)throw Error("Identificadores de documentos repetidos.");if(documents.reduce((s,d)=>s+d.bytes,0)>LEGAL_LIMITS.totalBytes||documents.reduce((s,d)=>s+d.pages.length,0)>LEGAL_LIMITS.pages)throw Error("Limite do conjunto excedido.");for(const d of documents)if(d.bytes>LEGAL_LIMITS.fileBytes||d.pages.length>LEGAL_LIMITS.pagesPerFile||d.pages.reduce((s,p)=>s+p.blocks.length,0)>LEGAL_LIMITS.blocksPerFile||d.pages.flatMap(p=>p.blocks).reduce((s,b)=>s+b.text.length,0)>LEGAL_LIMITS.charactersPerFile)throw Error("Limite do documento excedido.");}

export function analyzeLegalDocuments(tool:LegalAnalysisSlug,documents:LegalDocument[]):LegalAnalysis{
  if(!LEGAL_SUITE.some(t=>t.slug===tool))throw Error("Analisador desconhecido.");validateAnalysisDocuments(documents);
  const result:LegalAnalysis={tool,createdAt:new Date().toISOString(),documents,items:[],warnings:["Análise por regras locais; não usa modelo de IA e não substitui revisão profissional.","A ausência de um item nos resultados não comprova sua ausência no documento. OCR e padrões podem falhar.","Nenhuma data de vencimento processual é calculada. Datas são menções textuais, não fatos certificados."],organized:[],truncated:false};
  const add=(category:string,title:string,detail:string,evidence:LegalEvidence[],extra:Partial<AnalysisItem>={})=>{if(result.items.length>=LEGAL_LIMITS.findings){result.truncated=true;return;}if(!evidence.every(e=>legalEvidenceValid(e,documents)))throw Error("Evidência inconsistente.");result.items.push({id:`item-${result.items.length+1}`,category,title,detail,evidence,attention:false,...extra});};
  for(const document of documents){
    const blocks=document.pages.flatMap(p=>p.blocks),all=blocks.map(b=>b.text).join("\n"),ev=(b:LegalBlock)=>evidenceFor(document,b);
    result.warnings.push(...document.warnings.map(w=>`${document.name}: ${w}`));
    if(!document.complete)result.warnings.push(`${document.name}: extração parcial; itens não reconhecidos precisam de conferência manual.`);
    if(!blocks.length)result.warnings.push(`${document.name}: nenhum texto utilizável. Ative OCR para digitalizações; não é possível fazer análise textual sem texto.`);
    if(tool==="contractcheck-ai"){
      for(const b of blocks){if(b.clause)add("Cláusulas",`Cláusula / seção ${b.clause}`,"Estrutura reconhecida por numeração ou título; confira sua abrangência.",[ev(b)]);
        const amounts=[...b.text.matchAll(MONEY)].map(m=>m[0]);if(amounts.length)add("Valores",amounts.join(" · "),"Valores literais extraídos; não somados nem interpretados como dívida.",[ev(b)]);
        for(const m of b.text.matchAll(DEADLINE))add("Prazos",m[0],"Prazo escrito no contrato, sem cálculo de vencimento ou interpretação de validade.",[ev(b)],{literal:m[0]});
        if(/\b(?:dever[áa]|deverão|deve|devem|obriga(?:ç(?:[ãa]o|[õo]es)|(?:m)?-se|do|da)|compromete-se|respons[áa]vel|incumbe)(?![\p{L}\p{N}_])/iu.test(b.text))add("Obrigações","Possível obrigação", "Trecho sinalizado por termos de obrigação; a parte responsável deve ser conferida no contexto.",[ev(b)]);
        if(/\b(?:rescis[ãa]o|resilir|resolvido|den[úu]ncia|encerramento)\b/i.test(b.text))add("Rescisão","Condições de encerramento","Menção textual; não há avaliação de validade jurídica.",[ev(b)]);
        if(/\b(?:renovaç[ãa]o autom[áa]tica|multa|exclusividade|irrevog[áa]vel|garantia|foro|reajuste)\b/i.test(b.text))add("Revisão","Condição que merece conferência","Confira o alcance, os valores e as condições do trecho. A marcação não indica abusividade.",[ev(b)],{attention:true});
        for(const date of dateMentions(b.text))add("Datas",date.literal,date.warning||"Data expressamente mencionada no trecho.",[ev(b)],{date:date.iso,literal:date.literal,attention:!!date.warning});
      }
    }
    if(tool==="processo-timeline"||tool==="prazo-extractor")for(const b of blocks){
      const dates=dateMentions(b.text),event=b.text.match(EVENT)?.[0];
      for(const date of dates)add(date.iso?"Datas expressas":"Datas a conferir",tool==="processo-timeline"?`${date.literal} · ${event||"Menção de data"}`:date.literal,date.warning|| (tool==="processo-timeline"?"Data e possível evento no mesmo bloco. A relação entre eles deve ser confirmada, especialmente se houver várias datas.":"Data expressa. Não representa cálculo de vencimento."),[ev(b)],{date:date.iso,literal:date.literal,attention:!!date.warning||dates.length>1});
      if(tool==="processo-timeline"&&event&&!dates.length)add("Eventos sem data",event,"Possível evento processual sem data explícita neste bloco. Não recebeu data presumida.",[ev(b)],{attention:true});
      if(tool==="prazo-extractor")for(const m of b.text.matchAll(DEADLINE))add("Prazos relativos",m[0],`Referência relativa; ${/úteis/i.test(m[0])?"dias úteis expressos":/corridos/i.test(m[0])?"dias corridos expressos":"regime de contagem não informado neste prazo"}. Termo inicial e feriados não presumidos.`,[ev(b)],{literal:m[0],attention:true});
    }
    if(tool==="juris-organize"){
      const patterns:[string,RegExp][]=[["Sentença",/\bsentença\b/i],["Decisão",/\bdecisão\b/i],["Contrato",/\bcontrato\b/i],["Petição",/\bpetição|excelentíssimo|dos pedidos/i],["Procuração",/\bprocuraç[ãa]o\b/i],["Nota fiscal",/\bnota fiscal|danfe\b/i],["Comprovante",/\bcomprovante\b/i]];
      const heading=blocks.slice(0,3).map(b=>b.text).join("\n"),match=patterns.find(([,p])=>p.test(heading)),type=match?.[0]||"Não classificado";
      const processes=processNumbers(all),firstDate=blocks.flatMap(b=>dateMentions(b.text)).find(d=>d.iso)?.iso||"";
      const parties=blocks.filter(b=>/\b(?:autor|réu|requerente|requerido|contratante|contratada|outorgante)\s*:/i.test(b.text)).slice(0,6);
      const subject=blocks.find(b=>/\b(?:assunto|objeto)\s*:/i.test(b.text));
      const folder=processes.length===1&&cnjValid(processes[0])?processes[0]:processes.length>1?"multiplos-processos":"sem-processo-confirmado";
      result.organized.push({documentId:document.id,type,processes,date:firstDate,subject:subject?.text.slice(0,300)||"Não identificado",parties:parties.map(b=>b.text.slice(0,300)),path:`${folder}/${safePath(type)}/${safePath(document.name.replace(/\.pdf$/i,""))}.pdf`});
      add("Classificação",`${document.name} · ${type}`,"Tipo sugerido a partir dos primeiros blocos, sem certeza semântica. Data sugerida é a primeira menção válida, não a data de criação. Revise antes do ZIP.",blocks[0]?[ev(blocks[0])]:[],{attention:true});
      for(const process of processes){const source=blocks.find(b=>b.text.includes(process))!;add("Processos",process,cnjValid(process)?"Dígitos verificadores consistentes. Não comprova existência do processo.":"Dígitos verificadores inconsistentes; confira OCR e documento.",[ev(source)],{attention:!cnjValid(process)});}
      for(const b of [...parties,...(subject?[subject]:[])])add("Partes e assunto","Campo identificado por rótulo","Extração literal por rótulo; confirme os dados antes de organizar.",[ev(b)]);
      const duplicate=documents.find(d=>d.id!==document.id&&d.sha256===document.sha256);if(duplicate)add("Duplicados","Arquivos com os mesmos bytes",`SHA-256 igual ao arquivo ${duplicate.name}; nenhuma exclusão automática.`,[],{attention:true});
    }
    if(tool==="peticao-review"){
      const checklist:[string,RegExp][]=[["Endereçamento",/excelent[íi]ssim|ao ju[íi]zo|merit[íi]ssim/i],["Partes",/\b(?:autor|réu|requerente|requerido|qualificaç[ãa]o)\b/i],["Fatos",/\b(?:dos fatos|s[íi]ntese f[áa]tica|hist[óo]rico)\b/i],["Fundamentos",/\b(?:do direito|fundamentos|fundamentaç[ãa]o)\b/i],["Pedidos",/\b(?:dos pedidos|requerimentos|requer-se)\b/i],["Valor da causa",/valor da causa/i],["Fecho",/pede deferimento|termos em que/i]];
      for(const [label,re]of checklist){const b=blocks.find(b=>re.test(b.text));add("Estrutura",`${label}: ${b?"menção localizada":"não localizado pelos padrões"}`,b?"Checklist técnico por termos. Não confirma suficiência jurídica do conteúdo.":"Ausência no reconhecimento não significa que a seção seja obrigatória ou que a petição seja inválida.",b?[ev(b)]:[],{attention:!b});}
      const headings=new Map<string,LegalBlock>();const headingNumbers:number[]=[];
      for(const b of blocks){const m=b.text.match(/^\s*(?:item\s+)?(\d{1,3})(?:[.)\s—–-]+)\s*\S/i);if(m){if(headings.has(m[1]))add("Numeração",`Numeração ${m[1]} repetida`,"Pode representar subseções ou listas; confira a hierarquia.",[ev(headings.get(m[1])!),ev(b)],{attention:true});else headings.set(m[1],b);headingNumbers.push(+m[1]);}}
      for(const b of blocks){for(const ref of b.text.matchAll(/\b(?:item|t[óo]pico)\s+(\d{1,3})(?![\d.])/gi))if(!headings.has(ref[1]))add("Referências internas",`Referência a ${ref[0]} sem destino reconhecido`,"O destino não foi localizado nos títulos numerados reconhecidos. Pode estar em anexo ou fora do padrão.",[ev(b)],{attention:true});
        if(b.text.length>1400)add("Formatação","Bloco extenso","O bloco extraído tem mais de 1.400 caracteres. Confira legibilidade e segmentação; pode ser efeito da extração.",[ev(b)],{attention:true});
        const references=b.text.match(/\b(?:art(?:igo|\.)\s*\d+[\wº°.-]*|s[úu]mula\s+\d+|lei\s+(?:n[º°.]?\s*)?\d[\d./-]*)/gi);if(references)add("Referências legais",references.join(" · "),"Citações literais. Existência, vigência e aplicabilidade não verificadas; nenhuma jurisprudência gerada.",[ev(b)]);
      }
      const seen=new Map<string,LegalBlock>();for(const b of blocks){const key=normalize(b.text);if(key.length<80)continue;const previous=seen.get(key);if(previous)add("Repetições","Trecho repetido","Repetição literal após normalizar espaços e caixa. Pode ser intencional ou cabeçalho.",[ev(previous),ev(b)],{attention:true});else seen.set(key,b);}
      const numbers=[...new Set(headingNumbers)].sort((a,b)=>a-b);for(let i=1;i<numbers.length;i++)if(numbers[i]>numbers[i-1]+1)add("Numeração",`Salto entre ${numbers[i-1]} e ${numbers[i]}`,"Sequência reconhecida com intervalo; listas independentes podem explicar o salto.",[ev(headings.get(String(numbers[i]))!)],{attention:true});
      const processes=processNumbers(all);if(processes.length>1)add("Consistência","Mais de um número de processo",`Referências distintas: ${processes.join(" · ")}. Podem ser processos relacionados; confira.`,blocks.filter(b=>processes.some(p=>b.text.includes(p))).map(ev),{attention:true});
    }
  }
  const paths=uniqueOrganizedPaths(result.organized);result.organized=result.organized.map((entry,index)=>({...entry,path:paths[index].path}));
  if(tool==="processo-timeline")result.items.sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
  if(result.truncated)result.warnings.push("Limite de 300 registros atingido. Resultado parcial; refine ou divida os documentos.");
  return result;
}
