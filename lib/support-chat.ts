import { z } from "zod";

export const supportTopics = ["Conversão e layout", "CloneMaster AI", "Detector de Divergências", "Conta e acesso", "Assinatura e pagamentos", "Outro assunto"] as const;
export const ticketSchema = z.object({
  requestId: z.uuid(),
  topic: z.enum(supportTopics),
  tool: z.string().trim().min(2).max(100),
  description: z.string().trim().min(15).max(3000),
  environment: z.string().trim().min(3).max(300),
  attempted: z.string().trim().min(3).max(1000),
  consent: z.literal(true),
}).strict();
export type SupportTicket = z.infer<typeof ticketSchema>;

export function supportGuidance(topic: string) {
  switch (topic) {
    case "Conversão e layout": return "Confira o formato e o limite indicados na ferramenta. Se o PDF for digitalizado, o OCR pode ajudar a reconhecer o texto. Na conversão para Word, descreva quais textos, valores ou tabelas ficaram diferentes; não é possível garantir layout idêntico em qualquer PDF.";
    case "CloneMaster AI": return "Use modelos TXT, INI ou CFG com campos chave=valor e uma planilha XLSX. Confira a aba, as linhas e o mapeamento de colunas na prévia. A geração só começa após sua confirmação. Outros formatos ainda não são aceitos.";
    case "Detector de Divergências": return "Confira a ordem dos PDFs, as evidências e as páginas indicadas no relatório. Digitalizações podem precisar de OCR. A comparação auxilia a revisão; confirme divergências nos documentos originais.";
    case "Conta e acesso": return "Tente entrar novamente pela mesma conta usada no cadastro. Se o problema continuar, informe a mensagem exibida. Nunca envie senha, código de verificação ou token.";
    case "Assinatura e pagamentos": return "Consulte o plano e o status na área Minha conta. Se houve cobrança sem liberação, informe a data e a mensagem exibida, sem enviar número de cartão, código de segurança ou comprovantes com dados sensíveis.";
    default: return "Descreva o resultado esperado e o que aconteceu. Inclua a mensagem de erro, se houver, sem anexar documentos ou dados confidenciais.";
  }
}

export function ticketText(ticket: SupportTicket, user: { name: string; email: string }, protocol: string) {
  return [`Atendimento PDF Master Pro — ${protocol}`, `Nome: ${user.name}`, `E-mail para resposta: ${user.email}`, `Assunto: ${ticket.topic}`, `Ferramenta: ${ticket.tool}`, "", "Problema e resultado esperado:", ticket.description, "", "Navegador, dispositivo e contexto do arquivo:", ticket.environment, "", "Tentativas realizadas:", ticket.attempted, "", "O usuário revisou e autorizou o envio deste resumo."].join("\n");
}
