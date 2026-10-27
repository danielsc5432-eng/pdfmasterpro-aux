import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

type TaskStatus = "processing" | "completed" | "failed";
type TaskRow = { id: string; tool_slug: string; status: TaskStatus; file_count: number; input_bytes: number | string; output_bytes: number | string | null; output_type: string | null; error_code: string | null; created_at: Date; completed_at: Date | null; expires_at: Date | null };

export function sessionHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function getSessionContext(request: NextRequest) { const existing = request.cookies.get("pdfmaster_session")?.value; const valid = Boolean(existing && /^[a-f0-9]{64}$/i.test(existing)); const token = valid ? existing! : randomBytes(32).toString("hex"); return { token, hash: sessionHash(token), isNew: !valid }; }
export function attachSessionCookie<T extends NextResponse>(response: T, token: string, request: NextRequest) { const isPublicHttps = request.headers.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production"; response.cookies.set("pdfmaster_session", token, { httpOnly: true, sameSite: isPublicHttps ? "none" : "lax", secure: isPublicHttps, maxAge: 60 * 60 * 24 * 30, path: "/" }); return response; }

export async function createProcessingTask(input: { sessionHash: string; toolSlug: string; fileCount: number; inputBytes: number }): Promise<string | null> {
  const id = randomUUID();
  try {
    await query("INSERT INTO processing_tasks (id, session_hash, tool_slug, status, file_count, input_bytes, expires_at) VALUES (?, ?, ?, 'processing', ?, ?, CURRENT_TIMESTAMP + INTERVAL '2 hours')", [id, input.sessionHash, input.toolSlug, input.fileCount, input.inputBytes]);
  } catch (error) { console.warn("[pdfmaster] histórico indisponível; processando sem persistência:", error instanceof Error ? error.message : error); return null; }
  return id;
}
export async function markProcessingTaskCompleted(id: string | null, outputBytes: number, outputType: string) { if (!id) return; try { await query("UPDATE processing_tasks SET status = 'completed', output_bytes = ?, output_type = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [outputBytes, outputType, id]); } catch (error) { console.warn("[pdfmaster] falha ao registrar conclusão:", error instanceof Error ? error.message : error); } }
export async function markProcessingTaskFailed(id: string | null, errorCode: string) { if (!id) return; try { await query("UPDATE processing_tasks SET status = 'failed', error_code = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [errorCode.slice(0, 80), id]); } catch (error) { console.warn("[pdfmaster] falha ao registrar erro:", error instanceof Error ? error.message : error); } }

export async function countRecentTasks(hash: string, hours = 24) {
  const window = Math.max(1, Math.min(24 * 30, Math.floor(hours)));
  try {
    const rows = await query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM processing_tasks WHERE session_hash = ? AND created_at > CURRENT_TIMESTAMP - INTERVAL '${window} hours'`, [hash]);
    return Number(rows[0]?.total ?? 0);
  } catch (error) { console.warn("[pdfmaster] falha ao contar tarefas recentes:", error instanceof Error ? error.message : error); return 0; }
}

export async function listProcessingTasks(hash: string) {
  const rows = await query<TaskRow>("SELECT id, tool_slug, status, file_count, input_bytes, output_bytes, output_type, error_code, created_at, completed_at, expires_at FROM processing_tasks WHERE session_hash = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ORDER BY created_at DESC LIMIT 50", [hash]);
  // BIGINT chega como string pelo driver HTTP; normalizamos para número.
  return rows.map((row) => ({ ...row, file_count: Number(row.file_count), input_bytes: Number(row.input_bytes), output_bytes: row.output_bytes === null ? null : Number(row.output_bytes) }));
}
