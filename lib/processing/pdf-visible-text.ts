import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";

type Matrix = [number, number, number, number, number, number];
type Rect = [number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const point = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];

// Strings may contain parentheses, escapes and operator-looking text. Keep each
// literal/array intact so clipping analysis never interprets document text as code.
function tokens(source: string) {
  const result: { text: string; start: number; end: number }[] = [];
  let i = 0;
  function literal() {
    let depth = 1; i++;
    while (i < source.length && depth) {
      const c = source[i++];
      if (c === "\\") i++;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
  }
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source[i] === "%") { while (i < source.length && !/[\r\n]/.test(source[i])) i++; continue; }
    const start = i;
    if (source[i] === "(") literal();
    else if (source[i] === "[") {
      let depth = 1; i++;
      while (i < source.length && depth) {
        if (source[i] === "(") literal();
        else { const c = source[i++]; if (c === "[") depth++; else if (c === "]") depth--; }
      }
    } else if (source[i] === "<" && source[i + 1] !== "<") { i++; while (i < source.length && source[i++] !== ">") { /* hex string */ } }
    else {
      i++;
      while (i < source.length && !/[\s\[\]()<>/%]/.test(source[i])) i++;
    }
    result.push({ text: source.slice(start, i), start, end: i });
  }
  return result;
}

/** Omit only text whose baseline/glyph band is provably outside a rectangle clip.
 * Unknown paths, rotations and text advances are retained rather than guessed.
 * The original PDF is never changed: this stream is used only for extraction. */
export function removeClippedText(source: string): string {
  // Inline binary image data needs a dedicated parser; keep such streams intact.
  if (/(?:^|\s)BI\s/.test(source)) return source;
  let ctm: Matrix = [...identity];
  let clip: Rect | null = null;
  let fontSize = 0, mode = 0, rise = 0;
  const stack: { ctm: Matrix; clip: Rect | null; fontSize: number; mode: number; rise: number }[] = [];
  let rect: Rect | null = null, rectangleOnly = true, clipping = false;
  let textMatrix: Matrix | null = null, lineMatrix: Matrix | null = null;
  let operands: { text: string; start: number; end: number }[] = [];
  const cuts: [number, number][] = [];
  let objectCut: [number, number] | null = null, showCount = 0;
  for (const token of tokens(source)) {
    const op = token.text;
    if (/^[/(\[<]/.test(op) || /^[+\-.\d]/.test(op) || op === "true" || op === "false" || op === "null") { operands.push(token); continue; }
    const args = operands.map(t => Number(t.text));
    const matrix = (): Matrix => args.slice(-6) as Matrix;
    if (op === "q") stack.push({ ctm: [...ctm], clip: clip ? [...clip] : null, fontSize, mode, rise });
    else if (op === "Q") { const state = stack.pop(); if (state) ({ ctm, clip, fontSize, mode, rise } = state); }
    else if (op === "cm" && args.length === 6 && args.every(Number.isFinite)) ctm = multiply(ctm, matrix());
    else if (op === "re" && args.length === 4) {
      if (rect) rectangleOnly = false;
      const [x, y, w, h] = args;
      if (Math.abs(ctm[1]) < 1e-8 && Math.abs(ctm[2]) < 1e-8) {
        const a = point(ctm, x, y), b = point(ctm, x+w, y+h);
        rect = [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
      } else rectangleOnly = false;
    } else if (["m", "l", "c", "v", "y"].includes(op)) rectangleOnly = false;
    else if (op === "W" || op === "W*") clipping = true;
    else if (["n", "S", "s", "f", "F", "f*", "B", "B*", "b", "b*"].includes(op)) {
      if (clipping && rectangleOnly && rect) clip = clip ? [Math.max(clip[0],rect[0]),Math.max(clip[1],rect[1]),Math.min(clip[2],rect[2]),Math.min(clip[3],rect[3])] : rect;
      rect = null; rectangleOnly = true; clipping = false;
    } else if (op === "BT") { textMatrix = lineMatrix = [...identity]; objectCut = null; showCount = 0; }
    else if (op === "ET") {
      if (showCount === 1 && objectCut) cuts.push(objectCut);
      textMatrix = lineMatrix = null;
    }
    else if (op === "Tf") fontSize = args[args.length - 1];
    else if (op === "Tr") mode = args[0];
    else if (op === "Ts") rise = args[0];
    else if (op === "Tm" && args.length === 6) textMatrix = lineMatrix = matrix();
    else if ((op === "Td" || op === "TD") && lineMatrix && args.length === 2) textMatrix = lineMatrix = multiply(lineMatrix, [1,0,0,1,args[0],args[1]]);
    else if (op === "T*") textMatrix = lineMatrix = null;
    else if (["Tj", "TJ", "'", '"'].includes(op)) {
      showCount++;
      let hidden = mode === 3;
      // Do not filter text clipping modes: its glyphs can affect later graphics.
      if (mode < 4 && clip && textMatrix && (op === "Tj" || op === "TJ") && fontSize > 0) {
        const m = multiply(ctm, textMatrix);
        if (Math.abs(m[1]) < 1e-8 && Math.abs(m[2]) < 1e-8 && m[3] > 0) {
          const baseline = point(m, 0, rise)[1];
          const top = baseline + fontSize * m[3] * 0.9;
          const bottom = baseline - fontSize * m[3] * 0.3;
          hidden ||= top < clip[1] - 0.1 || bottom > clip[3] + 0.1 || clip[0] >= clip[2] || clip[1] >= clip[3];
        }
      }
      if (hidden && operands.length) objectCut = [operands[0].start, token.end];
      // Text advances depend on embedded font metrics. Never guess the next one.
      textMatrix = null;
    }
    operands = [];
  }
  for (let index = cuts.length - 1; index >= 0; index--) source = source.slice(0, cuts[index][0]) + source.slice(cuts[index][1]);
  return source;
}

export async function extractionPdf(input: Uint8Array): Promise<Uint8Array> {
  const document = await PDFDocument.load(input);
  let changed = false;
  for (const page of document.getPages()) {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const streams = refs.map(ref => document.context.lookup(ref));
    if (!streams.every(stream => stream instanceof PDFRawStream)) continue;
    const source = streams.map(stream => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString("latin1")).join("\n");
    const filtered = removeClippedText(source);
    if (filtered !== source) {
      page.node.set(PDFName.of("Contents"), document.context.register(document.context.flateStream(Buffer.from(filtered, "latin1"))));
      changed = true;
    }
  }
  return changed ? document.save() : input;
}
