import type { Finding } from "./types";
import { reviewInstructions, reviewJsonSchema, reviewPairs } from "./review-chain";

function endpoint(base: string, suffix: string) {
  const url = new URL(base);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) throw Error("Invalid AI endpoint");
  url.pathname = url.pathname.replace(/\/$/, "") + suffix;
  return url;
}

async function requestJson(url: URL, body: unknown, key: string | undefined, signal: AbortSignal | undefined, transport: typeof fetch) {
  signal?.throwIfAborted();
  const response = await transport(url, {
    method: "POST", redirect: "error", cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw Error("AI unavailable");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let count = 0, content = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      count += chunk.value.byteLength; if (count > 128 * 1024) throw Error("AI response too large");
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(content) as Record<string, unknown>;
}

export async function generateWithOllama(candidates: Finding[], signal?: AbortSignal, transport: typeof fetch = fetch) {
  const base = process.env.DIVERGENCE_OLLAMA_URL, model = process.env.DIVERGENCE_OLLAMA_MODEL;
  if (!base || !model) throw Error("Ollama not configured");
  const result = await requestJson(endpoint(base, "/api/chat"), {
    model, stream: false, format: reviewJsonSchema,
    options: { temperature: 0, num_predict: 800, num_ctx: 4096 },
    messages: [{ role: "system", content: reviewInstructions }, { role: "user", content: JSON.stringify({ untrustedDocumentPairs: reviewPairs(candidates) }) }],
  }, process.env.DIVERGENCE_AI_KEY, signal, transport);
  const message = result.message as { content?: unknown; tool_calls?: unknown[] } | undefined;
  if (result.done !== true || (result.done_reason && result.done_reason !== "stop") || message?.tool_calls?.length || typeof message?.content !== "string") throw Error("Incomplete or unsupported response");
  return message.content;
}

export async function generateWithTransformers(candidates: Finding[], signal?: AbortSignal, transport: typeof fetch = fetch) {
  const base = process.env.DIVERGENCE_TRANSFORMERS_URL, model = process.env.DIVERGENCE_TRANSFORMERS_MODEL;
  if (!base || !model) throw Error("Transformers not configured");
  const result = await requestJson(endpoint(base, "/v1/review"), { model, pairs: reviewPairs(candidates) }, process.env.DIVERGENCE_TRANSFORMERS_KEY, signal, transport);
  if (typeof result.content !== "string" || result.model !== model) throw Error("Invalid Transformers response");
  return result.content;
}
