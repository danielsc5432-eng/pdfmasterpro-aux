import { normalized, similarity } from "../divergences/normalize";
import { clauseKey, textKey } from "./structure";
import { evidenceFor, legalEvidenceValid, LEGAL_LIMITS, validateLegalOptions, type Box, type LegalBlock, type LegalCategory, type LegalDocument, type LegalEvidence, type LegalFinding, type LegalOptions, type LegalPair, type LegalResult, type PageLink, type VersionLabel } from "./types";

const tokens = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map(match => textKey(match[0])).join("|");
export function classifyChange(before: string, after: string, block?: LegalBlock): LegalCategory[] {
  const categories: LegalCategory[] = [];
  const changed = (pattern: RegExp) => tokens(before, pattern) !== tokens(after, pattern);
  if (changed(/(?:R\$|US\$|USD|BRL|EUR|GBP|€|£|¥|\$)\s*[+-]?\d[\d.,]*|\d[\d.,]*\s*(?:reais|dólares|euros)\b/gi)) categories.push("money");
  if (changed(/\d+(?:[.,]\d+)?\s*%/g)) categories.push("percent");
  if (changed(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\b/gi)) categories.push("date");
  if (changed(/\b\d+(?:[.,]\d+)?\s*(?:dias?(?:\s+úteis)?|meses|mês|anos?|horas?)\b/gi)) categories.push("deadline");
  if (changed(/\b\d+(?:[.,]\d+)?\s*(?:unidades?|itens|peças?|parcelas?)\b|\bquantidade\s*:\s*\d+(?:[.,]\d+)?/gi)) categories.push("quantity");
  if (/\b(?:contratante|contratad[oa]|beneficiári[oa]|responsável|nome|partes?|empresa)\s*:/i.test(before + "\n" + after)) categories.push("party");
  if (clauseKey(before) || clauseKey(after)) categories.push("clause");
  if (block?.table) categories.push("table");
  return categories.length ? categories : ["text"];
}
function words(text: string) { return [...new Set(normalized(text).match(/[a-z]{3,}/g) || [])].slice(0, 80); }
export function alignBlocks(one: LegalBlock[], two: LegalBlock[]) {
  const matches: { left: number; right: number }[] = [], used = new Set<number>();
  const exact = new Map<string, number[]>(); const clauses = new Map<string, number[]>(); const fields = new Map<string, number[]>(); const inverted = new Map<string, number[]>();
  const fieldKey=(block:LegalBlock)=>{if(block.table&&block.text.includes("\t"))return "linha-tabela:"+normalized(block.text.split("\t")[0]);const match=block.text.match(/^([^:\n]{2,80}):/);return match?normalized(match[1]):undefined;};
  two.forEach((block, index) => {
    const key = textKey(block.text); exact.set(key, [...(exact.get(key) || []), index]);
    if (block.clause) clauses.set(block.clause, [...(clauses.get(block.clause) || []), index]);
    const field=fieldKey(block);if(field)fields.set(field,[...(fields.get(field)||[]),index]);
    for (const word of words(block.text)) inverted.set(word, [...(inverted.get(word) || []), index]);
  });
  const unpaired: number[] = [];
  one.forEach((block, left) => {
    const candidates = exact.get(textKey(block.text))?.filter(index => !used.has(index)) || [];
    if (candidates.length) { const right = candidates.sort((a,b) => Math.abs(a-left)-Math.abs(b-left))[0]; used.add(right); matches.push({ left, right }); }
    else unpaired.push(left);
  });
  const remaining: number[] = [];
  for (const left of unpaired) {
    const block = one[left]; const same = block.clause ? clauses.get(block.clause)?.filter(index => !used.has(index)) || [] : [];
    // Duplicated clause numbers are ambiguous; do not force a match by title alone.
    if (same.length === 1 && one.filter(other => other.clause === block.clause).length === 1) { used.add(same[0]); matches.push({ left, right: same[0] }); }
    else {const key=fieldKey(block),sameField=key?fields.get(key)?.filter(index=>!used.has(index))||[]:[];if(sameField.length===1&&one.filter(other=>fieldKey(other)===key).length===1){used.add(sameField[0]);matches.push({left,right:sameField[0]});}else remaining.push(left);}
  }
  const unmatched: number[] = [];
  for (const left of remaining) {
    const votes = new Map<number,number>();
    for (const word of words(one[left].text)) for (const index of inverted.get(word) || []) if (!used.has(index)) votes.set(index, (votes.get(index) || 0) + 1);
    const ranked = [...votes].sort((a,b) => b[1]-a[1]).slice(0,24).map(([right]) => ({ right, score: similarity(one[left].text, two[right].text) })).sort((a,b) => b.score-a.score || Math.abs(a.right-left)-Math.abs(b.right-left));
    const best = ranked[0];
    if (best && best.score >= .62 && (!ranked[1] || best.score - ranked[1].score >= .08)) { used.add(best.right); matches.push({ left, right: best.right }); } else unmatched.push(left);
  }
  return { matches: matches.sort((a,b) => a.left-b.left), removed: unmatched, added: two.map((_,i) => i).filter(index => !used.has(index)) };
}
function pageEvidence(document: LegalDocument, page: number, box?: Box): LegalEvidence { const source = document.pages[page-1]; return { documentId: document.id, page, quote: "", box: box || [0,0,source.width,source.height] }; }
export function comparePixels(one: Uint8Array, two: Uint8Array, sensitivity: LegalOptions["sensitivity"]) {
  if (!one.length || one.length !== two.length) return null;
  const width = 96; let changed = 0, x1 = width, y1 = one.length / width, x2 = 0, y2 = 0;
  for (let i = 0; i < one.length; i++) if (Math.abs(one[i] - two[i]) > (sensitivity === "all" ? 12 : 25)) { changed++; const x = i % width, y = Math.floor(i / width); x1=Math.min(x1,x); y1=Math.min(y1,y); x2=Math.max(x2,x+1); y2=Math.max(y2,y+1); }
  const ratio = changed / one.length;
  return ratio > (sensitivity === "all" ? .002 : .01) ? { ratio, box: [x1/width,y1/(one.length/width),x2/width,y2/(one.length/width)] as Box } : null;
}
export function compareLegalPair(left: LegalDocument, right: LegalDocument, options: LegalOptions, pair: number): LegalPair {
  const one = left.pages.flatMap(page => page.blocks), two = right.pages.flatMap(page => page.blocks);
  const logicalText=textKey(one.map(block=>block.text).join(" "));
  const sameLogicalText=!!logicalText&&left.complete&&right.complete&&logicalText===textKey(two.map(block=>block.text).join(" "));
  const alignment = alignBlocks(one,two); const findings: LegalFinding[] = [], warnings: string[] = [];
  const add = (finding: Omit<LegalFinding,"id"|"pair">) => { if (findings.length < LEGAL_LIMITS.findings) findings.push({ ...finding, pair, id: `pair${pair}-change${findings.length+1}` }); };
  const links: PageLink[] = [], linkedRight = new Set<number>();
  const key = (document: LegalDocument, page: number) => document.pages[page-1].blocks.map(block => textKey(block.text)).join("\n");
  for (const page of left.pages) {
    const content = key(left,page.number);
    const match = right.pages.find(other => !linkedRight.has(other.number) && content && key(right,other.number) === content);
    if (match) { links.push({ before: page.number, after: match.number, basis: "text" }); linkedRight.add(match.number); }
  }
  for (const page of left.pages.filter(page=>!links.some(link=>link.before===page.number))) {
    const match=right.pages.find(other=>!linkedRight.has(other.number)&&(!page.blocks.length||!page.readable)&&(!other.blocks.length||!other.readable)&&page.signature.length>0&&page.signature.length===other.signature.length&&page.signature.every((value,index)=>value===other.signature[index]));
    if(match){links.push({before:page.number,after:match.number,basis:"image"});linkedRight.add(match.number);}
  }
  for (const page of left.pages.filter(page => !links.some(link => link.before === page.number))) {
    const votes = new Map<number,number>();
    for (const match of alignment.matches) if (one[match.left].page === page.number) votes.set(two[match.right].page, (votes.get(two[match.right].page) || 0)+1);
    const candidate = [...votes].filter(([number]) => !linkedRight.has(number)).sort((a,b) => b[1]-a[1])[0];
    if (candidate) { links.push({ before: page.number, after: candidate[0], basis: "blocks" }); linkedRight.add(candidate[0]); }
    else if (left.pages.length === right.pages.length && !linkedRight.has(page.number)) { links.push({ before: page.number, after: page.number, basis: "position" }); linkedRight.add(page.number); }
  }
  const allowed = (categories: LegalCategory[]) => categories.some(category => options.categories.includes(category));
  if (options.mode === "text" || options.mode === "complete" || options.mode === "structure") {
    for (const match of alignment.matches) {
      const before = one[match.left], after = two[match.right];
      const reversed = alignment.matches.some(other => other.left < match.left && other.right > match.right || other.left > match.left && other.right < match.right);
      const moved = reversed || before.page !== after.page;
      const same = textKey(before.text) === textKey(after.text);
      if (same) {
        if (moved && options.mode !== "text" && allowed(["movement"])) add({ kind: "moved", categories: ["movement"], title: before.clause ? `Cláusula ${before.clause} movida` : "Trecho com posição alterada", explanation: "O texto extraído é igual, mas sua ordem ou página mudou. Não foi tratado como exclusão seguida de inclusão.", attention: false, confidence: before.ocr || after.ocr ? "medium" : "high", before: evidenceFor(left,before), after: evidenceFor(right,after) });
        continue;
      }
      if(sameLogicalText)continue;
      const categories = classifyChange(before.text,after.text,before.table ? before : after);
      if (!allowed(categories) || (options.mode === "structure" && !categories.some(category => ["clause","table"].includes(category)))) continue;
      if (options.sensitivity === "relevant" && normalized(before.text) === normalized(after.text)) continue;
      add({ kind: "modified", categories, title: before.clause ? `Cláusula ${before.clause}: redação alterada` : "Conteúdo alterado", explanation: `${moved ? "O trecho também mudou de posição. " : ""}Diferença verificada no texto extraído; confira o contexto e as fontes. A detecção não determina ilegalidade, fraude ou abuso.`, attention: true, confidence: Math.min(before.confidence ?? 100,after.confidence ?? 100) < 70 ? "low" : before.ocr || after.ocr ? "medium" : "high", before: evidenceFor(left,before), after: evidenceFor(right,after) });
    }
    for (const [kind, indices, document, other, blocks] of [["removed",alignment.removed,left,right,one],["added",alignment.added,right,left,two]] as const) for (const index of indices) {
      if(sameLogicalText)continue;
      const block = blocks[index]; const categories = classifyChange(kind === "removed" ? block.text : "",kind === "added" ? block.text : "",block);
      if (!allowed(categories) || (options.mode === "structure" && !block.clause && !block.table)) continue;
      const verified = other.complete;
      add({ kind: verified ? kind : "unverified", categories, title: !verified ? "Correspondência não verificada" : block.clause ? `Cláusula ${block.clause} ${kind === "added" ? "incluída" : "não localizada"}` : `Trecho ${kind === "added" ? "incluído" : "não localizado"}`, explanation: verified ? "Trecho sem correspondência pelos critérios de alinhamento. Uma reformulação extensa pode não ser reconhecida; confira as duas versões." : "A outra versão tem páginas sem texto analisável. Não é possível concluir inclusão ou exclusão.", attention: true, confidence: !verified || (block.confidence ?? 100) < 70 ? "low" : "medium", ...(kind === "removed" ? { before: evidenceFor(document,block) } : { after: evidenceFor(document,block) }) });
    }
  }
  if (options.mode !== "text" && allowed(["page"])) {
    const unlinkedLeft = left.pages.filter(page => !links.some(link => link.before === page.number));
    const unlinkedRight = right.pages.filter(page => !linkedRight.has(page.number));
    if (left.complete && right.complete && !sameLogicalText) {
      for (const page of unlinkedLeft) if (!alignment.matches.some(match => one[match.left].page === page.number)) add({ kind: "removed", categories: ["page"], title: `Página ${page.number} sem correspondência`, explanation: "Página sem correspondência textual no alinhamento. Mudanças extensas ou redistribuição podem impedir a correspondência.", attention: true, confidence: "medium", before: pageEvidence(left,page.number) });
      for (const page of unlinkedRight) if (!alignment.matches.some(match => two[match.right].page === page.number)) add({ kind: "added", categories: ["page"], title: `Página ${page.number} acrescentada no alinhamento`, explanation: "Página sem correspondência textual no alinhamento. Confira se é uma inclusão ou uma redistribuição de conteúdo.", attention: true, confidence: "medium", after: pageEvidence(right,page.number) });
    } else if(!left.complete||!right.complete) warnings.push("Há páginas sem texto analisável; ausência de texto não foi apresentada como exclusão de cláusula ou página.");
  }
  if(sameLogicalText&&(one.length!==two.length||left.pages.length!==right.pages.length)){
    warnings.push("O texto extraído coincide ao concatenar os blocos na ordem de leitura. Redistribuição entre páginas não foi apresentada como inclusão ou exclusão de texto; isso não comprova equivalência jurídica.");
    if(options.mode!=="text"&&allowed(["movement"]))add({kind:"moved",categories:["movement"],title:"Texto redistribuído entre páginas ou blocos",explanation:"O conteúdo textual concatenado é igual, mas a segmentação ou a quantidade de páginas mudou. Confira o layout e a ordem de leitura nos originais.",attention:false,confidence:"medium",before:pageEvidence(left,1),after:pageEvidence(right,1)});
  }
  if ((options.mode === "visual" || options.mode === "complete") && allowed(["visual"])) {
    if(links.length<Math.max(left.pages.length,right.pages.length))warnings.push("A comparação visual cobre apenas páginas alinhadas. Páginas sem correspondência não tiveram seus pixels comparados.");
    for (const link of links) {
      const before = left.pages[link.before-1], after = right.pages[link.after-1];
      const pixels = comparePixels(before.signature,after.signature,options.sensitivity);
      const resized=Math.abs(before.width-after.width)>1||Math.abs(before.height-after.height)>1;
      const change=pixels||(resized?{ratio:0,box:[0,0,1,1] as Box}:null);
      if (change) {
        const scale = (box: Box, width: number, height: number): Box => [box[0]*width,box[1]*height,box[2]*width,box[3]*height];
        add({ kind: "modified", categories: ["visual"], title: `Apresentação diferente: páginas ${before.number} e ${after.number}`, explanation: `${resized?`Dimensões alteradas de ${Math.round(before.width)} x ${Math.round(before.height)} para ${Math.round(after.width)} x ${Math.round(after.height)} pontos. `:""}Diferença em ${(change.ratio*100).toFixed(1)}% da amostra visual de baixa resolução. Não mede adulteração; renderização, fontes e deslocamentos também podem alterar a amostra.`, attention: true, confidence: link.basis === "position" ? "low" : "medium", before: pageEvidence(left,before.number,scale(change.box,before.width,before.height)), after: pageEvidence(right,after.number,scale(change.box,after.width,after.height)), visualRatio: change.ratio });
      }
    }
  }
  if (left.pages.length !== right.pages.length) {
    warnings.push(`Paginação: de ${left.pages.length} para ${right.pages.length} páginas. O alinhamento é aproximado quando o texto é redistribuído.`);
    if(options.mode!=="text"&&allowed(["page"])&&!findings.some(finding=>finding.categories.includes("page")))add({kind:"modified",categories:["page"],title:"Quantidade de páginas alterada",explanation:`A versão anterior tem ${left.pages.length} páginas e a atual tem ${right.pages.length}. Essa contagem não identifica quais páginas foram incluídas, removidas ou redistribuídas.`,attention:true,confidence:"high",before:pageEvidence(left,left.pages.length),after:pageEvidence(right,right.pages.length)});
  }
  return { index: pair, beforeId: left.id, afterId: right.id, links, findings, warnings };
}
export function compareLegalVersions(documents: LegalDocument[], labels: VersionLabel[], options: LegalOptions): LegalResult {
  validateLegalOptions(options);
  if (documents.length < 2 || documents.length > LEGAL_LIMITS.files || labels.length !== documents.length || new Set(documents.map(document => document.id)).size !== documents.length) throw Error("Envie de 2 a 4 versões com identificadores distintos.");
  if (documents.reduce((sum,document) => sum+document.pages.length,0) > LEGAL_LIMITS.pages || documents.some(document => !document.pages.length || document.pages.length > LEGAL_LIMITS.pagesPerFile || document.pages.flatMap(page => page.blocks).length > LEGAL_LIMITS.blocksPerFile || document.pages.flatMap(page => page.blocks).reduce((sum,block) => sum+block.text.length,0) > LEGAL_LIMITS.charactersPerFile)) throw Error("O conjunto excedeu os limites de páginas ou texto.");
  const pairs: LegalPair[] = []; let remaining = LEGAL_LIMITS.findings, truncated = false;
  for (let index=0;index<documents.length-1;index++) { const result=compareLegalPair(documents[index],documents[index+1],options,index); if (result.findings.length >= remaining) truncated=true; result.findings=result.findings.slice(0,remaining); remaining-=result.findings.length; pairs.push(result); }
  for (const finding of pairs.flatMap(pair => pair.findings)) for (const evidence of [finding.before,finding.after]) if (evidence && !legalEvidenceValid(evidence,documents)) throw Error("Uma evidência não corresponde ao documento extraído.");
  const now=Date.now();
  return { version:1,id:crypto.randomUUID(),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+30*60*1000).toISOString(),options,labels,documents,pairs,truncated,warnings:[...documents.flatMap(document=>document.warnings),...pairs.flatMap(pair=>pair.warnings),...(truncated?["Limite de 300 alterações atingido; o relatório é parcial."]:[]),"Correspondências são heurísticas. Revise os originais; este relatório não substitui revisão profissional e não comprova autenticidade ou equivalência jurídica."] };
}
