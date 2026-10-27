"use client";
import { useEffect, useState } from "react";

export function ThemePreferences() {
  const [dark, setDark] = useState(false);
  useEffect(() => { const sync = () => setDark(document.documentElement.classList.contains("dark")); sync(); window.addEventListener("pdfmaster:theme", sync); return () => window.removeEventListener("pdfmaster:theme", sync); }, []);
  function choose(value: boolean) { setDark(value); document.documentElement.classList.toggle("dark", value); localStorage.setItem("pdfmaster-theme", value ? "dark" : "light"); window.dispatchEvent(new Event("pdfmaster:theme")); }
  return <section className="account-card"><h3>Aparência neste navegador</h3><p>Esta preferência é salva neste dispositivo.</p><div className="account-theme" role="group" aria-label="Tema do site"><button className="button button-ghost" aria-pressed={!dark} onClick={() => choose(false)}>Claro</button><button className="button button-ghost" aria-pressed={dark} onClick={() => choose(true)}>Escuro</button></div></section>;
}
