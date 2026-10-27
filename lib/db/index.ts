import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Postgres (Neon) é o banco de produção. Usamos a função `neon()`, que executa
 * cada consulta por HTTP sem manter pool: é o modo recomendado em ambiente
 * serverless, onde uma conexão TCP persistente não sobrevive entre invocações.
 */

type Sql = NeonQueryFunction<false, false>;
let client: Sql | undefined;

function connectionString() {
  return process.env.DATABASE_URL?.trim();
}

export function databaseConfigured() { return Boolean(connectionString()); }

export function getDb(): Sql {
  if (client) return client;
  const url = connectionString();
  if (!url) throw new Error("DATABASE_URL is not configured.");
  client = neon(url);
  return client;
}

/** Executa uma consulta e devolve as linhas, aceitando `?` no lugar de `$1`. */
export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const sql = getDb() as unknown as { query: (text: string, params: unknown[]) => Promise<unknown[]> };
  // `sql.query` é a API do driver para SQL dinâmico com parâmetros vinculados
  // ($1, $2, ...). Nunca concatenamos valores no texto da consulta.
  const rows = await sql.query(toPlaceholders(text), params as unknown[]);
  return rows as T[];
}

/**
 * Converte os marcadores `?` do MySQL para os `$1..$n` do Postgres, ignorando
 * interrogações dentro de literais e aspas.
 */
export function toPlaceholders(text: string) {
  let index = 0;
  let output = "";
  let quote: string | null = null;
  for (let position = 0; position < text.length; position += 1) {
    const char = text[position];
    if (quote) {
      output += char;
      if (char === quote && text[position + 1] === quote) { output += text[position + 1]; position += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; output += char; continue; }
    if (char === "?") { index += 1; output += `$${index}`; continue; }
    output += char;
  }
  return output;
}

/** A função `neon()` não mantém pool, então não há o que encerrar. */
export async function closeDb() { client = undefined; }
