import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { supportEmail } from "@/lib/support";
import { SupportChat } from "@/components/support-chat";
import { supportDeliveryConfigured } from "@/lib/support-delivery";
import { databaseConfigured } from "@/lib/db";
export const dynamic = "force-dynamic";
export const metadata = { title: "Contato e ajuda", description: "Orientações de uso e canais de atendimento do PDF Master Pro." };
export default function ContactPage() {
  const email = supportEmail();
  return <div className="page-shell"><div className="page-header"><span className="eyebrow">Central de ajuda</span><h1>Precisa de ajuda com um documento?</h1><p>Confira a mensagem exibida na ferramenta e os limites do arquivo. Nunca compartilhe conteúdo confidencial.</p></div><SupportChat deliveryReady={supportDeliveryConfigured() && databaseConfigured()} email={email} /><div className="feature-band" style={{ maxWidth: 900, marginTop: 34 }}><div className="feature-card"><Mail size={22} /><h3>Atendimento</h3>{email ? <p><a className="text-link" href={`mailto:${email}`}>{email}</a></p> : <p>O canal de atendimento está em preparação. Ainda não há uma caixa de e-mail de suporte disponível nesta página.</p>}</div><div className="feature-card"><MessageCircle size={22} /><h3>Confira antes de tentar novamente</h3><p>Verifique o formato, o tamanho e a quantidade de arquivos aceitos. Se a sessão expirou, entre novamente. Para PDFs digitalizados, confira as opções de OCR disponíveis.</p><Link className="text-link" href="/ferramentas">Explorar ferramentas</Link></div><div className="feature-card"><span className="eyebrow">Sua conta</span><h3>Dados e assinatura</h3><p>Consulte seu plano e os limites na área da conta. O perfil permite editar preferências e exportar os dados exibidos.</p><Link className="text-link" href="/painel">Acessar minha conta</Link></div></div></div>;
}
