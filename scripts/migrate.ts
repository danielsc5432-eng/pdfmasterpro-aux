import { closeDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";

runMigrations().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
