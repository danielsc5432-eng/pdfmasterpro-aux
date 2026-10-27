import Link from "next/link";

export function AccountNavigation({ active }: { active: "painel" | "perfil" | "configuracoes" | "historico" }) {
  return <nav className="account-tabs" aria-label="Área da conta">{[
    ["painel", "Visão geral"], ["perfil", "Meu perfil"], ["historico", "Histórico"], ["configuracoes", "Plano e assinatura"],
  ].map(([slug, label]) => <Link key={slug} href={`/${slug}`} aria-current={active === slug ? "page" : undefined}>{label}</Link>)}</nav>;
}
