export type LayoutSegment = { text: string; bold: boolean; italic: boolean };

export type LayoutFont = { family: string; size: number; color: string; bold: boolean; italic: boolean };

export type LayoutWord = { text: string; x: number; y?: number; width: number; height?: number; bold: boolean; italic: boolean };

export type LayoutTextItem = {
  rotation?: number;
  baseline?: number;
  block?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  segments: LayoutSegment[];
  words: LayoutWord[];
  font: LayoutFont;
};

export type LayoutImageItem = { x: number; y: number; width: number; height: number; source: string };

export type LayoutPage = { width: number; height: number; texts: LayoutTextItem[]; images: LayoutImageItem[] };

type BboxWord = { text: string; x: number; width: number; y: number; height: number };

type BboxLine = { x: number; y: number; width: number; height: number; text: string; words: BboxWord[] };

type BboxPage = { width: number; height: number; lines: BboxLine[] };

type HtmlRun = { fontId: string; left: number; top: number; width?: number; segments: LayoutSegment[]; plain: string };

type HtmlPage = { width?: number; height?: number; fonts: Record<string, LayoutFont>; texts: HtmlRun[]; images: LayoutImageItem[] };

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const BASE_FONT_MAP: [RegExp, string][] = [
  [/^helvetica/i, "Arial"],
  [/^arial/i, "Arial"],
  [/^liberation sans/i, "Arial"],
  [/^dejavu sans/i, "Arial"],
  [/^times/i, "Times New Roman"],
  [/^liberation serif/i, "Times New Roman"],
  [/^dejavu serif/i, "Times New Roman"],
  [/^courier/i, "Courier New"],
  [/^liberation mono/i, "Courier New"],
  [/^dejavu sans mono/i, "Courier New"],
  [/^nimbus sans/i, "Arial"],
  [/^nimbus roman/i, "Times New Roman"],
  [/^nimbus mono/i, "Courier New"],
];

export function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES[entity] ?? match;
  });
}

function parseAttributes(raw: string) {
  const attributes: Record<string, string> = {};
  for (const match of raw.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g)) attributes[match[1]] = decodeEntities(match[2]);
  return attributes;
}

function toNumber(value: string | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "");
}

export function mapFontFamily(family: string) {
  const base = family
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/(,|\s|-|_)?(Bold|Italic|Oblique|BoldItalic|Regular|Normal|MT|PSMT)$/i, "")
    .trim();
  if (!base) return "Arial";
  for (const [pattern, target] of BASE_FONT_MAP) if (pattern.test(base)) return target;
  return base;
}

function normalizeColor(color: string) {
  const value = color.replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(value) ? `#${value.toUpperCase()}` : color || "#000000";
}

export function parseSegments(content: string): LayoutSegment[] {
  const segments: LayoutSegment[] = [];
  let bold = false;
  let italic = false;
  let cursor = 0;
  const push = (raw: string) => {
    const text = decodeEntities(raw);
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.bold === bold && last.italic === italic) last.text += text;
    else segments.push({ text, bold, italic });
  };
  for (const match of content.matchAll(/<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?\/?>/g)) {
    push(content.slice(cursor, match.index));
    cursor = (match.index ?? 0) + match[0].length;
    if (match[0].endsWith("/>")) continue;
    const name = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    if (name === "b" || name === "strong") bold = !closing;
    else if (name === "i" || name === "em") italic = !closing;
  }
  push(content.slice(cursor));
  return segments;
}

