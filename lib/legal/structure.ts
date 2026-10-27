import { LEGAL_LIMITS, type LegalBlock, type LegalLine } from "./types";

export function textKey(text: string) { return text.normalize("NFKC").replace(/\s+/g, " ").trim(); }
export function clauseKey(text: string) {
  const match = text.match(/^(?:cl[áa]usula\s+|art(?:igo)?\.?\s*)(\d+(?:\.\d+)*|[ivxlcdm]+|primeira|segunda|terceira|quarta|quinta|sexta|s[ée]tima|oitava|nona|d[ée]cima)\b/i) || text.match(/^(\d+(?:\.\d+)*)(?:[.)]|\s*[-–—])\s+\S/i);
  if(match)return match[1].toLowerCase();
  const title=text.split("\n")[0].trim();
  if(title.length<90&&/^(?:DA|DO|DAS|DOS)\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]+$/.test(title))return title.toLowerCase();
  return undefined;
}
export function blocksFromLines(lines: LegalLine[], page: number, ocr = false, confidence?: number): LegalBlock[] {
  const blocks: LegalBlock[] = []; let current: LegalLine[] = [];
  const flush = () => {
    if (!current.length) return;
    const text = current.map(line => line.text).join("\n").trim();
    if (text) blocks.push({ id: `p${page}b${blocks.length + 1}`, page, text, box: [Math.min(...current.map(line => line.box[0])), Math.min(...current.map(line => line.box[1])), Math.max(...current.map(line => line.box[2])), Math.max(...current.map(line => line.box[3]))], clause: clauseKey(text), table: current.some(line => line.table), ocr, ...(confidence === undefined ? {} : { confidence }) });
    current = [];
  };
  for (const line of lines) {
    if (!line.text.trim()) { flush(); continue; }
    const previous = current.at(-1);
    if (previous && (clauseKey(line.text) || line.table || previous.table || line.box[1] - previous.box[3] > Math.max(8, (previous.box[3] - previous.box[1]) * .8) || current.reduce((sum, item) => sum + item.text.length, 0) + line.text.length > 1600)) flush();
    current.push(line);
  }
  flush();
  if (blocks.length > LEGAL_LIMITS.blocksPerFile) throw Error("Há blocos demais no documento. Compare menos páginas.");
  return blocks;
}
export function changedSpan(before: string, after: string) {
  const one=[...before],two=[...after];
  let prefix = 0; while (prefix < Math.min(one.length, two.length) && one[prefix] === two[prefix]) prefix++;
  let suffix = 0; while (suffix < Math.min(one.length, two.length) - prefix && one[one.length - 1 - suffix] === two[two.length - 1 - suffix]) suffix++;
  return { prefix: one.slice(0, prefix).join(""), before: one.slice(prefix, one.length - suffix).join(""), after: two.slice(prefix, two.length - suffix).join(""), suffix: suffix ? one.slice(-suffix).join("") : "" };
}
