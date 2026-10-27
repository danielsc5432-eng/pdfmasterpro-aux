import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from "pdf-lib";

export type PdfLine = { x1: number; y1: number; x2: number; y2: number; width: number; color: string };
export type PdfRect = { x: number; y: number; w: number; h: number; strokeWidth: number; strokeColor: string; filled: boolean; fillColor: string | null };
export type PdfVectorPage = { lines: PdfLine[]; rects: PdfRect[] };

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

/** Aplica a matriz de transformação atual (CTM) a um ponto do PDF. */
function transform(x: number, y: number, m: number[]): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Multiplica duas matrizes 3x3 (representadas como [a,b,c,d,e,f]). */
function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

function parseContentStream(content: string, pageHeight: number): PdfVectorPage {
  const lines: PdfLine[] = [];
  const rects: PdfRect[] = [];

  // Tokeniza: números, nomes (/Name), literais de string e operadores.
  const tokens = content.match(/\/(?:[^\s/\[\]<>()]+)|(?:\[[^\]]*\])|(?:\([^)]*\))|(?:<[0-9a-fA-F\s]*>)|[^\s\[\]()<>]+/g) || [];

  let ctm: number[] = [...IDENTITY];
  const ctmStack: number[][] = [];
  let strokeColor: [number, number, number] = [0, 0, 0];
  let fillColor: [number, number, number] = [0, 0, 0];
  let lineWidth = 1;
  let operands: (number | string)[] = [];
  let path: { x: number; y: number }[] = [];
  let subpathStart = { x: 0, y: 0 };
  let currentPoint = { x: 0, y: 0 };
  let pendingRects: { x: number; y: number; w: number; h: number }[] = [];

  const num = (v: number | string | undefined, fallback = 0) => {
    const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
    return Number.isFinite(n) ? n : fallback;
  };

  // Converte do sistema de coordenadas PDF (origem inferior-esquerda, Y para cima)
  // para o sistema do DOCX (origem superior-esquerda, Y para baixo).
  const toDocX = (x: number, y: number): { x: number; y: number } => ({ x, y: pageHeight - y });

  const strokePath = () => {
    // Retângulos pendentes viram rects; segmentos viram lines.
    if (pendingRects.length) {
      for (const rect of pendingRects) {
        const tl = toDocX(...transform(rect.x, rect.y + rect.h, ctm));
        const br = toDocX(...transform(rect.x + rect.w, rect.y, ctm));
        rects.push({
          x: tl.x, y: tl.y, w: Math.abs(br.x - tl.x), h: Math.abs(br.y - tl.y),
          strokeWidth: lineWidth, strokeColor: toHex(...strokeColor), filled: false, fillColor: null,
        });
      }
      pendingRects = [];
    }
    for (let i = 0; i + 1 < path.length; i++) {
      const a = toDocX(...transform(path[i].x, path[i].y, ctm));
      const b = toDocX(...transform(path[i + 1].x, path[i + 1].y, ctm));
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: lineWidth, color: toHex(...strokeColor) });
    }
    path = [];
    pendingRects = [];
  };

  const fillPath = () => {
    if (pendingRects.length) {
      for (const rect of pendingRects) {
        const tl = toDocX(...transform(rect.x, rect.y + rect.h, ctm));
        const br = toDocX(...transform(rect.x + rect.w, rect.y, ctm));
        rects.push({
          x: tl.x, y: tl.y, w: Math.abs(br.x - tl.x), h: Math.abs(br.y - tl.y),
          strokeWidth: 0, strokeColor: "#000000", filled: true, fillColor: toHex(...fillColor),
        });
      }
    }
    path = [];
    pendingRects = [];
  };

  for (const token of tokens) {
    // Número
    if (/^[-+.\d]/.test(token)) {
      const n = Number.parseFloat(token);
      if (Number.isFinite(n)) { operands.push(n); continue; }
    }
    // Nome (/Name)
    if (token.startsWith("/")) { operands.push(token); continue; }

    // Operador
    switch (token) {
      case "q":
        ctmStack.push([...ctm]);
        break;
      case "Q":
        if (ctmStack.length) ctm = ctmStack.pop()!;
        break;
      case "cm": {
        const v = operands.slice(-6).map((o) => num(o));
        if (v.length === 6) ctm = multiply(v, ctm);
        break;
      }
      case "w":
        lineWidth = Math.abs(num(operands[operands.length - 1], 1));
        break;
      case "RG":
        strokeColor = [num(operands[operands.length - 3]), num(operands[operands.length - 2]), num(operands[operands.length - 1])];
        break;
      case "rg":
        fillColor = [num(operands[operands.length - 3]), num(operands[operands.length - 2]), num(operands[operands.length - 1])];
        break;
      case "G": {
        const v = num(operands[operands.length - 1]);
        strokeColor = [v, v, v];
        break;
      }
      case "g": {
        const v = num(operands[operands.length - 1]);
        fillColor = [v, v, v];
        break;
      }
      case "K": {
        const c = num(operands[operands.length - 4]); const m = num(operands[operands.length - 3]);
        const y = num(operands[operands.length - 2]); const k = num(operands[operands.length - 1]);
        strokeColor = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
        break;
      }
      case "k": {
        const c = num(operands[operands.length - 4]); const m = num(operands[operands.length - 3]);
        const y = num(operands[operands.length - 2]); const k = num(operands[operands.length - 1]);
        fillColor = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
        break;
      }
      case "m": {
        currentPoint = { x: num(operands[operands.length - 2]), y: num(operands[operands.length - 1]) };
        subpathStart = { ...currentPoint };
        path = [currentPoint];
        pendingRects = [];
        break;
      }
      case "l":
        currentPoint = { x: num(operands[operands.length - 2]), y: num(operands[operands.length - 1]) };
        path.push(currentPoint);
        break;
      case "c": {
        // Curva bézier: aproxima pelo ponto final.
        currentPoint = { x: num(operands[operands.length - 2]), y: num(operands[operands.length - 1]) };
        path.push(currentPoint);
        break;
      }
      case "v": case "y":
        currentPoint = { x: num(operands[operands.length - 2]), y: num(operands[operands.length - 1]) };
        path.push(currentPoint);
        break;
      case "h":
        if (path.length) path.push({ ...subpathStart });
        break;
      case "re": {
        const x = num(operands[operands.length - 4]);
        const y = num(operands[operands.length - 3]);
        const w = num(operands[operands.length - 2]);
        const h = num(operands[operands.length - 1]);
        pendingRects.push({ x, y, w, h });
        // Como path: adiciona os 4 cantos para o caso de stroke em conjunto com path.
        path.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y });
        break;
      }
      case "S": case "s":
        strokePath();
        break;
      case "f": case "F": case "f*":
        fillPath();
        break;
      case "B": case "B*": case "b": case "b*":
        fillPath();
        // B também faz stroke, mas fillPath já limpou; para retângulos com B, o stroke é fino.
        break;
      case "n":
        path = [];
        pendingRects = [];
        break;
      case "W": case "W*":
        // Clipping: ignorado.
        break;
      default:
        break;
    }
    operands = [];
  }

  // Remove linhas degeneradas e excesso de shapes.
  const cleanLines = lines.filter((l) => Math.abs(l.x1 - l.x2) + Math.abs(l.y1 - l.y2) > 0.5).slice(0, 2000);
  const cleanRects = rects.filter((r) => r.w > 1 && r.h > 1).slice(0, 1000);
  return { lines: cleanLines, rects: cleanRects };
}