export function parseBboxLayout(xml: string): BboxPage[] {
  const pages: BboxPage[] = [];
  for (const page of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
    const attributes = parseAttributes(page[1]);
    const lines: BboxLine[] = [];
    for (const line of page[2].matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g)) {
      const lineAttributes = parseAttributes(line[1]);
      const words = [...line[2].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)]
        .map((word) => {
          const wordAttributes = parseAttributes(word[1]);
          const x = toNumber(wordAttributes.xMin);
          const y = toNumber(wordAttributes.yMin);
          return { text: decodeEntities(word[2]).trim(), x, width: Math.max(0, toNumber(wordAttributes.xMax) - x), y, height: Math.max(0, toNumber(wordAttributes.yMax) - y) };
        })
        .filter((word) => word.text);
      const text = words.map((word) => word.text).join(" ").trim();
      if (!text) continue;
      const x = toNumber(lineAttributes.xMin);
      const y = toNumber(lineAttributes.yMin);
      lines.push({ x, y, width: Math.max(0, toNumber(lineAttributes.xMax) - x), height: Math.max(0, toNumber(lineAttributes.yMax) - y), text, words });
    }
    pages.push({ width: toNumber(attributes.width, 595), height: toNumber(attributes.height, 842), lines });
  }
  return pages;
}

export function parsePdfToHtml(xml: string): HtmlPage[] {
  const pages: HtmlPage[] = [];
  const sharedFonts: Record<string, LayoutFont> = {};
  for (const page of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
    const pageAttributes = parseAttributes(page[1]);
    for (const spec of page[2].matchAll(/<fontspec\b([^>]*?)\/?>/g)) {
      const attributes = parseAttributes(spec[1]);
      if (!attributes.id) continue;
      sharedFonts[attributes.id] = { family: attributes.family || "Arial", size: toNumber(attributes.size, 0), color: normalizeColor(attributes.color), bold: false, italic: false };
    }
    const fonts: Record<string, LayoutFont> = { ...sharedFonts };
    const texts: HtmlRun[] = [];
    for (const text of page[2].matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const attributes = parseAttributes(text[1]);
      const segments = parseSegments(text[2]);
      const plain = segments.map((segment) => segment.text).join("");
      if (plain.trim()) texts.push({ fontId: attributes.font || "", left: toNumber(attributes.left), top: toNumber(attributes.top), width: toNumber(attributes.width), segments, plain });
    }
    const images: LayoutImageItem[] = [];
    for (const image of page[2].matchAll(/<image\b([^>]*?)\/?>/g)) {
      const attributes = parseAttributes(image[1]);
      if (!attributes.src) continue;
      images.push({ x: toNumber(attributes.left), y: toNumber(attributes.top), width: toNumber(attributes.width), height: toNumber(attributes.height), source: attributes.src });
    }
    pages.push({ width: toNumber(pageAttributes.width), height: toNumber(pageAttributes.height), fonts, texts, images });
  }
  return pages;
}

function findRun(runs: HtmlRun[], used: Set<number>, target: string, lineX: number, lineY: number) {
  const normalized = normalizeText(target);

  // 1) Casamento por texto completo: escolhe a execução mais próxima da posição
  //    da linha no PDF. O pdftohtml não devolve as execuções na mesma ordem do
  //    pdftotext, então buscar globalmente por posição é mais confiável do que
  //    avançar um cursor sequencial (que falhava e perdia negrito/cor).
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < runs.length; index++) {
    if (used.has(index)) continue;
    const run = runs[index];
    if (normalizeText(run.plain) !== normalized) continue;
    const distance = Math.abs(run.left - lineX) + Math.abs(run.top - lineY) * 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  if (best >= 0) {
    used.add(best);
    return runs[best];
  }

  // 2) Casamento por concatenação de execuções consecutivas (linha dividida em
  //    vários <text> pelo pdftohtml).
  for (let index = 0; index < runs.length; index++) {
    if (used.has(index)) continue;
    let combined = "";
    const chosen: number[] = [];
    for (let end = index; end < Math.min(runs.length, index + 8); end++) {
      if (used.has(end)) continue;
      combined += normalizeText(runs[end].plain);
      chosen.push(end);
      if (combined === normalized) {
        chosen.forEach((k) => used.add(k));
        const segments = chosen.flatMap((k) => runs[k].segments);
        return {
          fontId: runs[index].fontId,
          left: runs[index].left,
          top: runs[index].top,
          segments,
          plain: chosen.map((k) => runs[k].plain).join(""),
        };
      }
      if (combined.length > normalized.length) break;
    }
  }
  return null;
}

