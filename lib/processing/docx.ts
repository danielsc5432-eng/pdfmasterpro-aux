import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { Document, FrameAnchorType, FrameWrap, HorizontalPositionRelativeFrom, ImageRun, LineRuleType, PageOrientation, Packer, Paragraph, SectionType, TabStopType, TextRun, TextWrappingType, VerticalPositionRelativeFrom } from "docx";
import { parseLayout, type LayoutImageItem, type LayoutPage, type LayoutTextItem } from "./layout";
import { pdfToDocxWithMsWord } from "./msword";
import { commandExists, execFile } from "./system";
import { extractPdfVectors } from "./vector";
import { renderDocxArtwork, renderOriginalArtwork } from "./docx-artwork";
import { extractionPdf } from "./pdf-visible-text";
import { recognizeScannedPages } from "./docx-ocr";
import { readNativeLayout } from "./native-layout";

export type DocxParagraph = { text: string; pageBreakBefore: boolean; heading: boolean };

const POINTS_TO_TWIPS = 20;
const POINTS_TO_PIXELS = 96 / 72;
const LIST_ITEM = /^([-*•·◦▪]|\d{1,3}[.)]|[a-z][.)])\s+/;
const TERMINATES = /[.!?…:;]$/;

/** Junta as linhas quebradas do `pdftotext` em parágrafos contínuos (modo de reserva). */
export function buildDocxParagraphs(raw: string): DocxParagraph[] {
  const pages = raw.replace(/\r\n?/g, "\n").split("\f");
  if (pages.length > 1 && !pages[pages.length - 1].trim()) pages.pop();
  const paragraphs: DocxParagraph[] = [];
  pages.forEach((page, pageIndex) => {
    const collected: string[] = [];
    let current = "";
    const merge = (previous: string, line: string) =>
      /[A-Za-zÀ-ÿ]-$/.test(previous) && /^[a-zà-öø-ÿ]/.test(line) ? previous.slice(0, -1) + line : `${previous} ${line}`;
    for (const rawLine of page.split("\n")) {
      const line = rawLine.replace(/\t/g, " ").replace(/ {2,}/g, " ").trim();
      if (!line) {
        if (current) { collected.push(current); current = ""; }
        continue;
      }
      if (!current) { current = line; continue; }
      const joins = !LIST_ITEM.test(line) && (/[,\-–—/]$/.test(current) || /^[a-zà-öø-ÿ(«"“']/u.test(line) && !TERMINATES.test(current));
      if (joins) current = merge(current, line);
      else { collected.push(current); current = line; }
    }
    if (current) collected.push(current);
    if (!collected.length) {
      if (pageIndex > 0) paragraphs.push({ text: "", pageBreakBefore: true, heading: false });
      return;
    }
    collected.forEach((text, index) => {
      const heading = text.length <= 70 && !TERMINATES.test(text) && !/[a-zà-öø-ÿ]/.test(text) && /[A-ZÀ-Þ]/.test(text);
      paragraphs.push({ text, pageBreakBefore: index === 0 && pageIndex > 0, heading });
    });
  });
  return paragraphs;
}

function twips(points: number) {
  return Math.max(0, Math.round(points * POINTS_TO_TWIPS));
}

function frameAt(x: number, y: number, width?: number) {
  return {
    type: "absolute" as const,
    position: { x: twips(x), y: twips(y) },
    anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
    wrap: FrameWrap.NONE,
    ...(width !== undefined ? { width } : {}),
  };
}



function textParagraph(items: LayoutTextItem[], pageWidth: number) {
  const item = items[0];
  const color = item.font.color.replace("#", "").toUpperCase();
  const size = Math.max(2, Math.round(item.font.size * 2));
  const regular = /^[0-9A-F]{6}$/.test(color) ? color : "000000";
  // Posiciona palavra a palavra com tabulações sempre que houver múltiplas
  // palavras: garante o alinhamento horizontal exato do PDF (sem drift).
  const positioned = item.words.length > 1 && items.length === 1;

  const run = (text: string, bold: boolean, italic: boolean, font = item.font) => new TextRun({
    text,
    font: font.family,
    size: Math.max(2, Math.round(font.size * 2)),
    bold: bold || font.bold,
    italics: italic || font.italic,
    color: (() => { const c = font.color.replace("#", "").toUpperCase(); return /^[0-9A-F]{6}$/.test(c) ? c : "000000"; })(),
  });

  const tabStops: { type: (typeof TabStopType)[keyof typeof TabStopType]; position: number }[] = [];
  const children: TextRun[] = [];

  if (items.length > 1) {
    // Parágrafo multi-linha: renderiza cada linha com quebra, preservando fonte/cor por linha.
    items.forEach((line, lineIndex) => {
      if (lineIndex > 0) children.push(new TextRun({ break: 1, text: "" }));
      const lineColor = line.font.color.replace("#", "").toUpperCase();
      const lineRegular = /^[0-9A-F]{6}$/.test(lineColor) ? lineColor : "000000";
      const lineRun = (text: string, bold: boolean, italic: boolean) => new TextRun({
        text,
        font: line.font.family,
        size: Math.max(2, Math.round(line.font.size * 2)),
        bold: bold || line.font.bold,
        italics: italic || line.font.italic,
        color: lineRegular,
      });
      for (const segment of line.segments.filter((segment) => segment.text)) {
        children.push(lineRun(segment.text, segment.bold, segment.italic));
      }
    });
  } else if (positioned) {
    item.words.forEach((word, index) => {
      if (index > 0) {
        // Tabulação até a posição horizontal exata da palavra no PDF.
        const target = word.x - item.words[0].x;
        if (target > 0.5) {
          tabStops.push({ type: TabStopType.LEFT, position: twips(target) });
          children.push(run("\t", false, false));
        } else {
          children.push(run(" ", false, false));
        }
      }
      children.push(run(word.text, word.bold, word.italic));
    });
  } else {
    for (const segment of item.segments.filter((segment) => segment.text)) {
      children.push(run(segment.text, segment.bold, segment.italic));
    }
  }

  // Largura explícita até a borda da página: impede que o Word quebre o texto dentro do quadro.
  const frameWidth = twips(Math.max(item.width + 20, pageWidth - item.x));
  // Espaçamento entre linhas real do PDF (multi-linha) ou linha única com
  // altura exata de 1,2× o corpo. A altura exata torna previsível onde o Word
  // coloca a linha de base (ver `baselineShift` abaixo).
  const spacing = items.length > 1
    ? (() => {
        const first = items[0];
        const second = items[1];
        const exactTwips = Math.max(40, twips(second.y - first.y));
        return { before: 0, after: 0, line: exactTwips, lineRule: LineRuleType.EXACT };
      })()
    : { before: 0, after: 0, line: Math.max(40, Math.round(item.font.size * 1.2 * 20)), lineRule: LineRuleType.EXACT };

  // O topo do quadro é o topo da caixa de linha; o Word desenha o texto com a
  // linha de base a ~1,2·corpo do topo (para a altura exata acima). Recuamos o
  // quadro em 0,24·corpo para que a linha de base coincida exatamente com a do
  // PDF — sem isso o texto fica alguns pontos abaixo (e o desvio variava com o
  // corpo da fonte, quebrando o alinhamento).
  const baselineShift = item.font.size * 0.24;
  // MuPDF exposes the actual baseline, while Poppler exposes a different top
  // box. Do not reuse the Poppler offset for native glyph boxes: it shifts text
  // upward by several points, especially on staggered columns.
  const frameY=item.baseline!==undefined&&(item.rotation??0)===0?item.baseline-item.font.size*.96:item.y-baselineShift;

  return new Paragraph({
    frame: frameAt(item.x, frameY, frameWidth),
    spacing,
    tabStops: tabStops.length ? tabStops : undefined,
    children,
  });
}

function imageParagraph(item: LayoutImageItem, data: Uint8Array) {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 1, lineRule: LineRuleType.EXACT },
    children: [new ImageRun({
      type: data[0] === 0xff && data[1] === 0xd8 ? "jpg" : "png",
      data,
      floating: {
        horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round(item.x * 12700) },
        verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round(item.y * 12700) },
        allowOverlap: true,
        layoutInCell: false,
        lockAnchor: true,
        wrap: { type: TextWrappingType.NONE },
      },
      transformation: {
        width: Math.max(1, Math.round(item.width * POINTS_TO_PIXELS)),
        height: Math.max(1, Math.round(item.height * POINTS_TO_PIXELS)),
      },
    })],
  });
}

