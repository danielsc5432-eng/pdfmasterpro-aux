"use client";

import { Menu, Moon, Search, Sun, X } from "lucide-react";
import { BrandSymbol } from "@/components/brand-symbol";
import { AccountMenu, type MenuUser } from "@/components/account-menu";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [query, setQuery] = useState("");
  const [user, setUser] = useState<MenuUser | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try { const response = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]) }); const data = await response.json(); if (!controller.signal.aborted) setUser(response.ok && data.authenticated ? data.user : null); }
      catch { if (!controller.signal.aborted) setUser(null); }
    };
    void refresh(); window.addEventListener("pdfmaster:account-updated", refresh);
    return () => { controller.abort(); window.removeEventListener("pdfmaster:account-updated", refresh); };
  }, [pathname]);

  useEffect(() => {
    const stored = window.localStorage.getItem("pdfmaster-theme");
    const isDark = stored === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
    const sync = () => setDark(document.documentElement.classList.contains("dark"));
    window.addEventListener("pdfmaster:theme", sync);
    return () => window.removeEventListener("pdfmaster:theme", sync);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("pdfmaster-theme", next ? "dark" : "light");
    window.dispatchEvent(new Event("pdfmaster:theme"));
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(query.trim() ? `/ferramentas?busca=${encodeURIComponent(query.trim())}` : "/ferramentas");
    setOpen(false);
  }

  const links = [
    { href: "/ferramentas/detector-divergencias", label: "Detector de Divergências" },
    { href: "/ferramentas", label: "Ferramentas" },
    { href: "/juridico", label: "Jurídico" },
    { href: "/precos", label: "Preços" },
  ];

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="PDF Master Pro, início">
          <BrandSymbol />
          <span className="brand-name">PDF Master Pro</span>
        </Link>
        <nav className="desktop-nav" aria-label="Navegação principal">
          {links.map((link) => <Link key={link.href} className={`nav-link ${pathname === link.href ? "active" : ""}`} href={link.href}>{link.label}</Link>)}
        </nav>
        <div className="header-actions">
          <form className="search-form" onSubmit={submitSearch} role="search">
            <Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ferramenta" aria-label="Buscar ferramenta" />
          </form>
          <button className="icon-button" onClick={toggleTheme} aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <AccountMenu key={pathname} user={user} />
        </div>
        <button className="icon-button mobile-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? "Fechar menu" : "Abrir menu"}>{open ? <X size={18} /> : <Menu size={18} />}</button>
      </div>
      <div className={`mobile-nav ${open ? "open" : ""}`}>
        <form className="search-form" onSubmit={submitSearch} role="search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ferramenta" aria-label="Buscar ferramenta" /></form>
        {links.map((link) => <Link key={link.href} className="nav-link" href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
        <div style={{ display: "flex", gap: 9 }}><AccountMenu key={pathname} user={user} onNavigate={() => setOpen(false)} /><button className="icon-button" onClick={toggleTheme} aria-label="Alternar tema">{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div>
      </div>
    </header>
  );
}
