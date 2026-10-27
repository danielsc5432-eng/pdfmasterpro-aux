import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export async function brandIcon(size: number) {
  const original = await readFile(path.join(process.cwd(), "public/brand/pdfmasterpro-full.png"));
  return new ImageResponse(
    <div style={{ display: "flex", position: "relative", width: size, height: size, background: "white", borderRadius: size * .18, overflow: "hidden" }}>
      <div style={{ display: "flex", position: "absolute", top: size * .13, left: 0, width: size, height: size * .72, overflow: "hidden" }}>
        <img alt="" src={`data:image/png;base64,${original.toString("base64")}`} width={size * 1.6} height={size * 1.6 * 2 / 3} style={{ position: "absolute", left: -size / 3, top: 0 }} />
      </div>
    </div>,
    { width: size, height: size },
  );
}