function itemText(item: LayoutTextItem) {
  return item.segments.map((segment) => segment.text).join("").replace(/\s+/g, " ").trim();
}

/** Preserve PDF geometry instead of guessing tables and reflowing form fields. */
export function layoutSections(pages: LayoutPage[], assets: Map<string, Uint8Array>, artwork = new Map<number, Uint8Array>()) {
  return pages.map((page, index) => ({
    properties: {
      type: SectionType.NEXT_PAGE,
      page: {
        // docx swaps the supplied dimensions for LANDSCAPE: provide portrait order.
        size: { width: twips(Math.min(page.width,page.height)), height: twips(Math.max(page.width,page.height)), orientation: page.width > page.height ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 },
      },
    },
    children: [
      // The unframed anchor belongs to this page and gives drawings a stable origin.
      new Paragraph({ spacing: { before: 0, after: 0, line: 1, lineRule: LineRuleType.EXACT }, children: artwork.has(index) ? [new ImageRun({ type: "png", data: artwork.get(index)!, transformation: { width: page.width * POINTS_TO_PIXELS, height: page.height * POINTS_TO_PIXELS }, floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true, layoutInCell: false, lockAnchor: true, wrap: { type: TextWrappingType.NONE } }, altText: { name: "Bordas e preenchimentos", description: "Somente elementos gráficos; o texto do documento permanece editável." } })] : [new TextRun({ text: "", size: 2 })] }),
      ...page.texts.filter((item) => itemText(item)).map((item) => textParagraph([item], page.width)),
      ...page.images.flatMap((item) => { const bytes = assets.get(item.source); return bytes ? [imageParagraph(item, bytes)] : []; }),
    ],
  }));
}

