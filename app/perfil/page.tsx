import Link from "next/link";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { AccountNavigation } from "@/components/account-navigation";
import { AccountWorkspace } from "@/components/account-workspace";

export const metadata = { title: "Meu perfil", description: "Seus dados, preferências e acesso no PDF Master Pro.", robots: { index: false, follow: false } };
export default async function ProfilePage() {
  const user = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) return <div className="page-shell"><div className="page-header"><h1>Seu perfil, suas preferências.</h1><p>Entre para personalizar seu nome de exibição e sua ferramenta preferida.</p><Link className="button button-primary" href="/entrar">Entrar na minha conta</Link></div></div>;
  return <div className="page-shell account-page"><div className="page-header"><span className="eyebrow">Área da conta</span><h1>Meu perfil</h1><p>Organize suas preferências e encontre seus próximos passos em um só lugar.</p></div><AccountNavigation active="perfil" /><AccountWorkspace mode="profile" /></div>;
}
