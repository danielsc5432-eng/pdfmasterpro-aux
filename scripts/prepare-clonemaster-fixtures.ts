import { mkdir, writeFile } from "node:fs/promises";
import { templateText, xlsxFixture } from "../tests/fixtures/clonemaster";

const directory = ".vercel/review/clonemaster";
async function main() {
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/configuracao.txt`, templateText);
await writeFile(`${directory}/funcionarios.xlsx`, await xlsxFixture());
await writeFile(`${directory}/500-registros.xlsx`, await xlsxFixture({ sheets: [{ name: "Dados", rows: [["Nome", "Cargo", "Salário"], ...Array.from({ length: 500 }, () => ["Não extrair", "Não extrair", 4500])] }] }));
await writeFile(`${directory}/modelo-duplicado.ini`, "[A]\nsalario=1\n[B]\nsalario=2\n");
console.log(`Arquivos sintéticos de teste criados em ${directory}.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