function textFlowSections(paragraphs: DocxParagraph[]) {
  return [{
    children: paragraphs.map((item) => new Paragraph({
      pageBreakBefore: item.pageBreakBefore,
      spacing: { after: item.heading ? 200 : 160, line: 276 },
      children: item.text ? [new TextRun({ text: item.text, bold: item.heading, size: item.heading ? 26 : 22 })] : [],
    })),
  }];
}

async function loadAsset(image: LayoutImageItem, directory: string, assets: Map<string, Uint8Array>) {
  if (assets.has(image.source)) return;
  try {
    const resolved = path.isAbsolute(image.source) ? image.source : path.join(directory, image.source);
    const bytes = await readFile(resolved);
    if (bytes.length) assets.set(image.source, new Uint8Array(bytes));
  } catch {
    // imagem opcional: segue sem ela
  }
}

/** Número de páginas via pdfinfo (0 quando indisponível). */
async function pdfPageCount(inputPath: string) {
  try {
    const { stdout } = await execFile("pdfinfo", [inputPath], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const match = /^Pages:\s+(\d+)/m.exec(stdout);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

async function readPageImages(prefix: string, inputPath: string, converter: string, includeImages = true) {
  if (!(await commandExists(converter))) return "";
  try {
    await execFile(converter, ["-xml", "-q", "-nodrm", "-enc", "UTF-8", "-zoom", "1", ...(!includeImages ? ["-i"] : []), inputPath, prefix], { timeout: 180000, maxBuffer: 96 * 1024 * 1024 });
    return await readFile(`${prefix}.xml`, "utf8");
  } catch {
    return "";
  }
}

/** Junta vários DOCX (gerados em blocos) em um único documento. */
export async function mergeDocxBodies(chunks: Uint8Array[]): Promise<Uint8Array<ArrayBuffer>> {
  if (chunks.length === 1) return chunks[0] as Uint8Array<ArrayBuffer>;
  const base = await JSZip.loadAsync(chunks[0]);
  const baseEntry = base.file("word/document.xml");
  if (!baseEntry) return chunks[0] as Uint8Array<ArrayBuffer>;
  const baseXml = await baseEntry.async("string");
  const bodies: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const zip = await JSZip.loadAsync(chunk);
    const entry = zip.file("word/document.xml");
    if (!entry) continue;
    const xml = await entry.async("string");
    const match = /<w:body>([\s\S]*)<\/w:body>/.exec(xml);
    if (match) {
      // Only the final section may be a direct child of w:body. A chunk's
      // terminal section must become a paragraph section break before joining.
      let body = match[1];
      if (index < chunks.length - 1) {
        const terminalStart = body.lastIndexOf("<w:sectPr");
        if (terminalStart >= 0 && /^<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/.test(body.slice(terminalStart))) {
          body = body.slice(0, terminalStart) + "<w:p><w:pPr>" + body.slice(terminalStart).trim() + "</w:pPr></w:p>";
        }
      }
      bodies.push(body);
    }
  }
  if (!bodies.length) return chunks[0] as Uint8Array<ArrayBuffer>;
  base.file("word/document.xml", baseXml.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${bodies.join("")}</w:body>`));
  const out = await base.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Uint8Array(out);
}

export type LayoutReconstructor = (context: { pages: LayoutPage[]; assets: Map<string, Uint8Array>; artwork: Map<number, Uint8Array> }) => Promise<Uint8Array>;

export async function pdfToDocx(input: Uint8Array, originalName = "documento", ocrLanguage = "por+eng", reconstruct?: LayoutReconstructor, extraction: "poppler"|"native" = "poppler") {
  // Layout reconstruction is deterministic across Windows and Linux. Native Word
  // reflow is an explicit opt-in, since it moves table/form content unpredictably.
  if (process.env.PDF_TO_WORD_NATIVE_REFLOW === "1") {
    const viaWord = await pdfToDocxWithMsWord(input);
    if (viaWord) return viaWord;
  }
  // Reserva 2: LibreOffice / soffice (desativado temporariamente para testar renderizador posicional melhorado)
  if (process.env.PDF_TO_WORD_USE_LIBREOFFICE === "1") {
    const configured = process.env.PDF_TO_WORD_CONVERTER;
    let converter = !configured || configured.toLowerCase() === "msword" ? (process.env.SOFFICE_CONVERTER || "soffice") : configured;
    if (!(await commandExists(converter))) {
      for (const c of ["soffice", "libreoffice", "/usr/bin/soffice", "/usr/bin/libreoffice", "/snap/bin/libreoffice"]) {
        if (await commandExists(c)) { converter = c; break; }
      }
    }
    if (await commandExists(converter)) {
      const directory = await mkdtemp(path.join(os.tmpdir(), "pdfmaster-libre-docx-"));
      const inputPath = path.join(directory, "input.pdf");
      const profile = path.join(directory, "profile");
      try {
        await writeFile(inputPath, input);
        await execFile(converter, [`-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--infilter=writer_pdf_import", "--convert-to", "docx:MS Word 2007 XML", "--outdir", directory, inputPath], { timeout: 300000 });
        const entries = await readdir(directory);
        const docxEntry = entries.find((name) => name.toLowerCase().endsWith(".docx"));
        if (docxEntry) {
          const bytes = await readFile(path.join(directory, docxEntry));
          if (bytes.length > 1000) return new Uint8Array(bytes);
        }
        const docxEntry2 = entries.find((name) => name.toLowerCase().endsWith(".docx") && name !== "input.docx");
        if (docxEntry2) {
          const bytes = await readFile(path.join(directory, docxEntry2));
          if (bytes.length > 1000) return new Uint8Array(bytes);
        }
      } catch { /* cai para o renderizador posicional */ }
      finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
    }
  }
  // Reserva 3: reconstrução posicional a partir do layout extraído por pdftotext/pdtohtml.
  const extractor = process.env.PDF_TEXT_EXTRACTOR || "pdftotext";
  const htmlConverter = process.env.PDF_HTML_CONVERTER || "pdftohtml";
  if (!(await commandExists(extractor))) throw new Error("O extrator de texto PDF não está configurado neste servidor.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "pdfmaster-docx-"));
  const inputPath = path.join(directory, "input.pdf");
  const extractionPath = path.join(directory, "visible-text.pdf");
  const layoutPath = path.join(directory, "layout.xml");
  const textPath = path.join(directory, "extracted.txt");
  try {
    await writeFile(inputPath, input);
    await writeFile(extractionPath, await extractionPdf(input));
    let pages: LayoutPage[] = [];
    try {
      const pageCount = await pdfPageCount(inputPath);
      const maxImagePages = Number(process.env.PDF_TO_WORD_MAX_IMAGE_PAGES || Infinity);
      const renderImages = pageCount === 0 || pageCount <= maxImagePages;
      // pdftotext e a extração de imagens são independentes: rodam em paralelo.
      const [xml, htmlXml] = await Promise.all([
        (async () => {
          await execFile(extractor, ["-bbox-layout", "-enc", "UTF-8", extractionPath, layoutPath], { timeout: 180000, maxBuffer: 96 * 1024 * 1024 });
          return readFile(layoutPath, "utf8");
        })(),
        (async () => {
          // Font/style extraction is needed even on pages without raster images.
          return readPageImages(path.join(directory, "html"), extractionPath, htmlConverter, renderImages);
        })(),
      ]);
      pages = parseLayout(xml, htmlXml);
    } catch {
      pages = [];
    }

    if(extraction==="native"){
      const native=await readNativeLayout(extractionPath);
      pages=native.map((page,index)=>({...page,images:pages[index]?.images.length?pages[index].images:page.images}));
    }
    const scannedArtwork = await recognizeScannedPages(pages, inputPath, directory, ocrLanguage);
    const assets = new Map<string, Uint8Array>();
    for (const page of pages) for (const image of page.images) await loadAsset(image, directory, assets);
    const hasText = pages.some((page) => page.texts.some((item) => item.segments.some((segment) => segment.text.trim())));
    if (pages.length && (hasText || assets.size)) {
      // Extrai vetores (linhas/retângulos) do PDF para desenhar bordas e grades.
      // Operators may explicitly cap artwork extraction; the default preserves
      // all pages instead of silently dropping grids on documents over 40 pages.
      const maxVectorPages = Number(process.env.PDF_TO_WORD_MAX_VECTOR_PAGES || Infinity);
      const originalArtwork = pages.length <= maxVectorPages ? await renderOriginalArtwork(inputPath, pages.length, directory) : null;
      const vectors = !originalArtwork && pages.length <= maxVectorPages ? await extractPdfVectors(input) : [];
      const artwork = originalArtwork ?? await renderDocxArtwork(pages, vectors, directory);
      for (const [index, image] of scannedArtwork) artwork.set(index, image);
      // Original artwork already includes the logos, at the PDF's exact coordinates.
      const documentPages = originalArtwork ? pages.map(page => ({ ...page, images: [] })) : pages;
      if (reconstruct) return await reconstruct({ pages: documentPages, assets, artwork });
      const documentOptions = {
        creator: "PDF Master Pro",
        title: originalName,
        description: `Documento recriado a partir de ${originalName} pelo PDF Master Pro.${scannedArtwork.size ? " Contém texto reconhecido por OCR; revise nomes e valores." : ""}`,
        styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
      };
      // Documentos longos são montados em blocos: o gráfico de objetos do DOCX
      // inteiro consome muita memória e pode derrubar o processo em produção.
      const configuredChunkSize = Number(process.env.PDF_TO_WORD_CHUNK_PAGES || 40);
      const chunkSize = Number.isFinite(configuredChunkSize) && configuredChunkSize >= 1 ? Math.floor(configuredChunkSize) : 40;
      let buffer: Uint8Array;
      if (!assets.size && !artwork.size && pages.length > chunkSize) {
        const chunks: Uint8Array[] = [];
        for (let start = 0; start < pages.length; start += chunkSize) {
          const part = new Document({ ...documentOptions, sections: layoutSections(pages.slice(start, start + chunkSize), assets) });
          chunks.push(new Uint8Array(await Packer.toBuffer(part)));
        }
        buffer = await mergeDocxBodies(chunks);
      } else {
        const document = new Document({ ...documentOptions, sections: layoutSections(documentPages, assets, artwork) });
        buffer = await Packer.toBuffer(document);
      }
      return buffer;
    }

    await execFile(extractor, ["-enc", "UTF-8", extractionPath, textPath], { timeout: 180000, maxBuffer: 96 * 1024 * 1024 });
    const paragraphs = buildDocxParagraphs(await readFile(textPath, "utf8"));
    if (!paragraphs.some((item) => item.text.trim())) throw new Error("Este PDF não contém texto extraível. OCR será necessário para documentos digitalizados.");
    const fallback = new Document({
      creator: "PDF Master Pro",
      title: originalName,
      description: `Texto extraído de ${originalName} pelo PDF Master Pro.`,
      styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { after: 160, line: 276 } } } } },
      sections: textFlowSections(paragraphs),
    });
    return new Uint8Array(await Packer.toBuffer(fallback));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
