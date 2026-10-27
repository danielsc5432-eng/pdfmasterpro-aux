/**
 * Build da Vercel: aplica as migrações antes de gerar o bundle.
 *
 * O `DATABASE_URL` de produção é marcado como `sensitive`, então nem o painel nem
 * a API conseguem exibi-lo — só o próprio build tem acesso. Rodar a migração aqui
 * é a única forma de aplicá-la sem copiar o segredo para fora da plataforma.
 *
 * As migrações são idempotentes (CREATE ... IF NOT EXISTS + tabela
 * schema_migrations), então repetir a cada deploy é seguro.
 */
import { closeDb, databaseConfigured } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";

async function main() {
  if (!databaseConfigured()) {
    console.warn("[pdfmaster] DATABASE_URL ausente; build segue sem aplicar migrações.");
    return;
  }
  await runMigrations();
}

main()
  .catch((error) => {
    // Falhar o build é intencional: subir código novo sobre um schema antigo
    // quebraria a aplicação em produção de forma silenciosa.
    console.error("[pdfmaster] falha ao migrar:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
