import { z } from "zod";

const envelope = z.object({ data: z.object({ text: z.string().max(100000) }).strict() }).strict();

/** OpenCode v2 stateless generation: no session, agent loop, shell or document files. */
export async function generateWithOpenCode(
  prompt: string,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<string> {
  const base = process.env.DIVERGENCE_OPENCODE_URL;
  const providerID = process.env.DIVERGENCE_OPENCODE_PROVIDER;
  const id = process.env.DIVERGENCE_OPENCODE_MODEL;
  // Require an explicit model: never silently use a potentially paid server default.
  if (!base || !providerID || !id) throw new Error("OpenCode is not configured");
  const url = new URL(base);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) {
    throw new Error("Invalid OpenCode endpoint");
  }
  url.pathname = url.pathname.replace(/\/$/, "") + "/api/experimental/generate";
  const authorization = process.env.DIVERGENCE_OPENCODE_AUTHORIZATION;
  const response = await transport(url, {
    method: "POST", redirect: "error", cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ prompt, model: { providerID, id } }),
  });
  if (!response.ok || !response.body) throw new Error("OpenCode unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 128 * 1024) throw new Error("OpenCode response too large");
      text += decoder.decode(item.value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
  return envelope.parse(JSON.parse(text)).data.text;
}
