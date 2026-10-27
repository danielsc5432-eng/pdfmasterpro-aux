import { pdfToDocx } from "../processing/docx";
import { structuralPdfToDocx } from "../processing/pdf2docx";
import { checkDocxFidelity, betterFidelity, fidelityStatus, unsafeFidelity, type FidelityReport } from "../processing/docx-fidelity";
import { sourceDocument, validatePlan, type LayoutPlanner } from "./model";
import { renderReconstruction } from "./render";
import { renderPageGrid } from "./page-grid";
import { nativePdfToDocx } from "./native";
import { cliConvert, configuredCli } from "../processing/cli-engine";
export { sourceDocument, validatePlan } from "./model";
export { optimizePdf } from "../processing/optimizer";
export { cliConvert, configuredCli } from "../processing/cli-engine";
export type { LayoutPlanner, SourceDocument, ReconstructionPlan, TablePlan } from "./model";

export type ConversionEngine = { name: string; convert(input: Uint8Array, context: {name: string; signal: AbortSignal}): Promise<Uint8Array> };
export type CandidateAudit = { engine: string; outcome: "measured" | "unverified" | "failed"; report?: FidelityReport };
type Options = { engines?: ConversionEngine[]; planner?: LayoutPlanner; verify?: typeof checkDocxFidelity };

/** Reusable server-side SDK. No network or AI provider is enabled implicitly. */
export function createPdfMasterSdk(options: Options = {}) {
  const engines = options.engines ?? [
    {name:"positioned-ocr", convert:(input:Uint8Array,ctx:{name:string})=>pdfToDocx(input,ctx.name,"por+eng")},
    {name:"page-grid", convert:(input:Uint8Array,ctx:{name:string})=>pdfToDocx(input,ctx.name,"por+eng",renderPageGrid)},
    {name:"native-unicode-layout", convert:(input:Uint8Array,ctx:{name:string})=>nativePdfToDocx(input,ctx.name)},
    ...(configuredCli("pdf-to-word")?[{name:"local-cli",convert:(input:Uint8Array)=>cliConvert("pdf-to-word",input,90000)}]:[]),
    {name:"pdf2docx", convert:(input:Uint8Array)=>structuralPdfToDocx(input,120000)},
  ];
  const candidates = [...engines];
  if (options.planner) {
    const planner = options.planner;
    candidates.push({name:`assisted:${planner.name}`,convert:(input,ctx)=>pdfToDocx(input,ctx.name,"por+eng",async({pages,assets,artwork})=>{
      const source = sourceDocument(pages);
      const proposal = validatePlan(source, await planner.propose(source,ctx.signal));
      if (!proposal.tables.length) throw new Error("No trustworthy table proposal");
      return renderReconstruction(pages,assets,artwork,proposal);
    })});
  }
  if (!candidates.length || candidates.length>8 || new Set(candidates.map(e=>e.name)).size!==candidates.length) throw new Error("Invalid SDK engine registration");
  return {
    async convert(input: Uint8Array, {name="documento", signal=AbortSignal.timeout(300000)}: {name?:string;signal?:AbortSignal} = {}) {
      if (!input.length || !new TextDecoder().decode(input.subarray(0,1024)).includes("%PDF-")) throw new Error("Arquivo PDF inválido.");
      const audit: CandidateAudit[] = [];
      let best: {output:Uint8Array;report:FidelityReport|null;engine:string}|undefined;
      for (const engine of candidates) {
        signal.throwIfAborted();
        try {
          const output = await engine.convert(input,{name,signal});
          signal.throwIfAborted();
          const report = await (options.verify ?? checkDocxFidelity)(input,output);
          signal.throwIfAborted();
          audit.push({engine:engine.name,outcome:report?"measured":"unverified",...(report?{report}:{})});
          if (!best || (report && (!best.report || betterFidelity(report,best.report)))) best={output,report,engine:engine.name};
          if (report && fidelityStatus(report)==="checked") break;
        } catch {
          signal.throwIfAborted();
          audit.push({engine:engine.name,outcome:"failed"});
        }
      }
      if (!best) throw new Error("Os motores não conseguiram reconstruir este PDF.");
      if (!best.report) throw new Error("A conferência de qualidade não pôde ser concluída; a entrega foi bloqueada.");
      if (best.report && unsafeFidelity(best.report)) throw new Error("A reconstrução apresentou diferenças de conteúdo, páginas ou layout e foi bloqueada pela conferência.");
      return {...best,status:fidelityStatus(best.report),audit};
    },
  };
}