function readContentStream(page: { node: { Contents(): unknown; context: { lookup(ref: unknown): unknown } } }): string {
  try {
    const contents = page.node.Contents() as PDFStream | PDFArray | null;
    if (!contents) return "";
    const streams: PDFStream[] = contents instanceof PDFArray
      ? contents.asArray().map((ref) => page.node.context.lookup(ref) as PDFStream).filter((s): s is PDFStream => s instanceof PDFStream)
      : [contents as PDFStream];
    const parts: string[] = [];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const filter = stream.dict.get(PDFName.of("Filter"));
      if (!filter) {
        parts.push(Buffer.from(stream.getContents()).toString("latin1"));
        continue;
      }
      const decoded = decodePDFRawStream(stream).decode();
      parts.push(Buffer.from(decoded).toString("latin1"));
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

/**
 * Extrai linhas e retângulos dos content streams de cada página do PDF.
 * Converte as coordenadas para o sistema do DOCX (origem superior-esquerda).
 */
export async function extractPdfVectors(input: Uint8Array): Promise<PdfVectorPage[]> {
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true });
    const pages: PdfVectorPage[] = [];
    for (let index = 0; index < doc.getPageCount(); index++) {
      const page = doc.getPage(index);
      const { height } = page.getSize();
      const content = readContentStream(page as never);
      pages.push(content ? parseContentStream(content, height) : { lines: [], rects: [] });
    }
    return pages;
  } catch {
    return [];
  }
}

