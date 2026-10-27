import type { MetadataRoute } from "next";
import { tools } from "@/lib/tools/catalog";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  const urls = ["/", "/ferramentas", "/juridico", "/precos", "/privacidade", "/termos", "/contato", ...tools.map((tool) => `/ferramentas/${tool.slug}`)];
  return urls.map((path) => ({ url: base ? `${base.replace(/\/$/, "")}${path}` : path, lastModified: new Date(), changeFrequency: "monthly", priority: path === "/" ? 1 : 0.7 }));
}
