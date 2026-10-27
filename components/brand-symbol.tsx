import Image from "next/image";

/** A viewport into the supplied artwork; the original image is kept intact. */
export function BrandSymbol() {
  return <span className="brand-symbol" aria-hidden="true"><Image src="/brand/pdfmasterpro-full.png" alt="" width={1536} height={1024} sizes="86px" className="brand-symbol-image" priority /></span>;
}
