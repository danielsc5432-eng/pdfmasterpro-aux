/// <reference lib="webworker" />
import { compareLegalVersions } from "./compare";
import type { LegalDocument, LegalOptions, VersionLabel } from "./types";
const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<{ documents: LegalDocument[]; labels: VersionLabel[]; options: LegalOptions }>) => {
  try { const {documents,labels,options}=event.data;worker.postMessage({result:compareLegalVersions(documents,labels,options)}); }
  catch(error){worker.postMessage({error:error instanceof Error?error.message:"Não foi possível comparar as versões."});}
};
