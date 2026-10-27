"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { ADSENSE_CLIENT_ID } from "@/lib/adsense";
import { usePathname } from "next/navigation";
import { isLocalLegalSlug } from "@/lib/legal/suite-config";

/**
 * O anúncio só é carregado no plano grátis: assinantes Premium navegam sem anúncios.
 * A verificação do plano acontece no navegador para manter as páginas estáticas.
 */
export function AdsenseScript() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/billing/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { limits?: { removeAds?: boolean } } | null) => {
        if (active && data?.limits?.removeAds) setEnabled(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!enabled || pathname.startsWith("/juridico") || isLocalLegalSlug(pathname.replace(/^\/ferramentas\//,""))) return null;

  return (
    <Script
      id="adsbygoogle-loader"
      async
      crossOrigin="anonymous"
      strategy="afterInteractive"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT_ID)}`}
    />
  );
}
