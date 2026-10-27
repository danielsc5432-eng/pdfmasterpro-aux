import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { CATEGORY_LABELS, CLASS_LABELS, REVIEW_LABELS, type AnalysisResult, type Review, type LocalAiReview } from "./types";

export async function divergenceReport(result: AnalysisResult, reviews: Record<string, Review>, fontBytes: Uint8Array, localAi?: LocalAiReview | null) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  let page = pdf.addPage([595, 842]), y = 790;
  const line = (text: string, size = 10) => {
    // Never silently discard unsupported characters from evidence.
    if ([...text].some(char => !supported.has(char.codePointAt(0)!))) throw Error("O relatório contém caracteres não suportados pela fonte. Exporte o JSON para preservar o conteúdo integral.");
    const words = text.replace(/\s+/g, " ").trim().split(" ");
    let row = "";
    const draw = () => {
      if (y < 55) { page = pdf.addPage([595, 842]); y = 790; }
      page.drawText(row, { x: 42, y, font, size, color: rgb(.12, .15, .22) }); y -= size + 6; row = "";
    };
    for (const word of words) {
      for (const char of [...(row ? " " : ""), ...word]) {
        if (row && font.widthOfTextAtSize(row + char, size) > 510) draw();
        row += char;
      }
    }
    if (row) draw();
    y -= 4;
  };
  pdf.setTitle("PDF Master Pro — Relatório de divergências");
  line("PDF MASTER PRO", 17); line("Relatório de comparação documental", 14);
  line(`Análise: ${result.id}`);
  line(`Gerado: ${new Date(result.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  line(`Modos: ${result.options.modes.join(", ")}. IA: ${result.ai.status}; pares examinados: ${result.ai.considered}.`);
  if (result.options.custom) line(`Solicitação personalizada: ${result.options.custom}`);
  line("Exige conferência humana. Diferenças não comprovam fraude, irregularidade ou obrigação jurídica. Nenhum resultado assegura equivalência integral dos documentos.");
  line("Documentos", 13);
  if (localAi) {
    line(`IA no navegador: ${localAi.model}, revisão ${localAi.revision}.`);
    line("Similaridade vetorial não é probabilidade de acerto nem prova de equivalência. Números, negações e obrigações precisam de conferência humana. Somente até 450 caracteres de cada trecho são examinados.");
  }
  for (const doc of result.documents) {
    line(`${doc.name} — ${doc.pages.length} página(s), ${doc.size} bytes. Extração ${doc.complete ? "completa dentro dos limites" : "parcial"}${doc.duplicateOf ? "; duplicado de " + doc.duplicateOf : ""}.`);
    line(`SHA-256: ${doc.sha256}`, 8);
    for (const warning of doc.warnings) line(warning);
  }
  for (const warning of result.warnings) line(`Aviso: ${warning}`);
  if (result.truncated) line("O limite de achados foi atingido. Este relatório não cobre todas as diferenças possíveis.");
  line(`Achados: ${result.findings.length}`, 13);
  if (!result.findings.length) line("Nenhum achado nos padrões examinados. Isso não comprova equivalência.");
  for (const item of result.findings) {
    line(`${item.id} — ${item.title}`, 12);
    line(`${CATEGORY_LABELS[item.category]} | ${CLASS_LABELS[item.classification]} | confiança: ${item.confidence} | origem: ${item.origin}`);
    line(item.explanation);
    const localScore = localAi?.items.find(score => score.findingId === item.id);
    if (localScore) line(`Similaridade vetorial por IA local (-1 a 1): ${localScore.similarity.toFixed(3)}. Não confirma nem descarta a divergência.`);
    for (const source of item.evidence) {
      line(`Fonte: ${source.documentName}, página ${source.page}, linha ${source.lineId}`);
      line(`Trecho: ${source.quote}`);
      line(`Valor: ${source.value}`);
    }
    if (item.missingDocumentId) line(`Campo não localizado em: ${result.documents.find(doc => doc.id === item.missingDocumentId)?.name ?? item.missingDocumentId}. Pode existir com outro rótulo.`);
    const review = reviews[item.id];
    line(`Revisão humana: ${REVIEW_LABELS[review?.status ?? "pending"]}`);
    if (review?.note) line(`Observação do revisor: ${review.note}`);
    y -= 10;
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => sheet.drawText(`PDF Master Pro — ${index + 1}/${pages.length}`, { x: 42, y: 25, font, size: 8 }));
  return pdf.save();
}
