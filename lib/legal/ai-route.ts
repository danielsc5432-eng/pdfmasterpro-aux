import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getPublicOrigin } from "@/lib/auth/session";
import { databaseConfigured } from "@/lib/db";
import { reserveBudget } from "@/lib/security/quotas";
import { canonicalEmail, trustedClientIp } from "@/lib/security/abuse";
import { legalAICapabilities, reviewLegalAI } from "./ai-service";
import { legalAIRequestSchema, LEGAL_AI_LIMITS } from "./ai-shared";
type Dependencies={configured:typeof databaseConfigured;reserve:typeof reserveBudget;review:typeof reviewLegalAI;capabilities:typeof legalAICapabilities};
export function createLegalAIHandler(overrides:Partial<Dependencies>={}){const deps={configured:databaseConfigured,reserve:reserveBudget,review:reviewLegalAI,capabilities:legalAICapabilities,...overrides};return async(request:NextRequest)=>{
  const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
  if(process.env.PROCESSING_WORKER_ONLY==="1")return reply({error:"Use a revisão pelo site principal."},403);
  if(request.headers.get("origin")!==new URL(getPublicOrigin(request)).origin)return reply({error:"Origem inválida."},403);
  const user=getCurrentUser(request);if(!user)return reply({error:"Entre na sua conta para usar a revisão opcional com IA."},401);
  if(!deps.capabilities().available)return reply({error:"A IA gratuita está indisponível. Os resultados locais foram preservados."},503);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")||""))return reply({error:"Envie somente os trechos em JSON, com consentimento."},415);
  if(Number(request.headers.get("content-length")||0)>LEGAL_AI_LIMITS.bytes)return reply({error:"Trechos excedem o limite seguro."},413);
  const reader=request.body?.getReader();if(!reader)return reply({error:"Selecione trechos e autorize o envio."},400);
  let bytes=Buffer.alloc(0),input;
  try{while(true){request.signal.throwIfAborted();const part=await reader.read();if(part.done)break;if(bytes.length+part.value.length>LEGAL_AI_LIMITS.bytes)return reply({error:"Trechos excedem o limite seguro."},413);bytes=Buffer.concat([bytes,part.value]);}input=legalAIRequestSchema.parse(JSON.parse(bytes.toString("utf8")));}catch{return reply({error:"Confira os trechos, limites e o consentimento de envio."},400);}finally{await reader.cancel().catch(()=>{});}
  try{
    if(!deps.configured())return reply({error:"A validação da cota de IA está indisponível."},503);
    if(!await deps.reserve("legal-ai-account",canonicalEmail(user.email),3))return reply({error:"Você atingiu as 3 tentativas de revisão com IA em 24 horas. A análise local continua disponível."},429);
    const ip=trustedClientIp(request);if(process.env.VERCEL==="1"&&!ip)return reply({error:"Não foi possível validar a conexão."},503);
    if(ip&&!await deps.reserve("legal-ai-network",ip,20))return reply({error:"Limite temporário de IA desta conexão atingido."},429);
    if(!await deps.reserve("legal-ai-global","site",50))return reply({error:"A cota gratuita de IA do site foi atingida. Os resultados locais continuam disponíveis."},429);
    const reviewed=await deps.review(input,AbortSignal.any([request.signal,AbortSignal.timeout(LEGAL_AI_LIMITS.timeout)]));return reply(reviewed);
  }catch{return reply({error:"A IA não concluiu uma resposta validável ou atingiu a franquia. Os resultados locais foram preservados."},503);}
};}
