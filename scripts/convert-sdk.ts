import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPdfMasterSdk } from "../lib/pdf-sdk";
import { doclingTablePlanner } from "../lib/pdf-sdk/docling-planner";

async function main() {
  const args = process.argv.slice(2);
  const [input, output, flag, layout] = args;
  if (![2,4].includes(args.length) || !input || !output || !output.toLowerCase().endsWith(".docx") || (flag && (flag !== "--docling-layout" || !layout))) throw new Error("Uso: pnpm convert:sdk origem.pdf resultado.docx [--docling-layout resultado-docling.json]");
  let planner;
  if (layout) {
    const result = JSON.parse(await readFile(layout,"utf8"));
    planner = doclingTablePlanner(result.document?.json_content ?? result);
  }
  const sdk = createPdfMasterSdk({planner});
  const result = await sdk.convert(await readFile(input),{name:path.basename(input)});
  // Never overwrite a user's existing document or report.
  await writeFile(output,result.output,{flag:"wx"});
  await writeFile(`${output}.quality.json`,JSON.stringify({engine:result.engine,status:result.status,report:result.report,audit:result.audit},null,2),{flag:"wx"});
  console.log(JSON.stringify({engine:result.engine,status:result.status}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Falha de conversão SDK");process.exitCode=1;});
