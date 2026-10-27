import { analyzeLegalDocuments } from "./analyze";
self.onmessage=event=>{try{self.postMessage({result:analyzeLegalDocuments(event.data.tool,event.data.documents)});}catch(error){self.postMessage({error:error instanceof Error?error.message:"Falha na análise local."});}};