// ─── Geração de formas VML para DOCX ────────────────────────────────────────

// O espaço de coordenadas de `from`/`to` (e de `coordsize`) do VML é medido em
// pixels de 96 dpi, enquanto as dimensões do `style` são em pontos. Sem esta
// conversão o Word desenha cada forma com apenas 3/4 do tamanho real (os
// traços ficavam truncados antes de cada borda vertical da tabela).
const PT_TO_PX = 96 / 72;

function vmlLine(line: PdfLine, id: string, offsetX: number, offsetY: number): string {
  const x1 = Math.min(line.x1, line.x2);
  const y1 = Math.min(line.y1, line.y2);
  const w = Math.abs(line.x2 - line.x1);
  const h = Math.abs(line.y2 - line.y1);
  const fromX = line.x1 <= line.x2 ? 0 : w;
  const fromY = line.y1 <= line.y2 ? 0 : h;
  const toX = line.x1 <= line.x2 ? w : 0;
  const toY = line.y1 <= line.y2 ? h : 0;
  const weight = Math.max(0.25, line.width || 0.5);
  return (
    `<v:line id="${id}" style="position:absolute;` +
    `margin-left:${(x1 - offsetX).toFixed(1)}pt;margin-top:${(y1 - offsetY).toFixed(1)}pt;` +
    `width:${w.toFixed(1)}pt;height:${h.toFixed(1)}pt;z-index:251659264;` +
    `mso-position-horizontal-relative:page;mso-position-vertical-relative:page" ` +
    `from="${(fromX * PT_TO_PX).toFixed(1)},${(fromY * PT_TO_PX).toFixed(1)}" ` +
    `to="${(toX * PT_TO_PX).toFixed(1)},${(toY * PT_TO_PX).toFixed(1)}" ` +
    `strokecolor="${line.color}" strokeweight="${weight.toFixed(1)}pt"/>`
  );
}

function vmlRect(rect: PdfRect, id: string, offsetX: number, offsetY: number): string {
  const weight = Math.max(0.25, rect.strokeWidth || 0.5);
  const fillAttr = rect.filled && rect.fillColor ? `fillcolor="${rect.fillColor}"` : `fillcolor="none"`;
  return (
    `<v:rect id="${id}" style="position:absolute;` +
    `margin-left:${(rect.x - offsetX).toFixed(1)}pt;margin-top:${(rect.y - offsetY).toFixed(1)}pt;` +
    `width:${rect.w.toFixed(1)}pt;height:${rect.h.toFixed(1)}pt;z-index:251659264;` +
    `mso-position-horizontal-relative:page;mso-position-vertical-relative:page" ` +
    `strokecolor="${rect.strokeColor}" strokeweight="${weight.toFixed(2)}pt" ${fillAttr}/>`
  );
}

/**
 * Gera os runs VML (linhas/retângulos) de uma página. Cada forma vai no seu
 * próprio `<w:pict>`: o Word trata cada `w:pict` como um objeto independente;
 * juntar tudo num único pict fazia o Word descartar/deslocar as formas.
 */
export function buildShapesRun(vp: PdfVectorPage, pageIndex = 0, offsetX = 0, offsetY = 0): string {
  const shapes: string[] = [];
  let id = 0;
  const next = () => `vln${pageIndex}_${id++}`;
  for (const rect of vp.rects.filter((r) => r.filled)) shapes.push(vmlRect(rect, next(), offsetX, offsetY));
  for (const rect of vp.rects.filter((r) => !r.filled)) shapes.push(vmlRect(rect, next(), offsetX, offsetY));
  for (const line of vp.lines) shapes.push(vmlLine(line, next(), offsetX, offsetY));
  if (!shapes.length) return "";
  return shapes
    .map((shape) => `<w:r><w:rPr><w:noProof/></w:rPr><w:pict>${shape}</w:pict></w:r>`)
    .join("");
}