function styleWords(words: BboxLine["words"], segments: LayoutSegment[], font: LayoutFont): LayoutWord[] {
  const flat = segments
    .flatMap((segment) => [...segment.text].map((character) => ({ character, bold: segment.bold, italic: segment.italic })))
    .filter((entry) => !/\s/.test(entry.character));
  const expected = words.reduce((total, word) => total + word.text.length, 0);
  const aligned = flat.length === expected && expected > 0;
  let pointer = 0;
  return words.map((word) => {
    const slice = aligned ? flat.slice(pointer, pointer + word.text.length) : [];
    pointer += word.text.length;
    return {
      text: word.text,
      x: word.x,
      width: word.width,
      bold: aligned ? slice.some((entry) => entry.bold) : font.bold,
      italic: aligned ? slice.some((entry) => entry.italic) : font.italic,
    };
  });
}

function detectColumns(lines: LayoutTextItem[], pageWidth: number): LayoutTextItem[][] | null {
  // Detect multi-column layout
  const midPoint = pageWidth / 2;
  const leftCol = lines.filter(l => l.x + l.width < midPoint + 50).sort((a, b) => a.y - b.y);
  const rightCol = lines.filter(l => l.x > midPoint - 50).sort((a, b) => a.y - b.y);
  if (leftCol.length > 3 && rightCol.length > 3) {
    // Interleave by vertical position roughly
    const result: LayoutTextItem[] = [];
    let li = 0, ri = 0;
    while (li < leftCol.length || ri < rightCol.length) {
      if (li < leftCol.length && (ri >= rightCol.length || leftCol[li].y <= rightCol[ri].y + 2)) {
        result.push(leftCol[li++]);
      } else if (ri < rightCol.length) {
        result.push(rightCol[ri++]);
      }
    }
    return [result];
  }
  return null;
}

function detectTable(lines: LayoutTextItem[]): { isTable: boolean; rows: LayoutTextItem[][] } {
  // Group by similar Y positions (rows)
  const yGroups = new Map<number, LayoutTextItem[]>();
  for (const line of lines) {
    let foundKey = -1;
    for (const key of yGroups.keys()) {
      if (Math.abs(key - line.y) < 3) { foundKey = key; break; }
    }
    if (foundKey >= 0) {
      yGroups.get(foundKey)!.push(line);
    } else {
      yGroups.set(line.y, [line]);
    }
  }
  
  const sortedY = Array.from(yGroups.keys()).sort((a, b) => b - a); // top to bottom
  const rows = sortedY.map(y => {
    const row = yGroups.get(y)!;
    return row.sort((a, b) => a.x - b.x);
  }).filter(r => r.some(c => c.segments.some(s => s.text.trim())));
  
  // Check if it looks like a table (multiple rows, multiple columns, aligned)
  if (rows.length >= 3) {
    const colCounts = rows.map(r => r.length);
    const avgCols = colCounts.reduce((a,b) => a+b, 0) / colCounts.length;
    if (avgCols >= 2 && Math.max(...colCounts) - Math.min(...colCounts) <= 2) {
      return { isTable: true, rows };
    }
  }
  return { isTable: false, rows: [] };
}

