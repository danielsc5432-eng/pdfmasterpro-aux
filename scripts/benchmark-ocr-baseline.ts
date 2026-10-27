/** Isolated benchmark wrapper: executes the current production OCR implementation unchanged. */
import { readFile, writeFile } from "node:fs/promises";
import { ocrPdf } from "../lib/processing/extended";
async function main(){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error("Provide synthetic input/output paths.");const bytes=await ocrPdf(new Uint8Array(await readFile(input)),"por+eng");await writeFile(output,bytes);}
main().catch(error=>{console.error(error instanceof Error?error.message:"Baseline OCR failed");process.exitCode=1;});
