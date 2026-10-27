import test from "node:test";
import assert from "node:assert/strict";
import { toPlaceholders } from "../../lib/db";

/**
 * O restante da aplicação escreve as consultas com `?` (herança do MySQL), mas o
 * Postgres usa `$1, $2, ...`. A tradução precisa ignorar interrogações dentro de
 * literais, senão uma string como 'por que?' desloca todos os parâmetros.
 */

test("converte marcadores ? para $n na ordem", () => {
  assert.equal(toPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?"), "SELECT * FROM t WHERE a = $1 AND b = $2");
});

test("não confunde interrogação dentro de literal", () => {
  assert.equal(toPlaceholders("SELECT 'por que?' WHERE id = ?"), "SELECT 'por que?' WHERE id = $1");
});

test("trata aspas duplas e escape duplicado", () => {
  assert.equal(toPlaceholders(`SELECT "col?" WHERE x = ?`), `SELECT "col?" WHERE x = $1`);
  assert.equal(toPlaceholders("SELECT 'it''s?' WHERE x = ?"), "SELECT 'it''s?' WHERE x = $1");
});

test("consulta sem parâmetros permanece intacta", () => {
  const ddl = "CREATE TABLE IF NOT EXISTS t (id UUID PRIMARY KEY)";
  assert.equal(toPlaceholders(ddl), ddl);
});

test("mantém a ordem quando o literal vem antes e depois", () => {
  assert.equal(toPlaceholders("INSERT INTO t VALUES (?, 'a?b', ?)"), "INSERT INTO t VALUES ($1, 'a?b', $2)");
});
