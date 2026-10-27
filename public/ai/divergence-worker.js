// Transformers.js is Apache-2.0. Loaded only after the user's explicit action.
// Model revision is fixed; document text is never placed in a URL or sent to an API.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const REVISION = "2c4055b12046f11709e9df2c122e59ffbdc2f900";
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let busy = false;

self.onmessage = async ({ data }) => {
  if (busy) return;
  busy = true;
  let extractor;
  try {
    const pairs = data?.pairs;
    if (!Array.isArray(pairs) || !pairs.length || pairs.length > 10 || pairs.some(pair => typeof pair.id !== "string" || pair.id.length > 80 || !Array.isArray(pair.texts) || pair.texts.length !== 2 || pair.texts.some(text => typeof text !== "string" || !text.length || text.length > 450))) throw Error("Invalid input");
    self.postMessage({ status: "loading" });
    extractor = await pipeline("feature-extraction", MODEL, {
      revision: REVISION, dtype: "q8", device: "wasm",
      progress_callback: progress => {
        if (progress.status === "progress" && Number.isFinite(progress.progress)) self.postMessage({ status: "download", progress: Math.max(0, Math.min(100, Math.round(progress.progress))) });
      },
    });
    const items = [];
    for (const pair of pairs) {
      self.postMessage({ status: "analyzing", completed: items.length, total: pairs.length });
      const output = await extractor(pair.texts, { pooling: "mean", normalize: true });
      const vectors = output.tolist();
      if (vectors.length !== 2 || vectors[0].length !== 384 || vectors[1].length !== 384) throw Error("Invalid embedding");
      let similarity = 0;
      for (let i = 0; i < 384; i++) similarity += vectors[0][i] * vectors[1][i];
      if (!Number.isFinite(similarity)) throw Error("Invalid score");
      items.push({ findingId: pair.id, similarity: Math.max(-1, Math.min(1, similarity)) });
    }
    self.postMessage({ status: "done", model: MODEL, revision: REVISION, items, createdAt: new Date().toISOString() });
  } catch {
    self.postMessage({ status: "error" });
  } finally {
    await extractor?.dispose().catch(() => {});
    busy = false;
  }
};
