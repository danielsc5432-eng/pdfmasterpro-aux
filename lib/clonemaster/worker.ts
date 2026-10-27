/// <reference lib="webworker" />
import { BatchJobManager, DataSourceReader, TemplateReader } from "./engine";
import type { WorkerRequest } from "./types";
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    let result;
    if (request.command === "template") result = TemplateReader.read(request.fileId, request.name, request.bytes, request.encoding);
    else if (request.command === "source") result = await DataSourceReader.read(request.fileId, request.name, request.bytes);
    else if (request.command === "generate") result = await new BatchJobManager().run(request.templates, request.sources, request.configs, { onProgress: (done, total) => scope.postMessage({ id: request.id, progress: { done, total } }) });
    else throw Error("Operação não suportada.");
    scope.postMessage({ id: request.id, result });
  } catch (error) { scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : "Não foi possível processar estes arquivos." }); }
};