/**
 * Injeta formas VML (linhas/retângulos extraídos do PDF) no `document.xml`
 * já gerado pela lib docx. Cada página do PDF corresponde a uma seção do DOCX.
 * As formas são inseridas como `<w:pict>` dentro do primeiro parágrafo de cada
 * seção, evitando criar parágrafos extras que desloquem o conteúdo.
 */
export function injectVectorShapes(documentXml: string, vectors: PdfVectorPage[]): string {
  if (!vectors.length) return documentXml;

  const bodyOpen = "<w:body>";
  const bodyClose = "</w:body>";
  const bodyStart = documentXml.indexOf(bodyOpen);
  const bodyEnd = documentXml.indexOf(bodyClose);
  if (bodyStart < 0 || bodyEnd < 0) return documentXml;

  let prefix = documentXml.substring(0, bodyStart + bodyOpen.length);
  const bodyContent = documentXml.substring(bodyStart + bodyOpen.length, bodyEnd);
  const suffix = documentXml.substring(bodyEnd);

  // Garante namespace VML no elemento raiz, se ausente.
  if (!prefix.includes("xmlns:v=")) {
    prefix = prefix.replace("<w:document", '<w:document xmlns:v="urn:schemas-microsoft-com:vml"');
  }

  // Divide o corpo em seções. Cada seção termina num </w:p> que contém <w:sectPr>,
  // exceto a última cujo <w:sectPr> pode estar direto em <w:body>.
  const sections: string[] = [];
  let pos = 0;
  while (pos < bodyContent.length) {
    const sectPrPos = bodyContent.indexOf("<w:sectPr", pos);
    if (sectPrPos < 0) {
      const rest = bodyContent.substring(pos);
      if (rest.trim()) sections.push(rest);
      break;
    }
    const closePPos = bodyContent.indexOf("</w:p>", sectPrPos);
    if (closePPos < 0) {
      const rest = bodyContent.substring(pos);
      if (rest.trim()) sections.push(rest);
      break;
    }
    const sectionEnd = closePPos + "</w:p>".length;
    sections.push(bodyContent.substring(pos, sectionEnd));
    pos = sectionEnd;
  }

  // Para cada seção, injeta os runs VML no primeiro <w:r>...</w:r> encontrado.
  const result = sections
    .map((section, index) => {
      const vp = vectors[index];
      if (!vp || (!vp.lines.length && !vp.rects.length)) return section;
      // As formas VML são posicionadas em relação ao parágrafo que as contém
      // (o Word ignora mso-position-*-relative:page nesse caso). Como injetamos
      // no primeiro parágrafo — que tem um frame posicionado — compensamos o
      // deslocamento (x, y) do frame para que as formas caiam na posição exata.
      const firstRun = section.indexOf("<w:r>");
      const { x: offsetX, y: offsetY } = firstRun >= 0 ? enclosingFrameOffset(section, firstRun) : { x: 0, y: 0 };
      const shapesRun = buildShapesRun(vp, index, offsetX, offsetY);
      if (!shapesRun) return section;
      if (firstRun >= 0) return section.substring(0, firstRun) + shapesRun + section.substring(firstRun);
      // Sem <w:r>: cria um parágrafo mínimo com as formas.
      return (
        `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr>` +
        `${shapesRun}</w:p>` + section
      );
    })
    .join("");

  return prefix + result + suffix;
}

/** Extrai o deslocamento (em pt) do frame do parágrafo que contém a posição dada. */
function enclosingFrameOffset(section: string, position: number): { x: number; y: number } {
  const paragraphStart = section.lastIndexOf("<w:p>", position);
  const start = paragraphStart >= 0 ? paragraphStart : 0;
  const scope = section.substring(start, position);
  const frame = scope.match(/<w:framePr\b[^>]*>/);
  if (!frame) return { x: 0, y: 0 };
  const x = frame[0].match(/w:x="(-?\d+)"/);
  const y = frame[0].match(/w:y="(-?\d+)"/);
  return { x: x ? Number.parseInt(x[1], 10) / 20 : 0, y: y ? Number.parseInt(y[1], 10) / 20 : 0 };
}
