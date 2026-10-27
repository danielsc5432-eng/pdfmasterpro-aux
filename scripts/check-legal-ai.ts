import { readFile,writeFile } from "node:fs/promises";
import { reviewLegalAI,legalAICapabilities } from "../lib/legal/ai-service";
async function main(){
  // Explicit whitelist: never load database, deployment or unrelated secrets for this smoke test.
  const values=await readFile(".env.summary","utf8");for(const line of values.split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&/^(SUMMARY_(?:AI_PROVIDER|FALLBACK_PROVIDER|FALLBACK_ENABLED|STANDARD_MODEL|FALLBACK_STANDARD_MODEL|CF_ACCOUNT_ID|CF_API_TOKEN|CF_FREE_CONFIRMED|GROQ_API_KEY|GROQ_FREE_CONFIRMED)|LEGAL_AI_ENABLED)$/.test(m[1]))process.env[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,"$2");}
  if(!legalAICapabilities().available)throw Error("IA jurídica não configurada localmente.");
  const result=await reviewLegalAI({tool:"contractcheck-ai",consent:true,sources:[{id:"s1",page:1,text:"Contrato sintético para teste técnico: a contratada deverá entregar o relatório em 15 dias úteis. O valor expresso é R$ 2.500,00."},{id:"s2",page:2,text:"Contrato sintético para teste técnico: a rescisão exige aviso escrito com antecedência de 30 dias corridos."}]},AbortSignal.timeout(48000));
  if(!result.points.length)throw Error("O provedor não retornou tópicos para os trechos sintéticos.");
  await writeFile(".vercel/review/legal/ai-live.json",JSON.stringify({...result,notice:"Somente texto sintético, sem documentos ou dados de usuários."},null,2));console.log(JSON.stringify({status:"verified",provider:result.provider,model:result.model,calls:result.calls,points:result.points.length}));
}
main().catch(()=>{console.error("O teste real da IA não concluiu uma resposta validável. Nenhum segredo foi exibido.");process.exitCode=1;});
