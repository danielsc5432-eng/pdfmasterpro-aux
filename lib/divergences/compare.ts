import { normalized, decimal, dateValue, similarity } from "./normalize";
import { ANALYSIS_LIMITS, evidenceAt, type AnalysisOptions, type Category, type Evidence, type Finding, type SourceDocument } from "./types";

type Field={key:string;label:string;category:Category;canonical:string;valid:boolean;context:string;evidence:Evidence};
const aliases:Record<string,string>={"valor total":"total","total geral":"total","montante total":"total","valor do contrato":"valor contrato","data de vencimento":"vencimento","nome completo":"nome","nome do beneficiario":"beneficiario","numero do contrato":"contrato","n do contrato":"contrato","numero contrato":"contrato"};
const scopes=/^(competencia|periodo|produto|versao|finalidade|referencia)$/;
const identity=/^(cpf|cnpj|contrato|matricula|codigo|identificador|referencia|processo|rg|inscricao)(\b| )/;
function keyOf(label:string){const clean=normalized(label).replace(/[º°]/g,"").replace(/\s+/g," ").replace(/[.:]+$/g,"").trim();return aliases[clean]??clean;}

export function fieldsOf(document:SourceDocument):Field[]{
  const fields:Field[]=[];let context="";
  for(const page of document.pages){
    if(page.needsOcr)continue;
    for(const line of page.lines){
      const text=line.text.trim();
      const clause=/^cl[aá]usula\s+([0-9ivxlcdm]+)(?:[.\s:–—-]+)(.+)$/i.exec(text);
      let match=/^(.{2,90}?)(?:\s*:\s*|\t+)(.{1,1500})$/.exec(text);
      if(!match)match=/^(Nome completo|Nome|CPF|CNPJ|Matrícula|Contrato|Total|Vencimento)\s+(.+)$/i.exec(text);
      if(clause){fields.push({key:`clausula ${clause[1].toLowerCase()}`,label:`Cláusula ${clause[1]}`,category:"clause",canonical:normalized(clause[2]),valid:true,context,evidence:evidenceAt(document,page,line,clause[2])});continue;}
      if(!match){
        if(text.length<90&&text===text.toUpperCase()&&/[A-ZÀ-Ý]/.test(text)&&!/[0-9]/.test(text))context=normalized(text);
        if(/^(pagamento|prazo|multa|rescis[aã]o|fica|dever[aá]|obriga)/i.test(text)){
          const tokens=normalized(text).match(/[a-z]+/g)??[];
          fields.push({key:"obrigacao:"+tokens.slice(0,3).join(" "),label:tokens.slice(0,3).join(" "),category:"clause",canonical:normalized(text),valid:true,context,evidence:evidenceAt(document,page,line)});
        }
        continue;
      }
      const label=match[1].trim(),value=match[2].trim(),key=keyOf(label);
      let category:Category="text",canonical=normalized(value),valid=true;
      if(identity.test(key)){category="identifier";canonical=/^(cpf|cnpj|rg)/.test(key)?value.replace(/\D/g,""):normalized(value).replace(/[\s./-]/g,"");}
      else if(/\b(nome|beneficiario|cliente|empresa|contratante|contratado|responsavel)\b/.test(key))category="name";
      else if(/\b(data|vencimento|inicio|termino|nascimento|assinatura)\b/.test(key)||/^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.]\d{1,2}[/.]\d{4}$/.test(value)){
        category="date";const parsed=dateValue(value);canonical=parsed??canonical;valid=Boolean(parsed);
      }else if(/\b(prazo|duracao)\b/.test(key)){
        category="date";canonical=normalized(value).replace(/\bdias?\b/g,"dia").replace(/\bmes(?:es)?\b/g,"mes").replace(/\banos?\b/g,"ano");
      }else if(/R\$|US\$|€|%/.test(value)||/\b(total|valor|saldo|salario|preco|percentual|taxa|montante)\b/.test(key)){
        category="value";const percent=value.includes("%");
        const currency=/US\$|USD/i.test(value)?"USD":/R\$|BRL/i.test(value)?"BRL":/€|EUR/i.test(value)?"EUR":"";
        const numeric=currency==="USD"?value.replace(/,(?=\d{3}(?:\D|$))/g,""):value;
        const parsed=decimal(numeric.replace(/%/g,""));canonical=parsed===null?canonical:currency+":"+parsed+(percent?"%":"");valid=parsed!==null;
      }
      fields.push({key,label,category,canonical,valid,context,evidence:evidenceAt(document,page,line,value)});
    }
  }
  return fields;
}

function enabled(category:Category,options:AnalysisOptions,label:string){
  if(options.modes.includes("general"))return true;
  if(options.modes.includes("values")&&(category==="value"||category==="date"))return true;
  if(options.modes.includes("identities")&&(category==="name"||category==="identifier"))return true;
  if(options.modes.includes("clauses")&&category==="clause")return true;
  if(options.modes.includes("custom")){
    const terms=normalized(options.custom).match(/[a-z]{3,}/g)??[];
    return terms.some(term=>normalized(label).includes(term));
  }
  return false;
}