export function joinLayoutPages(bboxPages: BboxPage[], htmlPages: HtmlPage[]): LayoutPage[] {
  return bboxPages.map((page, index) => {
    const html = htmlPages[index];
    const runs = html?.texts ?? [];
    const fonts = html?.fonts ?? {};
    const used = new Set<number>();
    const texts: LayoutTextItem[] = page.lines.flatMap((line) => {
      // Poppler may combine neighboring form fields into one bbox line. Resolve
      // styles against each word's own position, rather than treating the whole
      // row as one unmatched run and enlarging its font to the bbox height.
      const groups: LayoutTextItem[] = [];
      for (const word of line.words) {
        const candidates = runs.filter(run => Math.abs(run.top - word.y) < Math.max(5, word.height)
          && word.x >= run.left - 2 && word.x + word.width <= run.left + (run.width ?? 0) + 3
          && normalizeText(run.plain).includes(normalizeText(word.text)));
        const match = candidates.sort((a,b) => Math.abs(a.top-word.y)-Math.abs(b.top-word.y) || Math.abs(a.left-word.x)-Math.abs(b.left-word.x))[0];
        if (!match) continue;
        const spec = fonts[match.fontId];
        if (!spec || spec.size <= 0) continue;
        const characters = match.segments.flatMap(segment => [...segment.text].filter(character => !/\s/.test(character)).map(character => ({ character, bold: segment.bold, italic: segment.italic })));
        const start = characters.map(c=>c.character).join("").indexOf(normalizeText(word.text));
        const wordStyle = characters.slice(start, start + normalizeText(word.text).length);
        const styled: LayoutWord = { text: word.text, x: word.x, width: word.width, bold: /bold/i.test(spec.family) || wordStyle.some(c=>c.bold), italic: /italic|oblique/i.test(spec.family) || wordStyle.some(c=>c.italic) };
        const font: LayoutFont = { ...spec, family: mapFontFamily(spec.family), bold: styled.bold, italic: styled.italic };
        const previous = groups[groups.length-1];
        if (previous && Math.abs(previous.y-word.y)<0.2 && previous.font.family===font.family && previous.font.size===font.size && previous.font.bold===font.bold && previous.font.italic===font.italic && previous.font.color===font.color) {
          previous.words.push(styled);
          previous.width = word.x+word.width-previous.x;
          previous.segments[0].text += " " + word.text;
        } else groups.push({ x: word.x, y: word.y, width: word.width, height: word.height, font, words: [styled], segments: [{ text: word.text, bold: styled.bold, italic: styled.italic }] });
      }
      if (groups.reduce((count,group)=>count+group.words.length,0) === line.words.length) return groups;
      const match = findRun(runs, used, line.text, line.x, line.y);
      const spec = match ? fonts[match.fontId] : undefined;
      const size = spec && spec.size > 0 ? spec.size : Math.max(6, line.height || 11);
      const family = spec?.family ?? "Arial";
      const font: LayoutFont = {
        family: mapFontFamily(family),
        size,
        color: spec?.color ?? "#000000",
        bold: /\bbold\b/i.test(family),
        italic: /italic|oblique/i.test(family),
      };
      const segments = match ? match.segments : [{ text: line.text, bold: font.bold, italic: font.italic }];
      return [{ x: line.x, y: line.y, width: line.width, height: line.height, segments, words: styleWords(line.words, segments, font), font }];
    });

    // Don't merge across different columns too aggressively
    const merged: LayoutTextItem[] = [];
    const sorted = [...texts].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const item of sorted) {
      const existing = merged.find((candidate) => Math.abs(candidate.y - item.y) < 1.2 && Math.abs(candidate.x - item.x) < 5);
      if (existing) {
        existing.words = [...existing.words, ...item.words].sort((a, b) => a.x - b.x);
        const combinedText = existing.words.map((word) => word.text).join(" ");
        existing.segments = [{ text: combinedText, bold: existing.font.bold, italic: existing.font.italic }];
        existing.x = Math.min(existing.x, item.x);
        existing.width = Math.max(existing.width + existing.x, item.width + item.x) - existing.x;
        continue;
      }
      merged.push({ ...item, words: [...item.words].sort((a, b) => a.x - b.x) });
    }
    
    // Sort by reading order
    merged.sort((a, b) => a.y - b.y || a.x - b.x); // bbox coordinates start at the top
    // pdftotext reports unrotated dimensions but already rotates word coordinates.
    // pdftohtml reports displayed dimensions. Only swap when both axes agree.
    const swapped = html?.width && html.height && Math.abs(html.width-page.height)<2 && Math.abs(html.height-page.width)<2 && Math.abs(page.width-page.height)>2;
    return { width: swapped ? page.height : page.width, height: swapped ? page.width : page.height, texts: merged, images: html?.images ?? [] };
  });
}

export function parseLayout(bboxXml: string, htmlXml: string): LayoutPage[] {
  const bboxPages = parseBboxLayout(bboxXml);
  const htmlPages = htmlXml ? parsePdfToHtml(htmlXml) : [];
  return joinLayoutPages(bboxPages, htmlPages);
}
