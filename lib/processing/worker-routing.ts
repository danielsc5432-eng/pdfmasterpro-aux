import { getTool } from "../tools/catalog";

type Environment = Record<string, string | undefined>;
type WorkerRoute = { url: string; maxRequestBytes?: number };
const MAX_BODY = 130 * 1024 * 1024;

function workerOrigin(value: string, env: Environment): string {
  const url = new URL(value);
  const local = env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw Error("O endereço do processador deve ser uma origem HTTPS sem credenciais.");
  }
  return url.origin;
}

function routes(env: Environment): Record<string, WorkerRoute> {
  const raw = env.PROCESSING_WORKER_ROUTES?.trim();
  if (!raw) return {};
  if (raw.length > 16384) throw Error("Configuração de processadores excede o limite.");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("Configuração de processadores inválida.");
  const result: Record<string, WorkerRoute> = Object.create(null);
  for (const [tool, value] of Object.entries(parsed)) {
    if (!getTool(tool) || !value || typeof value !== "object" || Array.isArray(value)) throw Error("Ferramenta ou processador inválido.");
    const route = value as Record<string, unknown>;
    if (typeof route.url !== "string" || Object.keys(route).some(key => !["url", "maxRequestBytes"].includes(key))) throw Error("Configuração de destino inválida.");
    const max = route.maxRequestBytes;
    if (max !== undefined && (typeof max !== "number" || !Number.isSafeInteger(max) || max < 1 || max > MAX_BODY)) throw Error("Limite do processador inválido.");
    result[tool] = { url: workerOrigin(route.url, env), ...(max === undefined ? {} : { maxRequestBytes: max as number }) };
  }
  return result;
}

/** Select one destination before consuming the upload. Never replay a PDF to another host. */
export function processingWorkerUrl(tool: string, declaredBytes?: number, env: Environment = process.env): string | undefined {
  if (env.PROCESSING_WORKER_ONLY === "1") return undefined;
  const base = env.PROCESSING_WORKER_URL?.trim();
  const fallback = base ? workerOrigin(base, env) : undefined;
  const route = routes(env)[tool];
  if (!route) return fallback;
  if (route.maxRequestBytes !== undefined && (!Number.isSafeInteger(declaredBytes) || declaredBytes! <= 0 || declaredBytes! > route.maxRequestBytes)) {
    if (!fallback) throw Error("Configure o processador principal para os arquivos maiores.");
    return fallback;
  }
  return route.url;
}

export function workerAcceptsTool(tool: string, env: Environment = process.env): boolean {
  if (env.PROCESSING_WORKER_ONLY !== "1" || !env.PROCESSING_WORKER_TOOLS?.trim()) return true;
  const accepted = env.PROCESSING_WORKER_TOOLS.split(",").map(item => item.trim());
  if (accepted.some(item => !getTool(item))) throw Error("Lista de ferramentas do processador inválida.");
  return accepted.includes(tool);
}

export function workerRequestLimit(env: Environment = process.env): number {
  const value = env.PROCESSING_WORKER_MAX_REQUEST_BYTES;
  if (!value) return MAX_BODY;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BODY) throw Error("Limite de upload do processador inválido.");
  return limit;
}

export function workerRequestHeaders(incoming: Headers, signed: Record<string, string> | null): Headers {
  if (!signed) throw Error("A autenticação entre processadores não está configurada.");
  const headers = new Headers(signed);
  for (const key of ["content-type", "content-length", "accept"]) {
    const value = incoming.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("accept-encoding", "identity");
  return headers;
}

export function workerResponseHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming);
  for (const key of ["set-cookie", "transfer-encoding", "content-length", "content-encoding"]) headers.delete(key);
  return headers;
}