export function compareDocuments(documents:SourceDocument[],options:AnalysisOptions):{findings:Finding[];warnings:string[];truncated:boolean}{
  const findings:Finding[]=[],warnings:string[]=[];
  const add=(finding:Omit<Finding,"id"|"origin">)=>{if(findings.length<ANALYSIS_LIMITS.maxFindings)findings.push({...finding,id:`finding-${findings.length+1}`,origin:"rules"});};
  const active=documents.filter(document=>!document.duplicateOf);
  const fields=new Map(active.map(document=>[document.id,fieldsOf(document)]));
  let truncated=false;
  for(let a=0;a<active.length;a++)for(let b=a+1;b<active.length;b++){
    const left=active[a],right=active[b],one=fields.get(left.id)!,two=fields.get(right.id)!;
    const documentIds=[left.id,right.id];
    const incompatibleScope=one.some(field=>scopes.test(field.key)&&two.some(other=>other.key===field.key&&other.canonical!==field.canonical));
    const contractMismatch=one.some(field=>field.key==="contrato"&&two.some(other=>other.key==="contrato"&&other.canonical!==field.canonical));
    if(incompatibleScope||contractMismatch)warnings.push(`${left.name} × ${right.name}: períodos, finalidades ou contratos diferentes. Diferenças dependentes desse contexto não foram tratadas como inconsistências.`);
    const commonIdentity=one.some(field=>field.category==="identifier"&&!scopes.test(field.key)&&field.canonical&&two.some(other=>other.key===field.key&&other.canonical===field.canonical));
    const keys=new Set([...one,...two].map(field=>field.key));
    for(const key of keys){
      if(findings.length>=ANALYSIS_LIMITS.maxFindings){truncated=true;break;}
      const xs=one.filter(field=>field.key===key),ys=two.filter(field=>field.key===key);
      if(xs.length>1||ys.length>1){warnings.push(`Campo repetido «${xs[0]?.label??ys[0]?.label}» em ${left.name} ou ${right.name}: comparação automática inconclusiva.`);continue;}
      const x=xs[0],y=ys[0],field=x??y;
      if((incompatibleScope||contractMismatch)&&field.category!=="identifier")continue;
      if(!x||!y){
        if(!options.modes.includes("general")&&!options.modes.includes("missing"))continue;
        const absent=x?right:left;
        if(!absent.complete){warnings.push(`Não foi possível concluir ausência de campos em ${absent.name}: extração parcial ou OCR necessário.`);continue;}
        if(incompatibleScope||contractMismatch)continue;
        add({category:"missing",classification:"missing",title:`Campo não localizado: ${field.label}`,explanation:"O campo aparece em uma fonte, mas não foi localizado pelo mesmo rótulo na outra. Pode existir com redação diferente; não significa que seja obrigatório.",confidence:"medium",documents:documentIds,evidence:[field.evidence],missingDocumentId:absent.id});continue;
      }
      if(!enabled(field.category,options,field.label))continue;
      if(x.canonical===y.canonical)continue;
      const sameContext=!x.context||!y.context||x.context===y.context;
      if(!sameContext){warnings.push(`Contextos diferentes no campo «${field.label}»: confira as seções originais.`);continue;}
      const ambiguousUnit=field.category==="value"&&(
        /^[A-Z]{3}:/.test(x.canonical)!==/^[A-Z]{3}:/.test(y.canonical)||x.canonical.endsWith("%")!==y.canonical.endsWith("%"));
      const valid=x.valid&&y.valid&&!ambiguousUnit;
      const textual=field.category==="clause"&&similarity(x.canonical,y.canonical)>.93;
      const objective=valid&&commonIdentity&&!incompatibleScope&&!contractMismatch&&["value","date","identifier"].includes(field.category);
      add({category:field.category,classification:!valid?"inconclusive":textual?"textual":objective?"objective":"possible",title:`${field.label}: informações diferentes`,explanation:!valid?"O formato de pelo menos um valor não foi reconhecido com segurança. Confira as evidências.":field.category==="clause"?"A redação mudou. A comparação textual não determina equivalência jurídica, fraude ou descumprimento.":objective?"O mesmo campo apresenta informações distintas em documentos com um identificador comum. A diferença de dados é objetiva; sua relevância depende da conferência humana.":"O mesmo rótulo apresenta conteúdos diferentes. A equivalência de objeto, versão e finalidade precisa ser conferida antes de concluir incompatibilidade.",confidence:objective?"high":valid?"medium":"low",documents:documentIds,evidence:[x.evidence,y.evidence]});
    }
  }
  if(options.modes.includes("custom"))warnings.push("A seleção personalizada usa palavras-chave de rótulos, sem interpretação livre de instruções. A IA opcional revisa somente pares de cláusulas já identificados.");
  return {findings,warnings:[...new Set(warnings)].slice(0,80),truncated};
}
