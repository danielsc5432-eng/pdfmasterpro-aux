import type { LucideIcon } from "lucide-react";
import { Combine, Copy, FileOutput, FileText, ImageDown, Images, LayoutGrid, ListOrdered, LockKeyhole, Minimize2, PenLine, RotateCw, ScanText, Scissors, ShieldCheck, Stamp, Tags, TextSelect } from "lucide-react";

const icons: Record<string, LucideIcon> = { Combine, Copy, Scissors, Images, ImageDown, RotateCw, LayoutGrid, Minimize2, FileText, FileOutput, ScanText, TextSelect, Stamp, ListOrdered, PenLine, LockKeyhole, Tags, ShieldCheck };

export function ToolIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Icon = icons[name] ?? FileText;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}
