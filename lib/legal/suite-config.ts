export const LEGAL_SUITE = [
  { slug:"contractcheck-ai", name:"ContractCheck AI", description:"Localize cláusulas, valores, obrigações e condições de rescisão com trechos verificáveis.", action:"Analisar contrato", min:1, features:["Inventário de cláusulas", "Valores e obrigações", "Pontos para revisão", "Regras locais e revisão opcional com IA"] },
  { slug:"processo-timeline", name:"ProcessoTimeline", description:"Organize datas e possíveis eventos processuais em uma linha do tempo com fontes.", action:"Criar linha do tempo", min:1, features:["Datas expressas e contexto", "Ordem cronológica", "Eventos sem data separados", "Sem contagem de prazos oficiais"] },
  { slug:"juris-organize", name:"JurisOrganize", description:"Classifique PDFs e revise nomes, processos e pastas antes de baixar cópias organizadas.", action:"Organizar documentos", min:1, features:["Número de processo", "Tipo, assunto e partes sugeridos", "Revisão antes do ZIP", "Originais preservados"] },
  { slug:"prova-compare", name:"ProvaCompare", description:"Compare conteúdo e apresentação de evidências, confira identificadores e exporte diferenças documentadas.", action:"Comparar evidências", min:2, features:["Comparação textual e visual", "SHA-256 dos arquivos", "Evidências lado a lado", "Sem conclusões de autenticidade"] },
  { slug:"prazo-extractor", name:"PrazoExtractor", description:"Extraia datas e prazos escritos, distinguindo datas explícitas de referências relativas.", action:"Extrair datas e prazos", min:1, features:["Datas numéricas e por extenso", "Prazos expressos", "Dias úteis e corridos quando escritos", "Sem vencimento presumido"] },
  { slug:"peticao-review", name:"PetiçãoReview", description:"Revise seções, numeração, referências internas e repetições com indicação da origem.", action:"Revisar petição", min:1, features:["Checklist estrutural", "Referências internas", "Trechos repetidos", "Revisão técnica; sem parecer jurídico"] },
] as const;
export type LegalSuiteSlug = typeof LEGAL_SUITE[number]["slug"];
export type LegalAnalysisSlug = Exclude<LegalSuiteSlug,"prova-compare">;
export function isLegalSuiteSlug(slug:string):slug is LegalSuiteSlug { return LEGAL_SUITE.some(tool=>tool.slug===slug); }
export function isLocalLegalSlug(slug:string){ return slug==="pdf-timemachine-juridico"||isLegalSuiteSlug(slug); }
