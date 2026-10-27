"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, UserRound } from "lucide-react";

export type MenuUser = { name: string; email: string };
export function AccountMenu({ user, onNavigate }: { user: MenuUser | null | undefined; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (user === undefined) return <span className="account-pending" role="status"><UserRound size={16} aria-hidden="true" /> Conta</span>;
  if (!user) return <div className="account-guest"><Link className="nav-link" href="/entrar" onClick={onNavigate}>Entrar</Link><Link className="button button-primary" href="/criar-conta" onClick={onNavigate}>Criar conta</Link></div>;
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
  return <div className="account-menu" ref={wrapper}><button ref={trigger} className="account-menu-trigger" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={id}><span aria-hidden="true">{initials || <UserRound size={16} />}</span><strong>Minha conta</strong><ChevronDown size={14} aria-hidden="true" /></button>{open && <nav id={id} className="account-menu-panel" aria-label="Minha conta"><div className="account-menu-identity"><strong>{user.name}</strong><small>{user.email}</small></div>{[["/painel", "Visão geral"], ["/perfil", "Meu perfil"], ["/historico", "Histórico"], ["/configuracoes", "Plano e assinatura"]].map(([href, label]) => <Link key={href} href={href} onClick={() => { setOpen(false); onNavigate?.(); }}>{label}</Link>)}<form action="/api/auth/logout" method="post"><button type="submit"><LogOut size={14} /> Sair da conta</button></form></nav>}</div>;
}
