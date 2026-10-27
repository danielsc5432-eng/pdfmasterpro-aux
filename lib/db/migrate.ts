import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { query } from "@/lib/db";

export async function runMigrations() {
  await query("CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(191) PRIMARY KEY, applied_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const directory = path.join(process.cwd(), "db/migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const applied = await query<{ version: string }>("SELECT version FROM schema_migrations WHERE version = ? LIMIT 1", [version]);
    if (applied.length) continue;
    const contents = await readFile(path.join(directory, file), "utf8");
    // O driver HTTP executa cada consulta em uma requisição própria: uma transação
    // não sobrevive entre elas. Como todas as migrações são idempotentes
    // (CREATE TABLE/INDEX IF NOT EXISTS), aplicamos instrução por instrução e só
    // registramos a versão quando todas tiverem sucesso.
    for (const statement of contents.split(/;\s*(?:\n|$)/).map((part) => part.trim()).filter(Boolean)) {
      await query(statement);
    }
    await query("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
    console.log(`Applied migration ${version}`);
  }
}
