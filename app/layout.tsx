import type { Metadata } from "next";
import { AdsenseScript } from "@/components/adsense-script";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "PDF Master Pro — Ferramentas para PDF",
    template: "%s — PDF Master Pro",
  },
  description: "Converta, organize, comprima e proteja seus documentos com ferramentas práticas para PDF.",
  keywords: ["PDF", "juntar PDF", "dividir PDF", "imagens para PDF", "organizar PDF"],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "PDF Master Pro",
    title: "PDF Master Pro — Ferramentas para PDF",
    description: "Todas as ferramentas para seus documentos em um só lugar.",
    images: [{ url: "/brand/pdfmasterpro-full.png", width: 1536, height: 1024, alt: "PDF Master Pro" }],
  },
  twitter: { card: "summary_large_image", images: ["/brand/pdfmasterpro-full.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <AdsenseScript />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
