import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { AccountNavigation } from "@/components/account-navigation";
import { AccountWorkspace } from "@/components/account-workspace";

export const metadata: Metadata = { title: "Minha conta", description: "Seu espaço de trabalho PDF Master Pro.", robots: { index: false, follow: false } };
export default async function DashboardPage() {
  const user = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) return <div className="page-shell"><div className="page-header"><span className="eyebrow">Área da conta</span><h1>Entre para acessar seu painel.</h1><p>Consulte seu perfil, histórico e preferências em um espaço protegido.</p><Link className="button button-primary" href="/entrar">Entrar na minha conta</Link></div></div>;
  return <div className="page-shell account-page"><div className="page-header"><span className="eyebrow">Seu espaço de trabalho</span><h1>Minha conta</h1><p>Acompanhe seu uso, personalize seu perfil e retome suas ferramentas.</p></div><AccountNavigation active="painel" /><AccountWorkspace mode="overview" /></div>;
}
